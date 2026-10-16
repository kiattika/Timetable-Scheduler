import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import { fetchAppData, registerCurrentUser, safeUpsert, DEFAULT_DEPARTMENTS, DEFAULT_RESOURCE_TYPES, ORG_ID, normalizeLoadedSubjects, normalizeLoadedOrganizationSettings, reconcileServerWithLocal } from '../api';
import { AppData, User, ScheduleEntry, ActivityLog, Teacher } from '../types';
import { db, auth } from '../lib/firebase';
import { doc, collection, onSnapshot, query, orderBy, limit, type Query, type DocumentReference } from 'firebase/firestore';
import { DEFAULT_PERIOD_SETTINGS } from '../constants';
import { logActivity, logLoginAttempt } from '../lib/logger';
import { READ_FLIP_ENTITY_FIELDS, PERIOD_SETTINGS_DOC_ID, resolveEntityList, resolvePeriodSettings, resolveReadFlip, readLocalReadFlip, setActiveReadFlip } from '../lib/subcollectionReads';

// Phase 2 read-flip switch. OFF by default: the app reads the entity arrays from the
// monolithic apps/{orgId} doc exactly as before. It can be turned on (see resolveReadFlip):
//   1. per browser  — button in System Health (localStorage), or
//   2. system-wide  — button in System Health (organizationSettings.readFromSubcollections), or
//   3. at build     — VITE_READ_FROM_SUBCOLLECTIONS=true.
// The choice is made ONCE per page load, at the first main-doc snapshot; changing it later needs a reload.
const READ_FROM_SUBCOLLECTIONS_BUILD = (import.meta as any).env?.VITE_READ_FROM_SUBCOLLECTIONS === 'true';

