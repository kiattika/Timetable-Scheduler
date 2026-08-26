import { doc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from './firebase';
import { ActivityLog, ActivityLogAction, AppErrorLog } from '../types';

export const DEFAULT_ORG_ID = import.meta.env.VITE_ORG_ID || 'utd';

/**
 * Record an activity log entry to Firestore subcollection `apps/{orgId}/activityLogs/{logId}`.
 * For in-domain authenticated modifications (Added, Updated, Removed, Cleared).
 * Gracefully handles offline or unauthenticated situations without throwing.
 */
export const logActivity = async (
  action: ActivityLogAction,
  description: string,
  user?: string,
  details?: string,
  orgId: string = DEFAULT_ORG_ID
): Promise<ActivityLog | null> => {
  const logId = crypto.randomUUID();
  const logEntry: ActivityLog = {
    id: logId,
    timestamp: new Date().toISOString(),
    action,
    description: String(description || '').slice(0, 500),
    user: String(user || auth.currentUser?.email || auth.currentUser?.displayName || 'Unknown User').slice(0, 100),
    details: details ? String(details).slice(0, 1000) : undefined
  };

  try {
    const logDocRef = doc(db, 'apps', orgId, 'activityLogs', logId);
    await setDoc(logDocRef, logEntry, { merge: true });
    return logEntry;
  } catch (err: any) {
    console.warn('Notice: Failed to write activity log to Firestore:', err?.message || err);
    return logEntry;
  }
};

/**
 * Record a login event (Logged In or Login Failed) securely via Cloud Function.
 * Bypasses direct client-side Firestore rules safely via Admin SDK with rate limiting.
 */
export const logLoginAttempt = async (
  status: 'success' | 'failed',
  email: string,
  reason?: string,
  role?: string,
  orgId: string = DEFAULT_ORG_ID
): Promise<ActivityLog | null> => {
  const action: ActivityLogAction = status === 'success' ? 'Logged In' : 'Login Failed';
  const cleanEmail = email ? email.toLowerCase().trim() : 'Unknown';
  
  let description = '';
  if (status === 'success') {
    description = `User logged into the application (${role || 'user'})`;
  } else {
    description = `Login attempt failed for ${cleanEmail}: ${reason || 'Authentication denied'}`;
  }

  const fallbackLogEntry: ActivityLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    description,
    user: cleanEmail,
    details: reason ? `Reason: ${reason}` : undefined
  };

  try {
    const logFn = httpsCallable<
      { status: 'success' | 'failed'; email: string; reason?: string; role?: string; orgId: string },
      { success: boolean; id: string; log?: ActivityLog }
    >(functions, 'logLoginAttempt');

    const res = await logFn({
      status,
      email: cleanEmail,
      reason: reason ? String(reason).slice(0, 300) : undefined,
      role: role ? String(role).slice(0, 50) : undefined,
      orgId
    });

    if (res?.data?.log) {
      return res.data.log;
    }
    return fallbackLogEntry;
  } catch (err: any) {
    console.warn('Notice: logLoginAttempt via Cloud Function fallback:', err?.message || err);
    return fallbackLogEntry;
  }
};

/**
 * Record an unhandled application error to Firestore subcollection `apps/{orgId}/errors/{errorId}`.
 * Sanitizes payload and caps max length to prevent oversized documents.
 */
export const logAppError = async (
  error: Error | string,
  info?: {
    componentStack?: string;
    url?: string;
    userEmail?: string;
    userName?: string;
    details?: string;
  },
  orgId: string = DEFAULT_ORG_ID
): Promise<AppErrorLog | null> => {
  const errorId = crypto.randomUUID();
  const message = typeof error === 'string' ? error.slice(0, 1000) : (error?.message || 'Unknown Application Error').slice(0, 1000);
  const stack = typeof error === 'object' && error?.stack ? error.stack.slice(0, 2000) : undefined;
  const currentUrl = typeof window !== 'undefined' ? window.location.href.slice(0, 500) : undefined;

  const errorEntry: AppErrorLog = {
    id: errorId,
    message,
    stack,
    timestamp: new Date().toISOString(),
    userEmail: info?.userEmail ? info.userEmail.slice(0, 100) : (auth.currentUser?.email || undefined),
    userName: info?.userName ? info.userName.slice(0, 100) : (auth.currentUser?.displayName || undefined),
    url: info?.url ? info.url.slice(0, 500) : currentUrl,
    componentStack: info?.componentStack ? info.componentStack.slice(0, 2000) : undefined,
    details: info?.details ? info.details.slice(0, 1000) : undefined
  };

  try {
    const errorDocRef = doc(db, 'apps', orgId, 'errors', errorId);
    await setDoc(errorDocRef, errorEntry, { merge: true });
    return errorEntry;
  } catch (err: any) {
    console.warn('Notice: Failed to write error log to Firestore:', err?.message || err);
    return errorEntry;
  }
};
