/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
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

// Single-flight guard for the redirect sign-in. `signInWithRedirect` navigates
// the whole page away, so a second attempt can't normally race it — this guards
// against a rapid double-click before navigation and a stale flag if the
// redirect fails to start.
const SIGNIN_PENDING_KEY = 'authSignInPending';
const SIGNIN_ERROR_KEY = 'authRedirectError';
let signInStarting = false;

/** Read + clear a sign-in error stashed before the redirect navigated away. */
export const takeRedirectSignInError = (): string | null => {
  if (typeof window === 'undefined') return null;
  const e = sessionStorage.getItem(SIGNIN_ERROR_KEY);
  if (e) sessionStorage.removeItem(SIGNIN_ERROR_KEY);
  return e;
};

/**
 * Start Google sign-in via a full-page redirect (NOT a popup).
 * `signInWithPopup` is broken by Chrome's Cross-Origin-Opener-Policy: the SDK
 * polls the cross-origin popup's `window.closed`, which COOP now blocks, so the
 * popup handshake never completes and the Firestore auth token never propagates
 * (every read then fails `permission-denied`). Redirect avoids popup monitoring
 * entirely — the credential is exchanged on the return trip via
 * `completeRedirectSignIn()`.
 */
export const googleSignIn = async (): Promise<void> => {
  if (signInStarting) return;
  if (typeof window !== 'undefined') {
    const pendingAt = Number(sessionStorage.getItem(SIGNIN_PENDING_KEY) || 0);
    // Honour the flag only if it's recent; otherwise it's stale (a redirect that
    // never came back) and we should let the user try again.
    if (pendingAt && Date.now() - pendingAt < 120000) return;
  }
  signInStarting = true;
  try {
    if (typeof window !== 'undefined') sessionStorage.setItem(SIGNIN_PENDING_KEY, String(Date.now()));
    await signInWithRedirect(auth, provider);
    // Page navigates away here — nothing below runs on success.
  } catch (error: any) {
    signInStarting = false;
    if (typeof window !== 'undefined') sessionStorage.removeItem(SIGNIN_PENDING_KEY);
    console.error('signInWithRedirect failed to start:', error);
    logLoginAttempt('failed', auth.currentUser?.email || '', error?.message || 'Redirect sign-in could not start');
    throw error;
  }
};

/**
 * Complete a redirect sign-in on app startup. Resolves to the signed-in user +
 * Google access token when we've just returned from Google, or `null` otherwise.
 * Enforces the @utd.ac.th domain (signs out + throws on a foreign account).
 */
export const completeRedirectSignIn = async (): Promise<{ user: User; accessToken: string | null } | null> => {
  if (typeof window !== 'undefined') sessionStorage.removeItem(SIGNIN_PENDING_KEY);
  signInStarting = false;
  try {
    const result = await getRedirectResult(auth);
    if (!result) return null;

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
    console.error('Redirect sign-in completion error:', error);
    if (!error.message?.includes('ของโรงเรียนอุตรดิตถ์เท่านั้น')) {
      logLoginAttempt('failed', auth.currentUser?.email || '', error?.message || 'Redirect sign-in error');
    }
    // Stash for LoginScreen to show on the next render (we can't surface it
    // synchronously — the redirect already navigated away from that component).
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SIGNIN_ERROR_KEY, error?.message || 'เข้าสู่ระบบไม่สำเร็จ');
    }
    throw error;
  }
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  // Process a pending redirect result before/independently of the state listener.
  // Errors are handled+logged inside; onAuthStateChanged below still fires with
  // the user and is the single source of truth for propagating auth into React.
  completeRedirectSignIn().catch(() => {});

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
  if (typeof window !== 'undefined') sessionStorage.removeItem(SIGNIN_PENDING_KEY);
  signInStarting = false;
  await auth.signOut();
  cachedAccessToken = null;
  if (typeof window !== 'undefined') localStorage.removeItem('googleAccessToken');
};