export const useAppAuth = (
  appData: AppData | null,
  setAppData: (data: AppData | ((prev: AppData | null) => AppData | null)) => void,
  setIsDataLoaded: (val: boolean) => void,
  setCurrentView: (view: any) => void,
  lastSavedDataStrRef?: MutableRefObject<string | null>
) => {
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('googleAccessToken');
    }
    return null;
  });
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(false);
  // Set when all `permission-denied` retries on the initial data load are
  // exhausted — App shows a "reload" error instead of a silent stuck login gate.
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const recordedLoginSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (isAuthChecking) return;
    let isMounted = true;
    let unsubMainDoc: (() => void) | null = null;
    let unsubSchedule: (() => void) | null = null;
    let unsubLogs: (() => void) | null = null;
    const unsubMirrors: Array<() => void> = [];

    const loadData = async () => {
      setIsLoadingInitialData(true);
      setDataLoadError(null);
      try {
        const userEmail = firebaseUser?.email ? firebaseUser.email.toLowerCase().trim() : '';

        // Not logged in -> Show login / default state
        if (!userEmail) {
          if (!isMounted) return;
          // Session ended (logout / token expiry) — allow the login audit to
          // re-record on the next sign-in.
          recordedLoginSessionRef.current = null;
          const initData = await fetchAppData(ORG_ID);
          setAppData({ ...initData, currentUser: null });
          setIsDataLoaded(true);
          return;
        }

        // Force-refresh the ID token so the Firestore SDK's credentials provider
        // has a current token BEFORE we open listeners. Just after a sign-in
        // completes, auth.currentUser can be set before the token has propagated
        // to Firestore; a listener that attaches in that window fails
        // permission-denied and (unlike a getDoc) does NOT auto-retry. The retry
        // wrapper below is the real backstop; this just narrows the window.
        let userClaimRole: string | null = null;
        try {
          const idTokenResult = await firebaseUser.getIdTokenResult(true);
          if (idTokenResult?.claims?.role) {
            userClaimRole = String(idTokenResult.claims.role);
          }
        } catch (claimErr) {
          console.warn("Could not read custom claims / refresh token:", claimErr);
        }

        let currentScheduleEntries: ScheduleEntry[] = [];
        let currentActivityLogs: ActivityLog[] = [];
        let mainParsedData: any = null;
        let mainDocFired = false;

        // Phase 2: mirror subcollection snapshots (null = not reported / unusable -> fall back to doc array)
        const mirrorLists: Record<string, any[] | null> = {};
        let mirrorPeriodDoc: any | null = null;
        const mirrorFired = new Set<string>();
        const MIRROR_LABELS = [...READ_FLIP_ENTITY_FIELDS, 'periodSettings'];
        const reportedDivergence = new Set<string>();
        let READ_FROM_SUBCOLLECTIONS = false; // decided at the first main-doc snapshot
        let readFlipDecided = false;

        // Bounded retry for a listener that fails with `permission-denied` — the
        // token-propagation race above. Per-listener state; each re-attach clears
        // the previous timer + unsub so retries never stack or duplicate.
        const PERM_RETRY_MAX = 5;
        const makeRetryingListener = (
          label: string,
          build: () => Query | DocumentReference,
          onSnap: (snap: any) => void,
          onGiveUp?: () => void,
        ): (() => void) => {
          let attempts = 0;
          let unsub: (() => void) | null = null;
          let timer: ReturnType<typeof setTimeout> | null = null;
          const clear = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            if (unsub) { unsub(); unsub = null; }
          };
          const attach = async () => {
            clear();
            if (!isMounted) return;
            if (attempts > 0) {
              // Force a fresh token on each retry so Firestore has current creds.
              try { await auth.currentUser?.getIdToken(true); } catch { /* keep retrying */ }
              if (!isMounted) return;
            }
            unsub = onSnapshot(
              build() as any,
              (snap: any) => {
                if (attempts > 0) console.info(`[auth] ${label}: recovered after ${attempts} retr${attempts === 1 ? 'y' : 'ies'}`);
                attempts = 0;
                setDataLoadError(null);
                onSnap(snap);
              },
              (error: any) => {
                const code = error?.code || '';
                if (code === 'permission-denied' && attempts < PERM_RETRY_MAX && isMounted) {
                  attempts += 1;
                  const delay = Math.min(1000 * Math.pow(1.8, attempts - 1), 8000);
                  console.warn(`[auth] ${label}: permission-denied — retry ${attempts}/${PERM_RETRY_MAX} in ${Math.round(delay)}ms (auth token likely not propagated to Firestore yet)`);
                  timer = setTimeout(() => { void attach(); }, delay);
                } else if (code === 'permission-denied') {
                  console.error(`[auth] ${label}: gave up after ${attempts} permission-denied retries.`);
                  if (label === 'main-doc' && isMounted) setDataLoadError('permission-denied');
                  onGiveUp?.();
                } else {
                  // Non-permission error — do NOT retry (would mask a real bug).
                  console.warn(`[useAppAuth] ${label} listener error:`, code || error?.message || error);
                  onGiveUp?.();
                }
              },
            );
          };
          void attach();
          return clear;
        };

        const updateCombinedAppData = async () => {
          if (!isMounted) return;
          // Wait for the main-doc listener to report at least once — otherwise a
          // faster subcollection listener would flash guest/sample data (and the
          // login gate) while main-doc is still retrying.
          if (!mainDocFired) return;
          // Read-flip: wait until EVERY mirror listener has reported (or given up),
          // otherwise a half-loaded state (e.g. teachers=[]) would reach the autosave baseline.
          if (READ_FROM_SUBCOLLECTIONS && mirrorFired.size < MIRROR_LABELS.length) return;
          const md = mainParsedData || {};

          const pickList = (field: typeof READ_FLIP_ENTITY_FIELDS[number]): any[] => {
            if (!READ_FROM_SUBCOLLECTIONS) return md[field] || [];
            const { items, report } = resolveEntityList(mirrorLists[field] ?? null, md[field]);
            if ((report.onlyInMirror.length || report.onlyInDoc.length) && !reportedDivergence.has(field)) {
              reportedDivergence.add(field);
              console.warn(`[read-flip] ${field}: mirror and doc differ (onlyInMirror=${report.onlyInMirror.length}, onlyInDoc=${report.onlyInDoc.length}) — run migrate-to-subcollections.ts --verify-only`);
            }
            return items;
          };
          const pickedPeriodSettings: any[] = READ_FROM_SUBCOLLECTIONS
            ? resolvePeriodSettings<any>(mirrorPeriodDoc, md.periodSettings).items
            : (md.periodSettings || []);

          // Single shared normaliser — MUST match fetchAppData / executeRestore,
          // otherwise a subject's diff baseline and current state have different
          // key sets and every save re-sends it as "changed".
          const subjectsWithDefaults = normalizeLoadedSubjects(pickList('subjects'));

          const existingUsers: User[] = md.users || [];
          const existingUser = existingUsers.find(u => u.email.toLowerCase().trim() === userEmail);

          // Resolve role exclusively from Firebase Auth Custom Claims (source of truth)
          const resolvedRole: 'admin' | 'manager' | 'teacher' | 'assistant' | 'guest' =
            (userClaimRole && ['admin', 'manager', 'teacher', 'assistant'].includes(userClaimRole))
              ? (userClaimRole as any)
              : 'guest';

          let appUser = existingUser;
          let newUsers = [...existingUsers];

          if (!appUser) {
            // First-time user registration: create record with 'guest' role only (no guessing)
            appUser = {
              id: firebaseUser.uid,
              name: firebaseUser.displayName || userEmail.split('@')[0],
              email: userEmail,
              role: 'guest',
              organizationId: ORG_ID
            };
            newUsers.push(appUser);
            // Persist the new user record via Cloud Function — the new Firestore
            // Rules block brand-new guests from writing apps/{orgId} directly.
            registerCurrentUser(ORG_ID, appUser.name).catch(e => {
              console.warn("New user registration notice:", e?.message || e);
            });
          } else {
            // Existing user: resolve role from Custom Claims for in-memory UI display ONLY.
            // NEVER write role or authorizedAdmins back to Firestore from the client!
            const legacyRole = (!userClaimRole && existingUser.role && existingUser.role !== 'guest')
              ? existingUser.role
              : undefined;

            appUser = {
              ...appUser,
              role: resolvedRole,
              legacyUnclaimedRole: legacyRole
            };
          }

          const finalScheduleEntries: ScheduleEntry[] = Array.isArray(currentScheduleEntries) && currentScheduleEntries.length > 0
            ? currentScheduleEntries
            : (Array.isArray(md.scheduleEntries) ? md.scheduleEntries : []);

          const finalActivityLogs: ActivityLog[] = Array.isArray(currentActivityLogs) && currentActivityLogs.length > 0
            ? currentActivityLogs
            : (Array.isArray(md.activityLogs) ? md.activityLogs : []);

          const updatedData: AppData = {
            departments: safeUpsert(md.departments, DEFAULT_DEPARTMENTS),
            resourceTypes: safeUpsert(md.resourceTypes, DEFAULT_RESOURCE_TYPES),
            teachers: pickList('teachers'),
            subjects: subjectsWithDefaults,
            gradeLevels: pickList('gradeLevels'),
            physicalRooms: pickList('physicalRooms'),
            scheduleEntries: finalScheduleEntries,
            periodSettings: (READ_FROM_SUBCOLLECTIONS ? (pickedPeriodSettings.length > 0 ? pickedPeriodSettings : null) : md.periodSettings) || DEFAULT_PERIOD_SETTINGS,
            teacherSubjectAssignments: pickList('teacherSubjectAssignments'),
            organizationSettings: normalizeLoadedOrganizationSettings(md.organizationSettings || null),
            users: newUsers,
            activityLogs: finalActivityLogs,
            currentUser: appUser,
            authorizedAdmins: md.authorizedAdmins || []
          };

          // Session Login Audit Logging (Record once per user per session)
          if (appUser && recordedLoginSessionRef.current !== userEmail) {
            recordedLoginSessionRef.current = userEmail;
            
            if (appUser.role === 'guest') {
              // Log guest awaiting role approval as an audit notice
              logLoginAttempt('failed', userEmail, 'Guest account awaiting administrator approval', 'guest', ORG_ID);
            } else {
              // Log successful user login
              logLoginAttempt('success', userEmail, undefined, appUser.role, ORG_ID);
            }
          }

          // Reconcile with this client's not-yet-persisted local edits so a
          // snapshot arriving mid-autosave doesn't silently drop them.
          setAppData(prev => {
            let baseline: any = null;
            try {
              baseline = lastSavedDataStrRef?.current ? JSON.parse(lastSavedDataStrRef.current) : null;
            } catch { baseline = null; }
            return reconcileServerWithLocal(updatedData, prev, baseline);
          });
          setIsDataLoaded(true);
        };

        // Phase 2: attach the mirror subcollection listeners (only when the read-flip is on for this page load).
        const attachMirrors = () => {
          const markFired = (label: string) => { mirrorFired.add(label); updateCombinedAppData(); };
          for (const field of READ_FLIP_ENTITY_FIELDS) {
            unsubMirrors.push(makeRetryingListener(
              `mirror:${field}`,
              () => collection(db, 'apps', ORG_ID, field),
              (colSnap: any) => {
                mirrorLists[field] = colSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
                markFired(field);
              },
              () => { mirrorLists[field] = null; markFired(field); },
            ));
          }
          unsubMirrors.push(makeRetryingListener(
            'mirror:periodSettings',
            () => doc(db, 'apps', ORG_ID, 'periodSettings', PERIOD_SETTINGS_DOC_ID),
            (docSnap: any) => {
              mirrorPeriodDoc = docSnap.exists() ? docSnap.data() : null;
              markFired('periodSettings');
            },
            () => { mirrorPeriodDoc = null; markFired('periodSettings'); },
          ));
        };

        // 1. Real-time listener for main doc (apps/{ORG_ID}) — retries permission-denied.
        unsubMainDoc = makeRetryingListener(
          'main-doc',
          () => doc(db, 'apps', ORG_ID),
          (docSnap: any) => {
            mainDocFired = true;
            mainParsedData = docSnap.exists() ? docSnap.data() : null;
            if (!readFlipDecided) {
              readFlipDecided = true;
              const decision = resolveReadFlip({
                local: readLocalReadFlip(),
                global: mainParsedData?.organizationSettings?.readFromSubcollections,
                build: READ_FROM_SUBCOLLECTIONS_BUILD,
              });
              READ_FROM_SUBCOLLECTIONS = decision.enabled;
              setActiveReadFlip(decision);
              if (decision.enabled) {
                console.info(`[read-flip] reading from subcollections (source: ${decision.origin})`);
                attachMirrors();
              }
            }
            updateCombinedAppData();
          },
        );

        // 2. Real-time listener for subcollection (apps/{ORG_ID}/scheduleEntries).
        unsubSchedule = makeRetryingListener(
          'scheduleEntries',
          () => collection(db, 'apps', ORG_ID, 'scheduleEntries'),
          (colSnap: any) => {
            currentScheduleEntries = !colSnap.empty
              ? colSnap.docs.map((d: any) => ({ ...d.data(), id: d.id } as ScheduleEntry))
              : [];
            updateCombinedAppData();
          },
        );

        // 3. Real-time listener for subcollection (apps/{ORG_ID}/activityLogs).
        unsubLogs = makeRetryingListener(
          'activityLogs',
          () => query(collection(db, 'apps', ORG_ID, 'activityLogs'), orderBy('timestamp', 'desc'), limit(50)),
          (logsSnap: any) => {
            currentActivityLogs = !logsSnap.empty
              ? logsSnap.docs.map((d: any) => ({ ...d.data(), id: d.id } as ActivityLog))
              : [];
            updateCombinedAppData();
          },
        );


      } catch (error) {
        console.error("Failed to fetch/subscribe to initial app data:", error);
        if (!isMounted) return;
        const initialErrorUser: User = { id: crypto.randomUUID(), name: 'Error User', email: 'error@utd.ac.th', role: 'guest' };
        setAppData({
          departments: [], resourceTypes: [], teachers: [], subjects: [], gradeLevels: [], physicalRooms: [], scheduleEntries: [],
          periodSettings: DEFAULT_PERIOD_SETTINGS.map((ps, index) => ({...ps, id: ps.id || `p${index}`})),
          teacherSubjectAssignments: [], organizationSettings: null, users: [initialErrorUser], currentUser: null,
          activityLogs: []
        });
        setIsDataLoaded(true);
      } finally {
        if (isMounted) setIsLoadingInitialData(false);
      }
    };

    loadData();
    
    return () => { 
      isMounted = false; 
      if (unsubMainDoc) unsubMainDoc();
      if (unsubSchedule) unsubSchedule();
      if (unsubLogs) unsubLogs();
      unsubMirrors.forEach(u => u());
    };
  }, [isAuthChecking, firebaseUser?.email]);

  useEffect(() => {
    import('../lib/firebase').then(({ initAuth }) => {
      initAuth(
        (user, token) => {
          setIsAuthChecking(false);
          setGoogleAccessToken(token);
          setFirebaseUser((prev: any) => (prev && user && prev.uid === user.uid ? prev : user));
        },
        () => {
          setIsAuthChecking(false);
          setGoogleAccessToken(null);
          setFirebaseUser(null);
        }
      );
    }).catch(console.error);
  }, []);

  const handleLoginSuccess = (user: any, token: string | null) => {
    setGoogleAccessToken(token);
    if (token) {
      localStorage.setItem('googleAccessToken', token);
    } else {
      localStorage.removeItem('googleAccessToken');
    }
    // Propagate the signed-in user into React state immediately. Do NOT rely
    // solely on onAuthStateChanged — it can fire during the popup handshake and
    // race this, leaving the app stuck on the login screen until a refresh.
    if (user) {
      setIsAuthChecking(false);
      setFirebaseUser((prev: any) => (prev && prev.uid === user.uid ? prev : user));
    }
  };

  const handleLogout = () => {
    recordedLoginSessionRef.current = null;
    import('../lib/firebase').then(({ logout }) => {
      logout();
    });
    localStorage.removeItem('googleAccessToken');
    setAppData(prev => prev ? ({ ...prev, currentUser: null }) : null);
    setCurrentView('schedule'); 
  };

  return {
    isAuthChecking,
    googleAccessToken,
    firebaseUser,
    dataLoadError,
    handleLoginSuccess,
    handleLogout
  };
};
