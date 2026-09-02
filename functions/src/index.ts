import * as functions from 'firebase-functions/v1';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { MetricServiceClient } from '@google-cloud/monitoring';
import { randomUUID } from 'crypto';

if (!getApps().length) {
  initializeApp();
}

const DEFAULT_ORG_ID = process.env.VITE_ORG_ID || 'utd';
const BOOTSTRAP_ADMIN_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@utd.ac.th').toLowerCase().trim();

/**
 * Firestore database ID.
 * The live application data lives in the NON-DEFAULT database. All Admin SDK
 * access in this file must target it explicitly via getDb(); a bare
 * getFirestore() would silently read/write the unused "(default)" database.
 * Override with FIRESTORE_DATABASE_ID for the emulator or a different project.
 */
const FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID || 'ai-studio-ddf61d33-4a5f-4aed-a5a9-5bc34b3c98da';

const getDb = () => getFirestore(FIRESTORE_DATABASE_ID);

const DOMAIN = '@utd.ac.th';
const ELEVATED_ROLES = ['admin', 'manager'];
const ASSISTANT_ENTITY_TYPES = ['teachers', 'subjects', 'teacherSubjectAssignments', 'scheduleEntries'] as const;
type AssistantEntityType = typeof ASSISTANT_ENTITY_TYPES[number];

// In-memory rate limiting map for login log attempts (prevents spam DoS)
const loginRateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_LOGS_PER_WINDOW = 20; // 20 attempts per minute per key

function checkLoginRateLimit(key: string): boolean {
  const now = Date.now();
  const record = loginRateLimitMap.get(key);
  if (!record || now > record.resetTime) {
    loginRateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (record.count >= MAX_LOGS_PER_WINDOW) {
    return false;
  }
  record.count += 1;
  return true;
}

/**
 * Callable Function: setUserRole
 * Allows existing Admins to assign roles via Firebase Auth Custom Claims.
 * Synchronizes custom claims, user profile, and authorizedAdmins list atomically.
 */
export const setUserRole = functions.https.onCall(async (
  data: { targetEmail: string; role: string; orgId?: string; name?: string; assignedDepartments?: string[] },
  context: functions.https.CallableContext
) => {
  // 1. Verify caller authentication
  if (!context.auth) {
    console.warn(`[SECURITY] Unauthorized access attempt to setUserRole: User is unauthenticated at ${new Date().toISOString()}`);
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerEmail = context.auth.token.email?.toLowerCase().trim();
  const callerRole = context.auth.token.role;

  // Domain guard: Must be @utd.ac.th
  if (!callerEmail?.endsWith('@utd.ac.th')) {
    console.warn(`[SECURITY] Unauthorized access attempt to setUserRole by non-domain account '${callerEmail || 'unknown'}' at ${new Date().toISOString()}`);
    throw new functions.https.HttpsError('permission-denied', 'Access restricted to @utd.ac.th domain.');
  }

  // Admin guard: Caller must be admin or bootstrap admin
  const isCallerAdmin = callerRole === 'admin' || callerEmail === BOOTSTRAP_ADMIN_EMAIL || callerEmail === 'kiattika@utd.ac.th';
  if (!isCallerAdmin) {
    console.warn(`[SECURITY] Unauthorized access attempt to setUserRole by non-admin '${callerEmail}' (Role: ${callerRole || 'none'}) at ${new Date().toISOString()}`);
    throw new functions.https.HttpsError('permission-denied', 'Only administrators can change user roles.');
  }

  const { targetEmail, role, orgId = DEFAULT_ORG_ID, name, assignedDepartments } = data;

  if (!targetEmail || !role) {
    throw new functions.https.HttpsError('invalid-argument', 'targetEmail and role are required.');
  }

  const validRoles = ['admin', 'manager', 'teacher', 'assistant', 'guest'];
  if (!validRoles.includes(role)) {
    throw new functions.https.HttpsError('invalid-argument', `Invalid role: ${role}`);
  }

  const cleanTargetEmail = targetEmail.toLowerCase().trim();
  if (!cleanTargetEmail.endsWith('@utd.ac.th')) {
    throw new functions.https.HttpsError('invalid-argument', 'Target email must belong to @utd.ac.th domain.');
  }

  try {
    const auth = getAuth();
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(cleanTargetEmail);
    } catch (authErr: any) {
      if (authErr?.code === 'auth/user-not-found') {
        throw new functions.https.HttpsError(
          'not-found',
          `ไม่พบบัญชีผู้ใช้ '${cleanTargetEmail}' ในระบบ Firebase Auth กรุณาให้ผู้ใช้งานล็อกอินเข้าสู่ระบบด้วย Google (@utd.ac.th) อย่างน้อย 1 ครั้งก่อนกำหนดสิทธิ์`
        );
      }
      throw authErr;
    }
    
    // 2. Set Firebase Auth custom claims
    // Firestore Rules authorize on request.auth.token.{role,orgId,assignedDepartments},
    // so all three must be present on every managed account.
    const claimDepartments = role === 'assistant' && Array.isArray(assignedDepartments)
      ? assignedDepartments.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
      : [];
    await auth.setCustomUserClaims(userRecord.uid, {
      role,
      orgId,
      assignedDepartments: claimDepartments
    });

    // 3. Update Firestore document record (both users array and authorizedAdmins array)
    const db = getDb();
    const appDocRef = db.doc(`apps/${orgId}`);
    const appSnap = await appDocRef.get();

    let updatedUsers: any[] = [];
    let updatedAdmins: string[] = [];

    if (appSnap.exists) {
      const appData = appSnap.data() || {};
      const users: any[] = Array.isArray(appData.users) ? [...appData.users] : [];
      let authorizedAdmins: string[] = Array.isArray(appData.authorizedAdmins) 
        ? [...appData.authorizedAdmins].map((e: string) => e.toLowerCase().trim()) 
        : [];

      const userIndex = users.findIndex((u: any) => u.email?.toLowerCase().trim() === cleanTargetEmail);
      
      const userPayload: any = {
        id: userRecord.uid,
        name: name?.trim() || (userIndex >= 0 ? users[userIndex].name : (userRecord.displayName || cleanTargetEmail.split('@')[0])),
        email: cleanTargetEmail,
        role,
        organizationId: orgId
      };

      if (role === 'assistant' && Array.isArray(assignedDepartments)) {
        userPayload.assignedDepartments = assignedDepartments;
      }

      if (userIndex >= 0) {
        users[userIndex] = { ...users[userIndex], ...userPayload };
      } else {
        users.push(userPayload);
      }

      // Synchronize authorizedAdmins array with role
      if (role === 'admin') {
        if (!authorizedAdmins.includes(cleanTargetEmail)) {
          authorizedAdmins.push(cleanTargetEmail);
        }
      } else {
        authorizedAdmins = authorizedAdmins.filter(e => e !== cleanTargetEmail);
      }

      await appDocRef.update({
        users,
        authorizedAdmins
      });

      updatedUsers = users;
      updatedAdmins = authorizedAdmins;
    }

    console.log(`[AUDIT] Role '${role}' successfully assigned to '${cleanTargetEmail}' (Custom Claims + Firestore synced) by '${callerEmail}' at ${new Date().toISOString()}`);

    return {
      success: true,
      message: `บันทึกบทบาท '${role}' ให้กับ ${cleanTargetEmail} เรียบร้อยแล้ว`,
      role,
      targetEmail: cleanTargetEmail,
      authorizedAdmins: updatedAdmins,
      users: updatedUsers
    };
  } catch (error: any) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Error setting user role:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Failed to set user custom claims.');
  }
});

