import { useState, useEffect } from 'react';
import { fetchAppData, saveAppData, safeUpsert, DEFAULT_DEPARTMENTS, DEFAULT_RESOURCE_TYPES, pruneActivityLogs } from '../api';
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

        const activeOrgId = 'default';
        setResolvedUserOrgId(activeOrgId);

        // Real-time listener for UTD school data
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
              activityLogs: pruneActivityLogs(parsedData.activityLogs || [], 7),
              currentUser: null, 
              authorizedAdmins: parsedData.authorizedAdmins || []
           };

           let appUser = data.users.find(u => u.email.toLowerCase() === userEmail);
           let newUsers = [...data.users];
           let authStateChanged = false;
           
           const isAuthorizedAdmin = (data.authorizedAdmins || []).some(adminEmail => adminEmail.toLowerCase() === userEmail);

           if (!appUser) {
              appUser = { 
                  id: firebaseUser!.uid, 
                  name: firebaseUser!.displayName || 'UTD Member', 
                  email: userEmail, 
                  role: isAuthorizedAdmin ? 'admin' : 'guest',
                  organizationId: activeOrgId
              };
              newUsers.push(appUser);
              authStateChanged = true;
           } else {
              if (isAuthorizedAdmin && appUser.role !== 'admin') {
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
           
           if (authStateChanged) {
              await saveAppData(updatedData, activeOrgId);
           }

           setAppData(prev => ({
               ...updatedData,
               currentUser: appUser
           }));
           
           setIsDataLoaded(true);
        });

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
