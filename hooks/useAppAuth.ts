import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import { fetchAppData, registerCurrentUser, safeUpsert, DEFAULT_DEPARTMENTS, DEFAULT_RESOURCE_TYPES, ORG_ID, normalizeLoadedSubjects, reconcileServerWithLocal } from '../api';
import { AppData, User, ScheduleEntry, ActivityLog, Teacher } from '../types';
import { db } from '../lib/firebase';
import { doc, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { DEFAULT_PERIOD_SETTINGS } from '../constants';
import { logActivity, logLoginAttempt } from '../lib/logger';

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
  const recordedLoginSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (isAuthChecking) return;
    let isMounted = true;
    let unsubMainDoc: (() => void) | null = null;
    let unsubSchedule: (() => void) | null = null;
    let unsubLogs: (() => void) | null = null;

    const loadData = async () => {
      setIsLoadingInitialData(true);
      try {
        const userEmail = firebaseUser?.email ? firebaseUser.email.toLowerCase().trim() : '';

        // Not logged in -> Show login / default state
        if (!userEmail) {
          if (!isMounted) return;
          const initData = await fetchAppData(ORG_ID);
          setAppData({ ...initData, currentUser: null });
          setIsDataLoaded(true);
          return;
        }

        // Fetch custom claims to verify role securely from JWT token
        let userClaimRole: string | null = null;
        try {
          const idTokenResult = await firebaseUser.getIdTokenResult(true);
          if (idTokenResult?.claims?.role) {
            userClaimRole = String(idTokenResult.claims.role);
          }
        } catch (claimErr) {
          console.warn("Could not read custom claims:", claimErr);
        }

        let currentScheduleEntries: ScheduleEntry[] = [];
        let currentActivityLogs: ActivityLog[] = [];
        let mainParsedData: any = null;

        const updateCombinedAppData = async () => {
          if (!isMounted) return;
          if (!mainParsedData) {
            const defaultInit = await fetchAppData(ORG_ID);
            setAppData(defaultInit);
            setIsDataLoaded(true);
            return;
          }

          // Single shared normaliser — MUST match fetchAppData / executeRestore,
          // otherwise a subject's diff baseline and current state have different
          // key sets and every save re-sends it as "changed".
          const subjectsWithDefaults = normalizeLoadedSubjects(mainParsedData.subjects);

          const existingUsers: User[] = mainParsedData.users || [];
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
            : (Array.isArray(mainParsedData.scheduleEntries) ? mainParsedData.scheduleEntries : []);

          const finalActivityLogs: ActivityLog[] = Array.isArray(currentActivityLogs) && currentActivityLogs.length > 0
            ? currentActivityLogs
            : (Array.isArray(mainParsedData.activityLogs) ? mainParsedData.activityLogs : []);

          const updatedData: AppData = {
            departments: safeUpsert(mainParsedData.departments, DEFAULT_DEPARTMENTS),
            resourceTypes: safeUpsert(mainParsedData.resourceTypes, DEFAULT_RESOURCE_TYPES),
            teachers: mainParsedData.teachers || [],
            subjects: subjectsWithDefaults,
            gradeLevels: mainParsedData.gradeLevels || [],
            physicalRooms: mainParsedData.physicalRooms || [],
            scheduleEntries: finalScheduleEntries,
            periodSettings: mainParsedData.periodSettings || DEFAULT_PERIOD_SETTINGS,
            teacherSubjectAssignments: mainParsedData.teacherSubjectAssignments || [],
            organizationSettings: mainParsedData.organizationSettings || null,
            users: newUsers,
            activityLogs: finalActivityLogs,
            currentUser: appUser,
            authorizedAdmins: mainParsedData.authorizedAdmins || []
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

        // 1. Real-time listener for main doc (apps/{ORG_ID})
        unsubMainDoc = onSnapshot(
          doc(db, 'apps', ORG_ID),
          (docSnap) => {
            if (!isMounted) return;
            if (docSnap.exists()) {
              mainParsedData = docSnap.data();
            } else {
              mainParsedData = null;
            }
            updateCombinedAppData();
          },
          (error) => {
            console.warn("Firestore main doc listener error:", error);
            if (!mainParsedData) {
              fetchAppData(ORG_ID).then(fallbackData => {
                if (isMounted) {
                  setAppData(prev => prev || fallbackData);
                  setIsDataLoaded(true);
                }
              }).catch(console.error);
            }
          }
        );

        // 2. Real-time listener for subcollection (apps/{ORG_ID}/scheduleEntries)
        unsubSchedule = onSnapshot(
          collection(db, 'apps', ORG_ID, 'scheduleEntries'),
          (colSnap) => {
            if (!isMounted) return;
            if (!colSnap.empty) {
              currentScheduleEntries = colSnap.docs.map(d => ({ ...d.data(), id: d.id } as ScheduleEntry));
            } else {
              currentScheduleEntries = [];
            }
            updateCombinedAppData();
          },
          (error: any) => {
            console.warn("Firestore scheduleEntries subcollection notice (main doc listener active):", error?.message || error);
          }
        );

        // 3. Real-time listener for subcollection (apps/{ORG_ID}/activityLogs)
        const logsQuery = query(collection(db, 'apps', ORG_ID, 'activityLogs'), orderBy('timestamp', 'desc'), limit(50));
        unsubLogs = onSnapshot(
          logsQuery,
          (logsSnap) => {
            if (!isMounted) return;
            if (!logsSnap.empty) {
              currentActivityLogs = logsSnap.docs.map(d => ({ ...d.data(), id: d.id } as ActivityLog));
            } else {
              currentActivityLogs = [];
            }
            updateCombinedAppData();
          },
          (err: any) => {
            console.warn("Firestore activityLogs subcollection notice (main doc listener active):", err?.message || err);
          }
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
    handleLoginSuccess,
    handleLogout
  };
};