/**
 * Callable Function: bootstrapAdmin
 * One-time setup to grant initial Admin custom claims to the designated bootstrap admin email.
 */
export const bootstrapAdmin = functions.https.onCall(async (_data: any, context: functions.https.CallableContext) => {
  if (!context.auth) {
    console.warn(`[SECURITY] Unauthorized access attempt to bootstrapAdmin: User is unauthenticated at ${new Date().toISOString()}`);
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerEmail = context.auth.token.email?.toLowerCase().trim();
  if (!callerEmail) {
    console.warn(`[SECURITY] bootstrapAdmin rejected: No email associated with caller uid ${context.auth.uid}`);
    throw new functions.https.HttpsError('invalid-argument', 'No email associated with account.');
  }

  // Check if caller matches bootstrap admin email
  if (callerEmail !== BOOTSTRAP_ADMIN_EMAIL && callerEmail !== 'kiattika@utd.ac.th') {
    console.warn(`[SECURITY] Unauthorized bootstrapAdmin attempt by '${callerEmail}' at ${new Date().toISOString()}`);
    throw new functions.https.HttpsError('permission-denied', 'Only designated initial administrators can bootstrap.');
  }

  try {
    const auth = getAuth();
    await auth.setCustomUserClaims(context.auth.uid, {
      role: 'admin',
      orgId: DEFAULT_ORG_ID,
      assignedDepartments: []
    });

    // Also ensure bootstrap admin is in authorizedAdmins and users in Firestore
    const db = getDb();
    const appDocRef = db.doc(`apps/${DEFAULT_ORG_ID}`);
    const appSnap = await appDocRef.get();
    if (appSnap.exists) {
      const appData = appSnap.data() || {};
      const users: any[] = Array.isArray(appData.users) ? [...appData.users] : [];
      let authorizedAdmins: string[] = Array.isArray(appData.authorizedAdmins) 
        ? [...appData.authorizedAdmins].map((e: string) => e.toLowerCase().trim()) 
        : [];

      if (!authorizedAdmins.includes(callerEmail)) {
        authorizedAdmins.push(callerEmail);
      }

      const userIndex = users.findIndex((u: any) => u.email?.toLowerCase().trim() === callerEmail);
      if (userIndex >= 0) {
        users[userIndex].role = 'admin';
      } else {
        users.push({
          id: context.auth.uid,
          name: context.auth.token.name || callerEmail.split('@')[0],
          email: callerEmail,
          role: 'admin',
          organizationId: DEFAULT_ORG_ID
        });
      }

      await appDocRef.update({ users, authorizedAdmins });
    }

    console.log(`[AUDIT] Bootstrap admin claims successfully granted to '${callerEmail}' at ${new Date().toISOString()}`);

    return {
      success: true,
      message: `Bootstrap successful. Admin claims granted to ${callerEmail}.`
    };
  } catch (error: any) {
    console.error('Error in bootstrapAdmin:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Failed to bootstrap admin.');
  }
});

/**
 * Callable Function: logLoginAttempt
 * Secure server-side logger for authentication attempts (Logged In & Login Failed).
 * Bypasses client-side Firestore Rules safely via Admin SDK while enforcing rate limits and caller verification.
 */
export const logLoginAttempt = functions.https.onCall(async (
  data: { status: 'success' | 'failed'; email?: string; reason?: string; role?: string; orgId?: string },
  context: functions.https.CallableContext
) => {
  // 1. Rate limiting check (prevent spam / DoS)
  const rateLimitKey = context.auth?.uid || (context.rawRequest?.ip as string) || (data?.email || 'anonymous');
  if (!checkLoginRateLimit(rateLimitKey)) {
    console.warn(`[SECURITY] logLoginAttempt rate limit exceeded for key '${rateLimitKey}' at ${new Date().toISOString()}`);
    throw new functions.https.HttpsError('resource-exhausted', 'Too many log requests. Please try again later.');
  }

  const status = data?.status;
  if (status !== 'success' && status !== 'failed') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid status. Must be "success" or "failed".');
  }

  const orgId = (data?.orgId || DEFAULT_ORG_ID).replace(/[^a-zA-Z0-9_-]/g, '');

  let userEmail = 'Unknown';
  let role = data?.role ? String(data.role).slice(0, 50) : undefined;
  const reason = data?.reason ? String(data.reason).slice(0, 300) : undefined;

  // 2. Validate caller identity
  if (status === 'success') {
    // For successful login, caller must be authenticated and email must match caller's token
    if (!context.auth) {
      console.warn(`[SECURITY] Spoofed login success attempt rejected: Unauthenticated context at ${new Date().toISOString()}`);
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated to record successful login.');
    }
    userEmail = (context.auth.token.email || data?.email || 'unknown').toLowerCase().trim().slice(0, 100);
  } else {
    // For failed login, take email from request payload or token (may be non-domain account or unauthenticated)
    userEmail = (data?.email || context.auth?.token?.email || 'Unknown').toLowerCase().trim().slice(0, 100);
  }

  const action = status === 'success' ? 'Logged In' : 'Login Failed';
  let description = '';
  if (status === 'success') {
    description = `User logged into the application (${role || 'user'})`;
  } else {
    description = `Login attempt failed for ${userEmail}: ${reason || 'Authentication denied'}`;
  }

  const logId = randomUUID();
  const logEntry = {
    id: logId,
    timestamp: new Date().toISOString(),
    action,
    description,
    user: userEmail,
    details: reason ? `Reason: ${reason}` : undefined
  };

  try {
    const db = getDb();
    const logDocRef = db.doc(`apps/${orgId}/activityLogs/${logId}`);
    await logDocRef.set(logEntry);

    // Google Cloud Structured Security Log
    if (status === 'success') {
      console.log(`[AUDIT] Login successful for '${userEmail}' (${role || 'user'}) at ${logEntry.timestamp}`);
    } else {
      console.warn(`[SECURITY] Login failed for '${userEmail}': ${reason || 'Denied'} at ${logEntry.timestamp}`);
    }

    return {
      success: true,
      id: logId,
      log: logEntry
    };
  } catch (error: any) {
    console.error('Error recording login attempt in logLoginAttempt Cloud Function:', error);
    throw new functions.https.HttpsError('internal', 'Failed to record login log.');
  }
});

