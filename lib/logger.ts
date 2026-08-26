import { doc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { ActivityLog, ActivityLogAction, AppErrorLog } from '../types';

export const DEFAULT_ORG_ID = import.meta.env.VITE_ORG_ID || 'utd';

/**
 * Record an activity log entry to Firestore subcollection `apps/{orgId}/activityLogs/{logId}`.
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
    description,
    user: user || auth.currentUser?.email || auth.currentUser?.displayName || 'Unknown User',
    details: details || undefined
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
 * Record a login event (Logged In or Login Failed)
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

  return logActivity(action, description, cleanEmail, reason ? `Reason: ${reason}` : undefined, orgId);
};

/**
 * Record an unhandled application error to Firestore subcollection `apps/{orgId}/errors/{errorId}`.
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
  const message = typeof error === 'string' ? error : error?.message || 'Unknown Application Error';
  const stack = typeof error === 'object' && error?.stack ? error.stack.slice(0, 2000) : undefined;
  const currentUrl = typeof window !== 'undefined' ? window.location.href : undefined;

  const errorEntry: AppErrorLog = {
    id: errorId,
    message,
    stack,
    timestamp: new Date().toISOString(),
    userEmail: info?.userEmail || auth.currentUser?.email || undefined,
    userName: info?.userName || auth.currentUser?.displayName || undefined,
    url: info?.url || currentUrl,
    componentStack: info?.componentStack?.slice(0, 2000),
    details: info?.details
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
