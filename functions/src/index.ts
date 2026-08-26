import * as functions from 'firebase-functions/v1';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { MetricServiceClient } from '@google-cloud/monitoring';

if (!getApps().length) {
  initializeApp();
}

const DEFAULT_ORG_ID = process.env.VITE_ORG_ID || 'utd';
const BOOTSTRAP_ADMIN_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@utd.ac.th').toLowerCase().trim();

/**
 * Callable Function: setUserRole
 * Allows existing Admins to assign roles via Firebase Auth Custom Claims.
 */
export const setUserRole = functions.https.onCall(async (data: { targetEmail: string; role: string; orgId?: string }, context: functions.https.CallableContext) => {
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
  const isCallerAdmin = callerRole === 'admin' || callerEmail === BOOTSTRAP_ADMIN_EMAIL;
  if (!isCallerAdmin) {
    console.warn(`[SECURITY] Unauthorized access attempt to setUserRole by non-admin '${callerEmail}' (Role: ${callerRole || 'none'}) at ${new Date().toISOString()}`);
    throw new functions.https.HttpsError('permission-denied', 'Only administrators can change user roles.');
  }

  const { targetEmail, role, orgId = DEFAULT_ORG_ID } = data;

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
    const userRecord = await auth.getUserByEmail(cleanTargetEmail);
    
    // Set custom user claims
    await auth.setCustomUserClaims(userRecord.uid, {
      role,
      orgId
    });

    // Update Firestore document record if exists
    const db = getFirestore();
    const appDocRef = db.doc(`apps/${orgId}`);
    const appSnap = await appDocRef.get();
    if (appSnap.exists) {
      const appData = appSnap.data() || {};
      const users: any[] = appData.users || [];
      const userIndex = users.findIndex((u: any) => u.email?.toLowerCase() === cleanTargetEmail);
      
      if (userIndex >= 0) {
        users[userIndex].role = role;
      } else {
        users.push({
          id: userRecord.uid,
          name: userRecord.displayName || cleanTargetEmail.split('@')[0],
          email: cleanTargetEmail,
          role,
          organizationId: orgId
        });
      }

      await appDocRef.update({ users });
    }

    console.log(`[AUDIT] Role '${role}' successfully assigned to '${cleanTargetEmail}' by '${callerEmail}' at ${new Date().toISOString()}`);

    return {
      success: true,
      message: `Successfully set role '${role}' for ${cleanTargetEmail}`
    };
  } catch (error: any) {
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
      orgId: DEFAULT_ORG_ID
    });

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
 * Scheduled Cloud Function: cleanupOldActivityLogs
 * Runs daily at midnight to delete activity logs and error reports older than 90 days.
 */
export const cleanupOldActivityLogs = functions.pubsub.schedule('every 24 hours').onRun(async () => {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const db = getFirestore();

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

  // Helper to format Date to YYYY-MM-DD
  const formatDateKey = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
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