/**
 * Scheduled Cloud Function: cleanupOldActivityLogs
 * Runs daily at midnight to delete activity logs and error reports older than 90 days.
 */
export const cleanupOldActivityLogs = functions.pubsub.schedule('every 24 hours').onRun(async () => {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();

  try {
    let totalPurged = 0;

    // 1. Purge activity logs older than 90 days
    const logsRef = db.collection(`apps/${DEFAULT_ORG_ID}/activityLogs`);
    const logsSnap = await logsRef.where('timestamp', '<', ninetyDaysAgo).get();
    if (!logsSnap.empty) {
      const batch = db.batch();
      logsSnap.docs.forEach((doc: any) => batch.delete(doc.ref));
      await batch.commit();
      totalPurged += logsSnap.size;
      console.log(`[MAINTENANCE] Purged ${logsSnap.size} expired activity log documents.`);
    }

    // 2. Purge application error reports older than 90 days
    const errorsRef = db.collection(`apps/${DEFAULT_ORG_ID}/errors`);
    const errorsSnap = await errorsRef.where('timestamp', '<', ninetyDaysAgo).get();
    if (!errorsSnap.empty) {
      const batch2 = db.batch();
      errorsSnap.docs.forEach((doc: any) => batch2.delete(doc.ref));
      await batch2.commit();
      totalPurged += errorsSnap.size;
      console.log(`[MAINTENANCE] Purged ${errorsSnap.size} expired error log documents.`);
    }

    if (totalPurged === 0) {
      console.log('[MAINTENANCE] No expired activity logs or error records found.');
    }

    return null;
  } catch (error) {
    console.error('Error cleaning old activity/error logs:', error);
    return null;
  }
});

