import { useState, useEffect } from 'react';
import { fetchAppData, saveAppData, safeUpsert, DEFAULT_DEPARTMENTS, DEFAULT_RESOURCE_TYPES, ORG_ID } from '../api';
import { AppData, User, ScheduleEntry, ActivityLog, Teacher } from '../types';
import { db } from '../lib/firebase';
import { doc, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { DEFAULT_PERIOD_SETTINGS } from '../constants';

export const useAppAuth = (
  appData: AppData | null,
  setAppData: (data: AppData | ((prev: AppData | null) => AppData | null)) => void,
  setIsDataLoaded: (val: boolean) => void,
  setCurrentView: (view: any) => void
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

          const subjectsWithDefaults = (mainParsedData.subjects || []).map((s: any) => ({
            ...s, 
            teachingMode: s.teachingMode || 'single'
          }));

          const bootstrapAdminEmails = [
            'kiattika@utd.ac.th',
            'admin@utd.ac.th',
            (mainParsedData.organizationSettings?.schoolAdminEmail || '').toLowerCase().trim()
          ].filter(Boolean);

          const isBootstrapAdmin = bootstrapAdminEmails.includes(userEmail);

          const isAuthorizedAdmin = (mainParsedData.authorizedAdmins || []).some(
            (adminEmail: string) => adminEmail.toLowerCase().trim() === userEmail
          ) || userClaimRole === 'admin' || isBootstrapAdmin;

          const existingUsers: User[] = mainParsedData.users || [];
          const existingUser = existingUsers.find(u => u.email.toLowerCase().trim() === userEmail);

          // Count existing active admins
          const existingAdminsCount = existingUsers.filter(u => u.role === 'admin').length;

          let resolvedRole: 'admin' | 'manager' | 'teacher' | 'assistant' | 'guest' = 'guest';

          if (userClaimRole === 'admin' || isAuthorizedAdmin) {
            resolvedRole = 'admin';
          } else if (userClaimRole === 'manager') {
            resolvedRole = 'manager';
          } else if (userClaimRole === 'assistant') {
            resolvedRole = 'assistant';
          } else if (userClaimRole === 'teacher') {
            resolvedRole = 'teacher';
          } else if (existingUser && ['admin', 'manager', 'teacher', 'assistant'].includes(existingUser.role)) {
            // Respect role already saved in Firestore database
            resolvedRole = existingUser.role;
          } else if (existingAdminsCount === 0 && userEmail.endsWith('@utd.ac.th')) {
            // If no admins exist yet in the database, promote the first organization user to admin
            resolvedRole = 'admin';
          } else {
            // Check if user is a teacher registered in the system
            const isTeacher = (mainParsedData.teachers || []).some(
              (t: Teacher) => t.email && t.email.toLowerCase().trim() === userEmail
            );
            if (isTeacher) {
              resolvedRole = 'teacher';
            }
          }

          let appUser = existingUser;
          let newUsers = [...existingUsers];
          let authStateChanged = false;

          if (!appUser) {
            appUser = {
              id: firebaseUser.uid,
              name: firebaseUser.displayName || userEmail.split('@')[0],
              email: userEmail,
              role: resolvedRole,
              organizationId: ORG_ID
            };
            newUsers.push(appUser);
            authStateChanged = true;
          } else if (appUser.role !== resolvedRole) {
            appUser = { ...appUser, role: resolvedRole };
            newUsers = newUsers.map(u => u.id === appUser!.id ? appUser! : u);
            authStateChanged = true;
          }

          // Maintain authorizedAdmins array
          let updatedAuthorizedAdmins = Array.isArray(mainParsedData.authorizedAdmins) 
            ? [...mainParsedData.authorizedAdmins] 
            : [];
          if (resolvedRole === 'admin' && !updatedAuthorizedAdmins.map((e: string) => e.toLowerCase().trim()).includes(userEmail)) {
            updatedAuthorizedAdmins.push(userEmail);
            authStateChanged = true;
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
            authorizedAdmins: updatedAuthorizedAdmins
          };

          if (authStateChanged && appUser && (appUser.role === 'admin' || appUser.role === 'manager')) {
            saveAppData(updatedData, ORG_ID).catch(e => {
              console.warn("User sync notice:", e?.message || e);
            });
          }

          setAppData(updatedData);
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
          setFirebaseUser(user);
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
  };

  const handleLogout = () => {
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
