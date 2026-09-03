/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { logLoginAttempt } from './logger';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  firestoreDatabaseId: (import.meta.env.VITE_FIREBASE_DATABASE_ID === '(default)' || import.meta.env.VITE_FIREBASE_DATABASE_ID === 'none' || !import.meta.env.VITE_FIREBASE_DATABASE_ID) ? '' : import.meta.env.VITE_FIREBASE_DATABASE_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);

// ตรวจสอบค่า dbId แบบเข้มงวด ถ้าไม่มีค่าจริง หรือเป็นค่าลวง ให้บังคับใช้ Default ตัวหลักทันที
const dbId = import.meta.env.VITE_FIREBASE_DATABASE_ID;
const isValidDbId = dbId && dbId !== '(default)' && dbId !== 'none' && dbId !== 'Secret value' && String(dbId).trim() !== '';

export const db = isValidDbId
  ? initializeFirestore(app, { experimentalForceLongPolling: true }, String(dbId).trim())
  : initializeFirestore(app, { experimentalForceLongPolling: true });

export const functions = getFunctions(app);

export const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ 
  prompt: 'consent',
  hd: 'utd.ac.th'
});

let cachedAccessToken: string | null = null;
if (typeof window !== 'undefined') {
  cachedAccessToken = localStorage.getItem('googleAccessToken');
}

// Single-flight guard: only one sign-in popup in flight at a time. In-memory is
// enough — `signInWithPopup` does not navigate the page away.
let signInInProgress = false;

/**
 * Google sign-in via a POPUP (Firebase Auth's own `signInWithPopup`).
 *
 * NOT `signInWithRedirect`: that flow relies on a cross-origin iframe to
 * `<project>.firebaseapp.com` whose sessionStorage is unreachable in a
 * storage-partitioned browser (Firefox 109+, Safari 16.1+, Chrome M115+),
 * producing "Unable to process request due to missing initial state". This app
 * is NOT on Firebase Hosting, so the custom-authDomain fix isn't available —
 * `signInWithPopup` is Firebase's recommended workaround (Option 2), and it is
 * not affected by storage partitioning (real top-level popup window, result
 * delivered via window.opener postMessage).
 *
 * A benign `"Cross-Origin-Opener-Policy policy would block the window.closed
 * call"` console warning may appear from inside the SDK — it only affects fast
 * detection of a user-closed popup; the happy path completes via the iframe
 * result. Any real post-sign-in `permission-denied` on Firestore is handled by
 * the retrying listeners in useAppAuth (added for the token-propagation race).
 */
export const googleSignIn = async (): Promise<{ user: User; accessToken: string | null } | null> => {
  if (signInInProgress) return null;
  signInInProgress = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const email = (result.user.email || '').toLowerCase().trim();
    if (!email.endsWith('@utd.ac.th')) {
      await logLoginAttempt('failed', email, 'Unauthorized domain (Must be @utd.ac.th)');
      await auth.signOut();
      throw new Error('เข้าสู่ระบบได้เฉพาะบัญชี @utd.ac.th ของโรงเรียนอุตรดิตถ์เท่านั้น');
    }

    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken || null;
    if (cachedAccessToken && typeof window !== 'undefined') {
      localStorage.setItem('googleAccessToken', cachedAccessToken);
    }
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    // popup-closed-by-user / cancelled-popup-request are user actions, not faults.
    const code = error?.code || '';
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      console.error('Sign in error:', error);
      if (!error.message?.includes('ของโรงเรียนอุตรดิตถ์เท่านั้น')) {
        logLoginAttempt('failed', auth.currentUser?.email || '', error?.message || 'Popup sign-in error');
      }
    }
    throw error;
  } finally {
    signInInProgress = false;
  }
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (!user) {
      cachedAccessToken = null;
      if (typeof window !== 'undefined') localStorage.removeItem('googleAccessToken');
      if (onAuthFailure) onAuthFailure();
      return;
    }

    const email = (user.email || '').toLowerCase().trim();
    if (!email.endsWith('@utd.ac.th')) {
      await auth.signOut();
      if (typeof window !== 'undefined') localStorage.removeItem('googleAccessToken');
      if (onAuthFailure) onAuthFailure();
      return;
    }

    // Valid @utd.ac.th user — ALWAYS propagate, even mid-sign-in and even if the
    // Google access token has not resolved yet. The token is only used for the
    // optional Sheets import/export and arrives separately via handleLoginSuccess.
    // The old code skipped this branch while a popup sign-in was in progress and
    // no token was cached yet, so onAuthStateChanged firing during the popup
    // handshake left the UI stuck on the login gate until a manual refresh.
    if (!cachedAccessToken && typeof window !== 'undefined') {
      cachedAccessToken = localStorage.getItem('googleAccessToken');
    }
    if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
  });
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  signInInProgress = false;
  await auth.signOut();
  cachedAccessToken = null;
  if (typeof window !== 'undefined') localStorage.removeItem('googleAccessToken');
};