/**
 * Callable Function: getFirestoreUsageStats
 * Retrieves real Firestore document read, write, and delete metrics
 * from the Google Cloud Monitoring API for the project.
 * Restricts access to Administrators only.
 */
export const getFirestoreUsageStats = functions.https.onCall(async (data: { days?: number }, context: functions.https.CallableContext) => {
  // 1. Authorization check
  if (!context.auth) {
    console.warn(`[SECURITY] Unauthorized access attempt to getFirestoreUsageStats: User is unauthenticated at ${new Date().toISOString()}`);
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerEmail = context.auth.token.email?.toLowerCase().trim();
  const callerRole = context.auth.token.role;
  const isCallerAdmin = callerRole === 'admin' || callerEmail === BOOTSTRAP_ADMIN_EMAIL || callerEmail === 'kiattika@utd.ac.th';

  if (!isCallerAdmin) {
    console.warn(`[SECURITY] Unauthorized getFirestoreUsageStats attempt by '${callerEmail || 'unknown'}' (Role: ${callerRole || 'none'}) at ${new Date().toISOString()}`);
    throw new functions.https.HttpsError('permission-denied', 'Only administrators can access Firestore usage metrics.');
  }

  // 2. Resolve Google Cloud Project ID
  const projectId = process.env.GCLOUD_PROJECT || 
                    process.env.GOOGLE_CLOUD_PROJECT || 
                    (getApps().length ? getApp().options.projectId : undefined) || 
                    process.env.VITE_FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Google Cloud Project ID is not defined in the environment. Cloud Monitoring queries cannot be executed.'
    );
  }

  const requestedDays = typeof data?.days === 'number' && data.days > 0 && data.days <= 30 ? data.days : 7;
  const nowMs = Date.now();
  const startTimeSeconds = Math.floor((nowMs - requestedDays * 24 * 60 * 60 * 1000) / 1000);
  const endTimeSeconds = Math.floor(nowMs / 1000);

  const metricsToQuery = [
    { key: 'reads', type: 'firestore.googleapis.com/document/read_count' },
    { key: 'writes', type: 'firestore.googleapis.com/document/write_count' },
    { key: 'deletes', type: 'firestore.googleapis.com/document/delete_count' }
  ];

  // Helper to format Date to YYYY-MM-DD in Thailand Timezone (Asia/Bangkok, UTC+7)
  const formatDateKey = (d: Date): string => {
    // แปลงเป็นเวลาไทย (UTC+7) อย่างชัดเจน ไม่พึ่ง timezone ของเครื่อง server
    const bangkokTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    const year = bangkokTime.getUTCFullYear();
    const month = String(bangkokTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(bangkokTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Initialize date buckets for requested time range
  const dailyMap: Record<string, { date: string; reads: number; writes: number; deletes: number }> = {};
  for (let i = requestedDays - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * 24 * 60 * 60 * 1000);
    const dateKey = formatDateKey(d);
    dailyMap[dateKey] = {
      date: dateKey,
      reads: 0,
      writes: 0,
      deletes: 0
    };
  }

  try {
    const monitoringClient = new MetricServiceClient();
    const projectName = monitoringClient.projectPath(projectId);

    for (const metricDef of metricsToQuery) {
      try {
        const request = {
          name: projectName,
          filter: `metric.type = "${metricDef.type}"`,
          interval: {
            startTime: { seconds: startTimeSeconds },
            endTime: { seconds: endTimeSeconds }
          },
          aggregation: {
            alignmentPeriod: { seconds: 86400 }, // 1 day alignment
            perSeriesAligner: 'ALIGN_SUM',
            crossSeriesReducer: 'REDUCE_SUM'
          }
        };

        const [timeSeries] = await monitoringClient.listTimeSeries(request as any);

        if (timeSeries && Array.isArray(timeSeries)) {
          for (const series of timeSeries) {
            if (series.points && Array.isArray(series.points)) {
              for (const point of series.points) {
                const pointEndTime = point.interval?.endTime?.seconds;
                if (pointEndTime) {
                  const pointDate = new Date(Number(pointEndTime) * 1000);
                  const dateKey = formatDateKey(pointDate);
                  let pointValue = 0;
                  if (point.value?.int64Value !== undefined && point.value?.int64Value !== null) {
                    pointValue = Number(point.value.int64Value);
                  } else if (point.value?.doubleValue !== undefined && point.value?.doubleValue !== null) {
                    pointValue = Math.round(Number(point.value.doubleValue));
                  }

                  if (dailyMap[dateKey]) {
                    if (metricDef.key === 'reads') dailyMap[dateKey].reads += pointValue;
                    if (metricDef.key === 'writes') dailyMap[dateKey].writes += pointValue;
                    if (metricDef.key === 'deletes') dailyMap[dateKey].deletes += pointValue;
                  }
                }
              }
            }
          }
        }
      } catch (metricQueryErr: any) {
        console.warn(`Query for metric ${metricDef.type} notice:`, metricQueryErr?.message || metricQueryErr);
      }
    }

    const dailyStats = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
    const totalReads = dailyStats.reduce((acc, curr) => acc + curr.reads, 0);
    const totalWrites = dailyStats.reduce((acc, curr) => acc + curr.writes, 0);
    const totalDeletes = dailyStats.reduce((acc, curr) => acc + curr.deletes, 0);
    const daysCount = Math.max(1, dailyStats.length);

    return {
      success: true,
      projectId,
      source: 'Google Cloud Monitoring API',
      timeRange: {
        days: requestedDays,
        startDate: dailyStats[0]?.date || formatDateKey(new Date(nowMs - requestedDays * 86400000)),
        endDate: dailyStats[dailyStats.length - 1]?.date || formatDateKey(new Date(nowMs))
      },
      dailyStats,
      totals: {
        totalReads,
        totalWrites,
        totalDeletes,
        dailyAverageReads: Math.round(totalReads / daysCount),
        dailyAverageWrites: Math.round(totalWrites / daysCount),
        dailyAverageDeletes: Math.round(totalDeletes / daysCount)
      },
      fetchedAt: new Date().toISOString()
    };
  } catch (err: any) {
    console.error('getFirestoreUsageStats error details:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    
    // Explicit informative error without any fake data fallback
    let errorMessage = err?.message || 'Unknown error querying Cloud Monitoring API';
    if (err?.code === 7 || errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('permission') || errorMessage.includes('IAM')) {
      errorMessage = `ไม่สามารถดึงข้อมูลสถิติได้เนื่องจากติดสิทธิ์ IAM: บัญชี Service Account ของระบบยังไม่ได้รับบทบาท 'Monitoring Viewer' (roles/monitoring.viewer) บน Google Cloud Project "${projectId}"`;
    } else if (errorMessage.includes('NOT_FOUND') || err?.code === 5) {
      errorMessage = `ไม่พบข้อมูล Metrics บนโปรเจกต์ "${projectId}" หรือยังไม่ได้เปิดใช้งาน Cloud Monitoring API`;
    } else if (errorMessage.includes('Could not load the default credentials') || errorMessage.includes('credentials')) {
      errorMessage = `ระบบยังไม่สามารถเข้าถึง Google Cloud Default Credentials สำหรับ Cloud Monitoring หรือ Service Account ยังไม่ได้รับสิทธิ์ Monitoring Viewer บน "${projectId}"`;
    }
    
    throw new functions.https.HttpsError(
      'failed-precondition',
      errorMessage
    );
  }
});


/* ============================================================================
 * PHASE 1 — Role / Department-based authorization support
 * ==========================================================================*/

const isElevatedRole = (role?: unknown): boolean =>
  typeof role === 'string' && ELEVATED_ROLES.includes(role);

/**
 * Resolve the department name(s) an entity belongs to, from the current app doc.
 * Returns [] when the department cannot be determined (caller must treat that as
 * "deny" for assistant-scoped writes).
 */
function resolveEntityDepartments(type: AssistantEntityType, entity: any, appDoc: Record<string, any>): string[] {
  const teachers: any[] = Array.isArray(appDoc.teachers) ? appDoc.teachers : [];
  const subjects: any[] = Array.isArray(appDoc.subjects) ? appDoc.subjects : [];
  const assignments: any[] = Array.isArray(appDoc.teacherSubjectAssignments) ? appDoc.teacherSubjectAssignments : [];
  const deptOfTeacher = (teacherId: string): string[] => {
    const t = teachers.find((x) => x.id === teacherId);
    return t?.department ? [String(t.department)] : [];
  };

  switch (type) {
    case 'teachers':
      return entity?.department ? [String(entity.department)] : [];
    case 'subjects': {
      if (entity?.department) return [String(entity.department)];
      const depts = new Set<string>();
      for (const a of assignments.filter((a) => a.subjectId === entity?.id)) {
        deptOfTeacher(a.teacherId).forEach((d) => depts.add(d));
      }
      return [...depts];
    }
    case 'teacherSubjectAssignments':
      return entity?.teacherId ? deptOfTeacher(entity.teacherId) : [];
    case 'scheduleEntries': {
      const depts = new Set<string>();
      const subj = subjects.find((s) => s.id === entity?.subjectId);
      if (subj?.department) depts.add(String(subj.department));
      for (const tid of Array.isArray(entity?.teacherIds) ? entity.teacherIds : []) {
        deptOfTeacher(tid).forEach((d) => depts.add(d));
      }
      return [...depts];
    }
    default:
      return [];
  }
}

/**
 * Callable Function: backfillUserClaims
 * One-time, idempotent migration. Ensures EVERY existing Firebase Auth user has
 * `orgId` and `assignedDepartments` custom claims alongside their existing `role`.
 * MUST be run (and verified) before deploying Firestore Rules that authorize on
 * `orgId`, otherwise every not-yet-migrated account is locked out.
 * Admin-only. Pass { dryRun: true } to preview without writing.
 */
export const backfillUserClaims = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (
    data: { orgId?: string; dryRun?: boolean },
    context: functions.https.CallableContext
  ) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    const callerEmail = context.auth.token.email?.toLowerCase().trim();
    const callerRole = context.auth.token.role;
    const isCallerAdmin = callerRole === 'admin' || callerEmail === BOOTSTRAP_ADMIN_EMAIL || callerEmail === 'kiattika@utd.ac.th';
    if (!callerEmail?.endsWith(DOMAIN)) {
      throw new functions.https.HttpsError('permission-denied', `Access restricted to ${DOMAIN} domain.`);
    }
    if (!isCallerAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Only administrators can run the claims backfill.');
    }

    const orgId = (data?.orgId || DEFAULT_ORG_ID).replace(/[^a-zA-Z0-9_-]/g, '');
    const dryRun = data?.dryRun === true;
    const auth = getAuth();
    const db = getDb();

    // Department assignments currently recorded in the app document's users array.
    const appSnap = await db.doc(`apps/${orgId}`).get();
    const appUsers: any[] = appSnap.exists && Array.isArray(appSnap.data()?.users) ? appSnap.data()!.users : [];
    const deptByEmail = new Map<string, string[]>();
    for (const u of appUsers) {
      const email = u?.email?.toLowerCase?.().trim();
      if (email && Array.isArray(u.assignedDepartments)) {
        deptByEmail.set(email, u.assignedDepartments.filter((d: any) => typeof d === 'string' && d.trim()));
      }
    }

    let total = 0;
    let updated = 0;
    let alreadyCompliant = 0;
    const updatedEmails: string[] = [];
    let pageToken: string | undefined;

    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const user of page.users) {
        total++;
        const claims: Record<string, any> = user.customClaims || {};
        const email = user.email?.toLowerCase().trim() || '';
        const desiredRole = typeof claims.role === 'string' ? claims.role : 'guest';
        const desiredDepartments = desiredRole === 'assistant'
          ? (deptByEmail.get(email) || (Array.isArray(claims.assignedDepartments) ? claims.assignedDepartments : []))
          : [];

        const needsOrgId = claims.orgId !== orgId;
        const needsRole = typeof claims.role !== 'string';
        const needsDepartments =
          JSON.stringify(claims.assignedDepartments ?? null) !== JSON.stringify(desiredDepartments);

        if (!needsOrgId && !needsRole && !needsDepartments) {
          alreadyCompliant++;
          continue;
        }

        updatedEmails.push(email || user.uid);
        if (!dryRun) {
          await auth.setCustomUserClaims(user.uid, {
            ...claims,
            role: desiredRole,
            orgId,
            assignedDepartments: desiredDepartments
          });
        }
        updated++;
      }
      pageToken = page.pageToken;
    } while (pageToken);

    console.log(`[MIGRATION] backfillUserClaims by '${callerEmail}' dryRun=${dryRun}: total=${total} updated=${updated} alreadyCompliant=${alreadyCompliant}`);

    return {
      success: true,
      dryRun,
      orgId,
      totalUsers: total,
      updatedCount: updated,
      alreadyCompliant,
      updatedEmails
    };
  });

