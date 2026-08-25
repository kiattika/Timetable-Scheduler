import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
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
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerEmail = context.auth.token.email?.toLowerCase().trim();
  const callerRole = context.auth.token.role;

  // Domain guard: Must be @utd.ac.th
  if (!callerEmail?.endsWith('@utd.ac.th')) {
    throw new functions.https.HttpsError('permission-denied', 'Access restricted to @utd.ac.th domain.');
  }

  // Admin guard: Caller must be admin or bootstrap admin
  const isCallerAdmin = callerRole === 'admin' || callerEmail === BOOTSTRAP_ADMIN_EMAIL;
  if (!isCallerAdmin) {
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
    const userRecord = await admin.auth().getUserByEmail(cleanTargetEmail);
    
    // Set custom user claims
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role,
      orgId
    });

    // Update Firestore document record if exists
    const appDocRef = admin.firestore().doc(`apps/${orgId}`);
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
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerEmail = context.auth.token.email?.toLowerCase().trim();
  if (!callerEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'No email associated with account.');
  }

  // Check if caller matches bootstrap admin email
  if (callerEmail !== BOOTSTRAP_ADMIN_EMAIL && callerEmail !== 'kiattika@utd.ac.th') {
    throw new functions.https.HttpsError('permission-denied', 'Only designated initial administrators can bootstrap.');
  }

  try {
    await admin.auth().setCustomUserClaims(context.auth.uid, {
      role: 'admin',
      orgId: DEFAULT_ORG_ID
    });

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
 * Runs daily at midnight to delete activity logs older than 90 days from the subcollection.
 */
export const cleanupOldActivityLogs = functions.pubsub.schedule('every 24 hours').onRun(async () => {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const db = admin.firestore();

  try {
    const logsRef = db.collection(`apps/${DEFAULT_ORG_ID}/activityLogs`);
    const snapshot = await logsRef.where('timestamp', '<', ninetyDaysAgo).get();

    if (snapshot.empty) {
      console.log('No expired activity logs to clean.');
      return null;
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`Successfully purged ${snapshot.size} expired activity logs.`);
    return null;
  } catch (error) {
    console.error('Error cleaning old activity logs:', error);
    return null;
  }
});

