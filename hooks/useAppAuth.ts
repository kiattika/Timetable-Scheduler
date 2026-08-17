import { useState, useEffect } from 'react';
import { fetchAppData, saveAppData, safeUpsert, DEFAULT_DEPARTMENTS, DEFAULT_RESOURCE_TYPES } from '../api';
import { AppData, User } from '../types';
import { db } from '../lib/firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { DEFAULT_PERIOD_SETTINGS } from '../constants';

export const useAppAuth = (
  appData: AppData | null,
  setAppData: (data: AppData | ((prev: AppData | null) => AppData | null)) => void,
  setIsDataLoaded: (val: boolean) => void,
  setCurrentView: (view: any) => void
) => {
  const [impersonatedOrgId, setImpersonatedOrgId] = useState<string | null>(null);
  const [resolvedUserOrgId, setResolvedUserOrgId] = useState<string>('default');

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
    let unsubscribeSnapshot: (() => void) | null = null;

    const loadDataWithDomainRouting = async () => {
      setIsLoadingInitialData(true);
      try {
        const userEmail = firebaseUser?.email ? firebaseUser.email.toLowerCase().trim() : '';

        // Not logged in -> Show login screen immediately
        if (!userEmail) {
           if (!isMounted) return;
           const initData = await fetchAppData('default');
           setAppData({ ...initData, currentUser: null });
           setIsDataLoaded(true);
           return;
        }

        // [CRITICAL FAIL-SAFE: Platform Admin Bypass via DB Role]
        let isGlobalPlatformAdmin = false;
        let defaultOrgData: any = null;
        try {
          defaultOrgData = await fetchAppData('default');
          const defaultAppUser = defaultOrgData.users.find((u: any) => u.email.toLowerCase() === userEmail);
          if (defaultAppUser && defaultAppUser.role === 'platform_admin') {
             isGlobalPlatformAdmin = true;
          }
        } catch (e) {
          console.error("Error checking platform admin status:", e);
        }

        if (isGlobalPlatformAdmin) {
          if (!isMounted) return;
          const activeOrgId = impersonatedOrgId || 'default';
          setResolvedUserOrgId(activeOrgId);
          
          unsubscribeSnapshot = onSnapshot(doc(db, 'apps', activeOrgId), (docSnap) => {
             if (docSnap.exists()) {
                const parsedData = docSnap.data() as any;
                const subjectsWithDefaults = (parsedData.subjects || []).map((s: any) => ({...s, teachingMode: s.teachingMode || 'single'}));
                const data: AppData = {
                  departments: safeUpsert(parsedData.departments, DEFAULT_DEPARTMENTS), resourceTypes: safeUpsert(parsedData.resourceTypes, DEFAULT_RESOURCE_TYPES), teachers: parsedData.teachers || [],
                  subjects: subjectsWithDefaults,
                  gradeLevels: parsedData.gradeLevels || [],
                  physicalRooms: parsedData.physicalRooms || [],
                  scheduleEntries: parsedData.scheduleEntries || [],
                  periodSettings: parsedData.periodSettings || DEFAULT_PERIOD_SETTINGS,
                  teacherSubjectAssignments: parsedData.teacherSubjectAssignments || [],
                  organizationSettings: parsedData.organizationSettings || defaultOrgData.organizationSettings,
                  users: parsedData.users || [],
                  activityLogs: parsedData.activityLogs || [],
                  currentUser: null, 
                };
                
                const appUser = data.users.find((u: any) => u.email.toLowerCase() === userEmail) || { 
                  id: firebaseUser!.uid, 
                  name: firebaseUser!.displayName || 'Super Admin', 
                  email: userEmail, 
                  role: 'platform_admin',
                  organizationId: activeOrgId
                };
                appUser.role = 'platform_admin';

                let newUsers = [...data.users];
                const existingIdx = newUsers.findIndex((u: any) => u.email.toLowerCase() === userEmail);
                if (existingIdx >= 0) newUsers[existingIdx] = appUser;
                else newUsers.push(appUser);

                setAppData(prev => ({
                   ...data,
                   users: newUsers,
                   currentUser: appUser
                }));
                setIsDataLoaded(true);
             }
          });

          if (!impersonatedOrgId) {
             setCurrentView('platformAdmin');
          }
          return;
        }

        // Fetch domain mappings to determine routing for non-platform admins
        let domainMappings: { domain: string, organizationId: string, adminEmail?: string }[] = [];
        try {
          const platRef = doc(db, 'apps', 'platform_admin_data');
          const platSnap = await getDoc(platRef);
          if (platSnap.exists()) {
            domainMappings = platSnap.data().domainMappings || [];
          }
        } catch (err) {
          console.error("Failed to fetch domain mapping registry:", err);
          alert(`ไม่สามารถเชื่อมต่อฐานข้อมูลส่วนกลางได้: ${err instanceof Error ? err.message : String(err)}`);
          import('../lib/firebase').then(({ logout }) => logout());
          return;
        }

        // Step 2 & 3: Match Email properly
        let matchedOrgId = '';
        let matchedRole: 'admin' | 'guest' | null = null;

        if (userEmail) {
           const adminMapping = domainMappings.find(m => m.adminEmail && m.adminEmail.trim().toLowerCase() === userEmail);
           if (adminMapping) {
               matchedOrgId = adminMapping.organizationId;
               matchedRole = 'admin';
           } else {
               const domainMapping = domainMappings.find(m => {
                 const domain = m.domain.toLowerCase().trim();
                 if (domain.startsWith('@')) return userEmail.endsWith(domain);
                 return userEmail.endsWith('@' + domain) || userEmail.endsWith('.' + domain);
               });
               if (domainMapping) {
                  matchedOrgId = domainMapping.organizationId;
                  matchedRole = 'guest';
               }
           }
        }

        if (!matchedOrgId) {
           import('../lib/firebase').then(({ logout }) => logout());
           alert("ยังไม่มีการลงทะเบียนโดเมนหรืออีเมลนี้ในระบบ (Domain Not Registered)");
           if (!isMounted) return;
           const initData = await fetchAppData('default');
           setAppData({ ...initData, currentUser: null });
           setIsDataLoaded(true);
           return;
        }

        if (!isMounted) return;
        setResolvedUserOrgId(matchedOrgId);

        const activeOrgId = impersonatedOrgId || matchedOrgId;

        // Real-time listener for the organization's data
        unsubscribeSnapshot = onSnapshot(doc(db, 'apps', activeOrgId), async (docSnap) => {
           if (!isMounted) return;
           if (!docSnap.exists()) {
               console.warn("Doc does not exist, fetching defaults.");
               const defaultInit = await fetchAppData('default');
               setAppData(defaultInit);
               setIsDataLoaded(true);
               return;
           }

           const parsedData = docSnap.data() as any;
           const subjectsWithDefaults = (parsedData.subjects || []).map((s: any) => ({...s, teachingMode: s.teachingMode || 'single'}));
           
           const data: AppData = {
              departments: safeUpsert(parsedData.departments, DEFAULT_DEPARTMENTS), resourceTypes: safeUpsert(parsedData.resourceTypes, DEFAULT_RESOURCE_TYPES), teachers: parsedData.teachers || [],
              subjects: subjectsWithDefaults,
              gradeLevels: parsedData.gradeLevels || [],
              physicalRooms: parsedData.physicalRooms || [],
              scheduleEntries: parsedData.scheduleEntries || [],
              periodSettings: parsedData.periodSettings || DEFAULT_PERIOD_SETTINGS,
              teacherSubjectAssignments: parsedData.teacherSubjectAssignments || [],
              organizationSettings: parsedData.organizationSettings || null,
              users: parsedData.users || [],
              activityLogs: parsedData.activityLogs || [],
              currentUser: null, 
           };

           let appUser = data.users.find(u => u.email.toLowerCase() === userEmail);
           let newUsers = [...data.users];
           let authStateChanged = false;
           
           if (!appUser) {
              appUser = { 
                  id: firebaseUser!.uid, 
                  name: firebaseUser!.displayName || 'New User', 
                  email: userEmail, 
                  role: matchedRole!,
                  organizationId: activeOrgId
              };
              newUsers.push(appUser);
              authStateChanged = true;
           } else {
              if (appUser.organizationId !== activeOrgId) {
                appUser = { ...appUser, organizationId: activeOrgId };
                authStateChanged = true;
              }
              if (matchedRole === 'admin' && appUser.role !== 'admin') {
                 appUser = { ...appUser, role: 'admin' };
                 authStateChanged = true;
              }
           }

           if (authStateChanged) {
              newUsers = newUsers.map(u => u.id === appUser!.id ? appUser! : u);
           }

           const updatedData: AppData = {
             ...data,
             users: newUsers,
             currentUser: appUser
           };

           if (appUser && !impersonatedOrgId) {
             const loginLog = {
               id: crypto.randomUUID(),
               timestamp: new Date().toISOString(),
               action: 'Logged In' as const,
               user: appUser.name || appUser.email,
               description: 'User logged into the application'
             };
             // We only log in once per session normally, but since this is onSnapshot it might fire multiple times.
             // We should probably only do this if it's the very first time. Let's rely on saveAppData inside App.tsx for logging.
           }
           
           if (authStateChanged && !impersonatedOrgId) {
              await saveAppData(updatedData, activeOrgId);
           }

           setAppData(prev => ({
               ...updatedData,
               currentUser: appUser
           }));
           
           setIsDataLoaded(true);
        });
        
        if (matchedRole === 'admin' && !impersonatedOrgId) {
           setCurrentView('schedule');
        }

      } catch (error) {
        console.error("Failed to fetch/subscribe to initial app data:", error);
        if (!isMounted) return;
        const initialErrorUser: User = { id: crypto.randomUUID(), name: 'Error User', email: 'error@example.com', role: 'guest' };
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

    loadDataWithDomainRouting();
    
    return () => { 
       isMounted = false; 
       if (unsubscribeSnapshot) unsubscribeSnapshot();
    };
  }, [isAuthChecking, firebaseUser?.email, impersonatedOrgId]);

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
    // User state is handled by onAuthStateChanged in useEffect
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
    impersonatedOrgId,
    setImpersonatedOrgId,
    resolvedUserOrgId,
    setResolvedUserOrgId,
    isAuthChecking,
    googleAccessToken,
    firebaseUser,
    handleLoginSuccess,
    handleLogout
  };
};