/**
 * Callable Function: registerCurrentUser
 * First-login self-registration. Adds the caller to apps/{orgId}.users with role
 * 'guest' when absent. Replaces the previous client-side saveAppData() call in
 * useAppAuth, which the new Firestore Rules block for non-manager roles.
 */
export const registerCurrentUser = functions.https.onCall(async (
  data: { orgId?: string; name?: string },
  context: functions.https.CallableContext
) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const email = context.auth.token.email?.toLowerCase().trim();
  if (!email?.endsWith(DOMAIN)) {
    throw new functions.https.HttpsError('permission-denied', `Access restricted to ${DOMAIN} domain.`);
  }

  const orgId = (data?.orgId || DEFAULT_ORG_ID).replace(/[^a-zA-Z0-9_-]/g, '');
  const uid = context.auth.uid;
  const tokenName = context.auth.token.name;
  const db = getDb();
  const appDocRef = db.doc(`apps/${orgId}`);

  // Baseline self-claim: grant a brand-new account { role: 'guest', orgId } so the
  // new Firestore Rules (which authorize reads on orgId) let them load the app in
  // read-only mode. Never downgrade or overwrite an account that already has a
  // role claim — only setUserRole / bootstrapAdmin manage those.
  let claimAction: 'granted-guest' | 'unchanged' = 'unchanged';
  try {
    const auth = getAuth();
    const record = await auth.getUser(uid);
    const claims: Record<string, any> = record.customClaims || {};
    if (typeof claims.role !== 'string' || claims.orgId !== orgId) {
      await auth.setCustomUserClaims(uid, {
        ...claims,
        role: typeof claims.role === 'string' ? claims.role : 'guest',
        orgId,
        assignedDepartments: Array.isArray(claims.assignedDepartments) ? claims.assignedDepartments : []
      });
      claimAction = 'granted-guest';
    }
  } catch (e: any) {
    console.warn('registerCurrentUser claim notice:', e?.message || e);
  }

  // NOTE: no runTransaction() — see assistantUpdateEntity. A plain read + atomic
  // arrayUnion is enough here: the only race is two first-logins for the SAME
  // account at the same instant, and arrayUnion de-dupes the identical records.
  const snap = await appDocRef.get();
  let result: { created: boolean; reason?: string; role?: string };
  if (!snap.exists) {
    result = { created: false, reason: 'no-app-doc' };
  } else {
    const appData = snap.data() || {};
    const users: any[] = Array.isArray(appData.users) ? appData.users : [];
    const found = users.find((u: any) => u.email?.toLowerCase().trim() === email);
    if (found) {
      result = { created: false, reason: 'already-registered', role: found.role };
    } else {
      await appDocRef.update({
        users: FieldValue.arrayUnion({
          id: uid,
          name: String(data?.name || tokenName || email.split('@')[0]).slice(0, 120),
          email,
          role: 'guest',
          organizationId: orgId
        })
      });
      result = { created: true, role: 'guest' };
    }
  }

  console.log(`[AUDIT] registerCurrentUser '${email}': claim=${claimAction} ${JSON.stringify(result)}`);
  return { success: true, claimAction, ...result };
});

// Defensive internal deadline. The core operation below is now non-transactional
// (a few fast doc reads/writes), so this should never fire in practice — it is a
// backstop that converts any future hang into an immediate, clear error instead
// of a silent 60s platform timeout with no user feedback.
const ASSISTANT_UPDATE_DEADLINE_MS = 15000;

/**
 * Callable Function: assistantUpdateEntity
 * Department-scoped write channel for assistant-role users. The new Firestore
 * Rules block assistants from writing apps/{appId} (and its subcollections)
 * directly, so their edits to teachers / subjects / teacherSubjectAssignments /
 * scheduleEntries are routed here. The server-side department check below IS the
 * security boundary — the Admin SDK write bypasses Firestore Rules.
 *
 * IMPORTANT — no runTransaction():
 * `apps/{orgId}` is a single monolithic document. Under the client autosave
 * retry pattern, concurrent `runTransaction()` calls all serialize on that one
 * document's lock; each `tx.get()` then blocks up to Firestore's ~60s lock
 * timeout and the whole thing snowballs (see git history for the trace). So list
 * mutations here use atomic, lock-free field transforms instead:
 *   - create -> FieldValue.arrayUnion (idempotent on client retries)
 *   - delete -> FieldValue.arrayRemove
 *   - update -> optimistic read + `lastUpdateTime` precondition + bounded retry
 * Fully contention-free writes are a Phase 2 concern (subcollection migration).
 */
export const assistantUpdateEntity = functions.https.onCall(async (
  data: { type: AssistantEntityType; op: 'create' | 'update' | 'delete'; payload?: any; id?: string; orgId?: string },
  context: functions.https.CallableContext
) => {
  const traceId = randomUUID().slice(0, 8);
  const t0 = Date.now();
  const finish = (outcome: string) =>
    console.log(`[assistantUpdateEntity:${traceId}] ${outcome} — ${data?.op} ${data?.type} (${Date.now() - t0}ms)`);

  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const email = context.auth.token.email?.toLowerCase().trim();
  const role = typeof context.auth.token.role === 'string' ? context.auth.token.role : 'guest';
  const claimOrgId = context.auth.token.orgId;
  const assignedDepartments: string[] = Array.isArray(context.auth.token.assignedDepartments)
    ? (context.auth.token.assignedDepartments as any[]).filter((d) => typeof d === 'string')
    : [];

  if (!email?.endsWith(DOMAIN)) {
    throw new functions.https.HttpsError('permission-denied', `Access restricted to ${DOMAIN} domain.`);
  }
  const isAssistant = role === 'assistant';
  if (!isAssistant && !isElevatedRole(role)) {
    throw new functions.https.HttpsError('permission-denied', 'Requires assistant role or higher.');
  }

  const type = data?.type;
  const op = data?.op;
  if (!ASSISTANT_ENTITY_TYPES.includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', `Unsupported entity type: ${type}`);
  }
  if (!['create', 'update', 'delete'].includes(op as string)) {
    throw new functions.https.HttpsError('invalid-argument', `Unsupported op: ${op}`);
  }

  const orgId = (data?.orgId || DEFAULT_ORG_ID).replace(/[^a-zA-Z0-9_-]/g, '');
  if (claimOrgId && claimOrgId !== orgId) {
    throw new functions.https.HttpsError('permission-denied', 'Organization mismatch.');
  }

  const payload = data?.payload && typeof data.payload === 'object' ? { ...data.payload } : {};
  const entityId = op === 'create' ? (payload.id || randomUUID()) : (data?.id || payload.id);
  if (op !== 'create' && !entityId) {
    throw new functions.https.HttpsError('invalid-argument', 'id is required for update/delete.');
  }
  payload.id = entityId;

  const db = getDb();
  const appDocRef = db.doc(`apps/${orgId}`);
  const subDocRef = type === 'scheduleEntries'
    ? db.doc(`apps/${orgId}/scheduleEntries/${entityId}`)
    : null;

  const listOf = (appDoc: Record<string, any>): any[] =>
    Array.isArray(appDoc[type]) ? appDoc[type] : [];

  // Department authorization against a plain (non-transactional, lock-free) read.
  const authorize = (appDoc: Record<string, any>, existing: any, effectiveOp: 'create' | 'update' | 'delete') => {
    if (!isAssistant) return;
    if (assignedDepartments.length === 0) {
      throw new functions.https.HttpsError('permission-denied', 'No departments assigned to this account.');
    }
    const covers = (depts: string[]) => depts.length > 0 && depts.every((d) => assignedDepartments.includes(d));
    if (effectiveOp !== 'create') {
      const currentDepts = resolveEntityDepartments(type, existing, appDoc);
      if (!covers(currentDepts)) {
        throw new functions.https.HttpsError(
          'permission-denied',
          `Entity belongs to a department outside your assignment (${currentDepts.join(', ') || 'unknown'}).`
        );
      }
    }
    if (effectiveOp !== 'delete') {
      const nextDepts = resolveEntityDepartments(type, { ...existing, ...payload }, appDoc);
      if (!covers(nextDepts)) {
        throw new functions.https.HttpsError(
          'permission-denied',
          `Target department is outside your assignment (${nextDepts.join(', ') || 'unknown'}).`
        );
      }
    }
  };

  const core = async (): Promise<{ entity: any }> => {
    const snap = await appDocRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', `apps/${orgId} does not exist.`);
    }
    const appDoc = snap.data() || {};
    const existing = listOf(appDoc).find((e) => e && e.id === entityId);
    if (op !== 'create' && !existing) {
      throw new functions.https.HttpsError('not-found', `${type}/${entityId} not found.`);
    }
    // A client retry of a create that already landed becomes an idempotent update.
    const effectiveOp: 'create' | 'update' | 'delete' =
      op === 'create' && existing ? 'update' : op;
    authorize(appDoc, existing, effectiveOp);

    if (effectiveOp === 'delete') {
      await appDocRef.update({ [type]: FieldValue.arrayRemove(existing) });
      if (subDocRef) await subDocRef.delete();
      return { entity: null };
    }

    if (effectiveOp === 'create') {
      // Atomic append — concurrent arrayUnion transforms do not lock or abort.
      await appDocRef.update({ [type]: FieldValue.arrayUnion(payload) });
      if (subDocRef) await subDocRef.set(payload, { merge: true });
      return { entity: payload };
    }

    // effectiveOp === 'update' — optimistic concurrency, bounded retry, no lock.
    let attemptSnap = snap;
    let attemptDoc = appDoc;
    let attemptExisting = existing;
    for (let attempt = 0; attempt < 5; attempt++) {
      const merged = { ...attemptExisting, ...payload };
      const nextList = listOf(attemptDoc).map((e) => (e && e.id === entityId ? merged : e));
      try {
        await appDocRef.update({ [type]: nextList }, { lastUpdateTime: attemptSnap.updateTime });
        if (subDocRef) await subDocRef.set(merged, { merge: true });
        return { entity: merged };
      } catch (err: any) {
        // 9 = FAILED_PRECONDITION, 10 = ABORTED — doc changed under us; re-read and retry.
        if ((err?.code === 9 || err?.code === 10) && attempt < 4) {
          await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
          attemptSnap = await appDocRef.get();
          if (!attemptSnap.exists) {
            throw new functions.https.HttpsError('not-found', `apps/${orgId} disappeared during update.`);
          }
          attemptDoc = attemptSnap.data() || {};
          attemptExisting = listOf(attemptDoc).find((e) => e && e.id === entityId);
          if (!attemptExisting) {
            throw new functions.https.HttpsError('not-found', `${type}/${entityId} was removed during update.`);
          }
          authorize(attemptDoc, attemptExisting, 'update');
          continue;
        }
        throw err;
      }
    }
    throw new functions.https.HttpsError('aborted', 'Could not save due to concurrent edits — please try again.');
  };

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new functions.https.HttpsError(
        'deadline-exceeded',
        'Operation timed out — please try again or contact an admin.'
      )),
      ASSISTANT_UPDATE_DEADLINE_MS
    );
  });

  let outcome: { entity: any };
  try {
    outcome = await Promise.race([core(), deadline]);
  } catch (err: any) {
    finish(`FAILED code=${err?.code ?? '?'} ${err?.message || err}`);
    if (err instanceof functions.https.HttpsError) throw err;
    throw new functions.https.HttpsError('internal', err?.message || 'assistantUpdateEntity failed.');
  } finally {
    if (timer) clearTimeout(timer);
  }

  // Best-effort audit log.
  try {
    const logId = randomUUID();
    await db.doc(`apps/${orgId}/activityLogs/${logId}`).set({
      id: logId,
      timestamp: new Date().toISOString(),
      action: op === 'create' ? 'Added' : op === 'delete' ? 'Removed' : 'Updated',
      description: `${op} ${type} (${entityId}) via assistant channel`,
      user: email,
      details: `role=${role}`
    });
  } catch (e: any) {
    console.warn(`[assistantUpdateEntity:${traceId}] activity log notice:`, e?.message || e);
  }

  finish('SUCCESS');
  return { success: true, type, op, id: entityId, ...outcome };
});


