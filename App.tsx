

import React, { useState, useEffect, useCallback, ChangeEvent, useRef } from 'react';
import { PrintLayout } from './components/PrintLayout';
import { AppData, EntityType, FormField, Teacher, Subject, GradeLevel, PeriodSetting, TeacherSubjectAssignment, ImportableEntityType, TeacherAssignmentType, ScheduleEntry, PeriodSettingsType, OrganizationSettings, User, UserManagementType, AcademicStructureType, TeacherLoadReportType, ScreenAccessProps, PrintOptions, PrintWithOptionsModalProps, Identifiable, ScheduleViewType, SingleScheduleTableProps, PhysicalRoom } from './types';
import EntityManagementScreen from './components/EntityManagementScreen';
import ScheduleScreen from './components/ScheduleScreen.tsx';
import TeacherSubjectAssignmentScreen from './components/TeacherSubjectAssignmentScreen';
import ImportDataModal from './components/ImportDataModal'; 
import PeriodSettingsManagementScreen from './components/PeriodSettingsManagementScreen'; 
import OrganizationSettingsScreen from './components/OrganizationSettingsScreen';
import UserManagementScreen from './components/UserManagementScreen'; 
import AcademicStructureScreen from './components/AcademicStructureScreen'; 
import LoginScreen from './components/LoginScreen'; 
import Modal from './components/Modal'; 
import PrintWithOptionsModal from './components/PrintWithOptionsModal'; 
import { TeacherLoadReportScreen } from './components/TeacherLoadReportScreen';
import { AdminSettingsScreen } from './components/AdminSettingsScreen';
import { SystemHealthScreen } from './components/SystemHealthScreen';
import { GradeLevelScheduleTable } from './components/GradeLevelPlannerView';
import { TeacherScheduleTable } from './components/TeacherScheduleView';
import { RoomUsageScheduleTable } from './components/RoomUsageView';

import { Icons, APP_TITLE, PREDEFINED_SUBJECT_COLORS, DEFAULT_PERIOD_SETTINGS } from './constants';
import { fetchAppData, saveAppData, getInitialAppDataForApi } from './api'; 
import { isParentGrade as checkIsParentGradeUtil, getParentGradeLevelId, getChildGradeLevelIds, isChildOf } from './components/scheduleUtils';
import { useAppAuth } from './hooks/useAppAuth';
import { useBackupRestore } from './hooks/useBackupRestore';
import { db } from './lib/firebase';
import { doc, getDoc, getDocFromServer } from 'firebase/firestore';

type View = 'schedule' | 'manageData' | 'importData'; 
type ManageDataSubView = EntityType | TeacherAssignmentType | PeriodSettingsType | 'organizationSettings' | UserManagementType | AcademicStructureType | TeacherLoadReportType | 'adminSettings' | 'departments' | 'resourceTypes' | 'systemHealth';

const MAX_EXCEL_CELL_LENGTH = 32000; 


const App: React.FC = () => {
  const [appData, setAppData] = useState<AppData | null>(null); 
  const [currentView, setCurrentView] = useState<View>('schedule');
  const [currentManageDataSubView, setCurrentManageDataSubView] = useState<ManageDataSubView>('teachers');
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isPrintOptionsModalOpen, setIsPrintOptionsModalOpen] = useState(false);
  const [printOptionsModalProps, setPrintOptionsModalProps] = useState<Omit<PrintWithOptionsModalProps, 'isOpen' | 'onClose' | 'onConfirmPrint' | 'appData'> | null>(null);
  const [printJob, setPrintJob] = useState<PrintOptions | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreConfirmationText, setRestoreConfirmationText] = useState("");

  const {
    impersonatedOrgId, setImpersonatedOrgId,
    resolvedUserOrgId, setResolvedUserOrgId,
    isAuthChecking, googleAccessToken, firebaseUser,
    handleLoginSuccess, handleLogout
  } = useAppAuth(
    appData,
    setAppData as React.Dispatch<React.SetStateAction<AppData | null>>,
    setIsDataLoaded,
    setCurrentView
  );

    useEffect(() => {
    if (isDataLoaded && appData && !firebaseUser && appData.currentUser) {
        setAppData(prev => prev ? ({ ...prev, currentUser: null }) : null);
    }
  }, [isDataLoaded, firebaseUser, appData?.currentUser?.id]);

  const lastSavedDataStr = useRef<string | null>(null);

  useEffect(() => {
    if (isDataLoaded && appData && !impersonatedOrgId) {
      const currentDataStr = JSON.stringify(appData);
      if (currentDataStr === lastSavedDataStr.current) {
         return; // Skip if no actual data changes
      }

      const timeoutId = setTimeout(() => {
        saveAppData(appData, resolvedUserOrgId).then(() => {
            lastSavedDataStr.current = currentDataStr;
        }).catch(error => {
          console.error("Failed to save app data:", error);
        });
      }, 2000);
      return () => clearTimeout(timeoutId);
    }
  }, [appData, isDataLoaded, firebaseUser?.email, impersonatedOrgId, resolvedUserOrgId]);

  const isImpersonating = impersonatedOrgId !== null;
  const isLocked = appData?.organizationSettings?.isLocked === true;
  const permissions: ScreenAccessProps['permissions'] = {
    canPerformAdminActions: !isImpersonating && (appData?.currentUser?.role === 'admin' || appData?.currentUser?.role === 'platform_admin'),
    canPerformManagerActions: !isImpersonating && (appData?.currentUser?.role === 'admin' || appData?.currentUser?.role === 'manager' || appData?.currentUser?.role === 'platform_admin'),
    canModifyScheduleEntries: !isLocked && !isImpersonating && (appData?.currentUser?.role === 'admin' || appData?.currentUser?.role === 'manager' || appData?.currentUser?.role === 'assistant' || appData?.currentUser?.role === 'platform_admin'),
    canModifyTeacherSubjectLinks: !isLocked && !isImpersonating && (appData?.currentUser?.role === 'admin' || appData?.currentUser?.role === 'manager' || appData?.currentUser?.role === 'assistant' || appData?.currentUser?.role === 'platform_admin'),
  };

  // Path routing and guards for /platform-admin
  useEffect(() => {
    const handlePlatformAdminRoute = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (path === '/platform-admin' || hash === '#/platform-admin' || hash === '#platform-admin') {
        if (appData?.currentUser) {
          const isUserPm = appData.currentUser.role === 'platform_admin';
          if (isUserPm) {
            setCurrentView('platformAdmin');
          } else {
            alert("ไม่ได้รับสิทธิ์ให้เข้าสู่ระบบควบคุมส่วนกลาง (Access Denied)");
            setCurrentView('schedule');
            // Reset url of unauthorized user
            if (window.location.pathname === '/platform-admin') {
              window.history.replaceState({}, '', '/');
            } else {
              window.location.hash = '';
            }
          }
        }
      }
    };

    handlePlatformAdminRoute();
    window.addEventListener('popstate', handlePlatformAdminRoute);
    window.addEventListener('hashchange', handlePlatformAdminRoute);
    return () => {
      window.removeEventListener('popstate', handlePlatformAdminRoute);
      window.removeEventListener('hashchange', handlePlatformAdminRoute);
    };
  }, [appData?.currentUser]);


  const { handleBackupData, handleRestoreData } = useBackupRestore(appData, setAppData as (data: AppData) => void, setRestoreFile, setShowRestoreConfirm);

    const entityConfigurations: Record<ManageDataSubView | ImportableEntityType | 'departments' | 'resourceTypes', { singular: string; plural: string; fields?: FormField[]; getIcon: () => React.ElementType }> = {
    departments: {
      singular: 'Department',
      plural: 'Departments',
      fields: [
        { name: 'name', label: 'Department Name (ชื่อกลุ่มสาระฯ)', type: 'text', required: true, placeholder: 'e.g., Science' },
      ],
      getIcon: () => Icons.PhysicalRoom,
    },
    resourceTypes: {
      singular: 'Resource Type',
      plural: 'Resource Types',
      fields: [
        { name: 'name', label: 'Resource Type Name (ชื่อประเภท)', type: 'text', required: true, placeholder: 'e.g., ห้องเรียนทั่วไป' },
      ],
      getIcon: () => Icons.Layers,
    },
    teachers: {
      singular: 'Teacher',
      plural: 'Teachers',
      fields: [
        { name: 'name', label: 'Teacher Name (ชื่อ-สกุล)', type: 'text', required: true, placeholder: 'e.g., Dr. Smith' },
        { name: 'teacherCode', label: 'Teacher Code (รหัสครู)', type: 'text', placeholder: 'e.g., T001' },
        { name: 'email', label: 'Email (อีเมล์)', type: 'email', placeholder: 'e.g., teacher@example.com', required: false },
        { name: 'department', label: 'Department (กลุ่มสาระฯ)', type: 'select', optionsSource: 'departments', placeholder: 'Select Department' },
        { name: 'homeroomGradeLevelIds', label: 'Homeroom Grade Levels (ครูที่ปรึกษาประจำชั้น)', type: 'multiselect', optionsSource: 'gradeLevels', required: false, placeholder: 'Comma-separated Grade Level names for Excel import' },
      ],
      getIcon: () => Icons.Teacher,
    },
    subjects: {
      singular: 'Subject',
      plural: 'Subjects',
      fields: [
        { name: 'name', label: 'Subject Name (ชื่อวิชา)', type: 'text', required: true, placeholder: 'e.g., Mathematics' },
        { name: 'subjectCode', label: 'Subject Code (รหัสวิชา)', type: 'text', placeholder: 'e.g., MTH101' },
        { name: 'department', label: 'Department (กลุ่มสาระฯ)', type: 'select', optionsSource: 'departments', required: true, placeholder: 'Select Department' },
        { name: 'periodsPerWeek', label: 'Periods Per Week (คาบต่อสัปดาห์)', type: 'number', placeholder: 'e.g., 3' },
        { name: 'color', label: 'Color', type: 'color', required: true, placeholder: 'Hex color code e.g., #FF6B6B' },
        {
          name: 'type',
          label: 'Subject Type (ประเภทวิชา)',
          type: 'select',
          options: [
            { value: 'STANDARD', label: 'STANDARD (Requires Teacher, Subject, Grade/Room)' },
            { value: 'TEACHER_ONLY', label: 'TEACHER-ONLY (e.g., PLC, Meetings. Requires Teacher + Subject)' },
            { value: 'STUDENT_ONLY', label: 'STUDENT-ONLY (e.g., Independent Study, Free Period. Requires Grade/Room + Subject)' }
          ],
          required: false,
          placeholder: 'Select Subject Type'
        },
        { 
          name: 'teachingMode', 
          label: 'Teaching Mode', 
          type: 'select', 
          options: [
            { value: 'single', label: 'Single Teacher per Session' },
            { value: 'multiple', label: 'Multiple Teachers (Co-teaching support)' }
          ], 
          required: false,
          placeholder: "'single' or 'multiple'"
        },
        { name: 'schedulingPattern', label: 'Scheduling Pattern (e.g., 2/2/1)', type: 'text', placeholder: 'e.g., 2/1/1 or 2/2', required: false },
        { name: 'allowClassroomSharing', label: 'Allow PhysicalRoom Sharing? (อนุญาตให้ใช้ห้องเรียนร่วมกับวิชาอื่นได้)', type: 'checkbox', required: false, placeholder: "'true' or 'false'" },
        { name: 'isBroadAssignment', label: 'Broad Assignment (สำหรับวิชาที่เรียนรวมกันทั้งระดับชั้น เช่น ลูกเสือ)', type: 'checkbox', required: false },
        { name: 'isHomeroomAdvisorySubject', label: 'Homeroom/Advisory Subject (วิชาโฮมรูม/แนะแนว)', type: 'checkbox', required: false },
        { name: 'autoLinkToHomeroomTeachers', label: 'Auto-link to Homeroom Teachers (เชื่อมโยงกับครูที่ปรึกษาอัตโนมัติ)', type: 'checkbox', required: false, disabled: (item: any) => !item?.isHomeroomAdvisorySubject },
        { name: 'applicableParentGradeLevelIds', label: 'Applicable Parent Grades (สำหรับวิชาลูกเสือ/โฮมรูม)', type: 'multiselect', optionsSource: 'gradeLevels', required: false, disabled: (item: any) => !item?.isBroadAssignment && !item?.isHomeroomAdvisorySubject },
      ],
      getIcon: () => Icons.Subject,
    },
    gradeLevels: {
      singular: 'Grade Level',
      plural: 'Grade Levels',
      fields: [
        { name: 'name', label: 'Grade Level Name', type: 'text', required: true, placeholder: 'e.g., M.1' },
        { name: 'homeroomPhysicalRoomId', label: 'Homeroom (ห้องโฮมรูม)', type: 'select', optionsSource: 'physicalRooms', placeholder: 'Select Homeroom' },
        { name: 'groupEmail', label: 'Email Group (อีเมลกรุ๊ป)', type: 'email', placeholder: 'e.g., m1@school.edu' },
        { name: 'description', label: 'Description (คำอธิบาย)', type: 'textarea', placeholder: 'Additional info...' },
      ],
      getIcon: () => Icons.GradeLevel,
    },
    classrooms: {
       singular: 'Classroom',
       plural: 'Classrooms',
       fields: [
          { name: 'name', label: 'Classroom Name (ชื่อห้องเรียน)', type: 'text', required: true, placeholder: 'e.g., M.1/1' },
          { name: 'homeroomPhysicalRoomId', label: 'Homeroom (ห้องเรียนประจำ)', type: 'select', optionsSource: 'physicalRooms', required: false },
          { name: 'groupEmail', label: 'Student Group Email (อีเมลกลุ่ม)', type: 'email', required: false, placeholder: 'e.g., 1.2569.m5.8@utd.ac.th' },
          { name: 'description', label: 'Description/Notes', type: 'textarea', required: false, placeholder: 'Optional description' },
       ],
       getIcon: () => Icons.Users,
    },
    physicalRooms: {
      singular: 'Physical Room',
      plural: 'Physical Rooms',
      fields: [
        { name: 'code', label: 'Room Code (รหัสห้อง)', type: 'text', required: true, placeholder: 'e.g., 931' },
        { name: 'name', label: 'Room Name / Description (ชื่อห้อง/รายละเอียด)', type: 'text', required: true, placeholder: 'e.g., Computer Lab 1' },
        { 
          name: 'type', 
          label: 'Room Type (ประเภทห้อง)', 
          type: 'select', 
          optionsSource: 'resourceTypes',
          required: true,
          placeholder: 'Select Type'
        },
        { name: 'capacity', label: 'Capacity (ความจุ)', type: 'number', required: false, placeholder: 'e.g., 40' },
      ],
      getIcon: () => Icons.PhysicalRoom,
    },
    teacherSubjectAssignments: {
      singular: 'Teacher-Subject Link',
      plural: 'มอบหมายวิชาสอน',
      fields: [
        { name: 'teacherIdentifier', label: 'Teacher Name or Code', type: 'text', required: true, placeholder: 'Teacher\'s full name or code' },
        { name: 'subjectIdentifier', label: 'Subject Name or Code', type: 'text', required: true, placeholder: 'Subject\'s full name or code' },
        { name: 'gradeLevelName', label: 'Grade Level Name', type: 'text', required: true, placeholder: 'Full name of the Grade Level (e.g., M.1/1)' },
      ],
      getIcon: () => Icons.Link,
    },
    periodSettings: {
      singular: 'Period Setting',
      plural: 'จัดการการตั้งค่าคาบเรียน',
      getIcon: () => Icons.Settings,
    },
    organizationSettings: {
      singular: 'Organization Info',
      plural: 'ข้อมูลหน่วยงาน',
      getIcon: () => Icons.Landmark,
    },
    academicStructure: {
      singular: 'Academic Structure',
      plural: 'กำหนดโครงสร้างระดับชั้นและห้องเรียน',
      getIcon: () => Icons.Layers,
    },
    users: {
      singular: 'User',
      plural: 'จัดการผู้ใช้งาน',
      getIcon: () => Icons.Users,
    },
    teacherLoadReport: {
      singular: 'Report',
      plural: 'รายงานสรุปภาระงานสอน',
      getIcon: () => Icons.FileText,
    },
    adminSettings: {
      singular: 'Admin Setting',
      plural: 'Manage Permissions',
      getIcon: () => Icons.Users,
    },
    systemHealth: {
      singular: 'System Health',
      plural: 'System Health',
      getIcon: () => Icons.DatabaseZap,
    },
  };

  const currentConfig = entityConfigurations[currentManageDataSubView]; 

  const handleDeletePeriodSetting = (periodIdToDelete: string) => {
    if (!appData) return; 
    if (!permissions.canPerformManagerActions) {
        alert("เฉพาะผู้จัดการเท่านั้นที่สามารถลบการตั้งค่าคาบเรียนได้");
        return;
    }

    setAppData(prev => {
        if (!prev) return null; 
        const periodIndexToDelete = prev.periodSettings.findIndex(p => p.id === periodIdToDelete);
        
        if (periodIndexToDelete === -1) {
            return prev;
        }
        
        const updatedScheduleEntriesStep1 = prev.scheduleEntries.filter(entry => entry.period !== periodIndexToDelete);
        const updatedScheduleEntriesStep2 = updatedScheduleEntriesStep1.map(entry => {
            if (entry.period > periodIndexToDelete) {
                return { ...entry, period: entry.period - 1 };
            }
            return entry;
        });
        
        const updatedPeriodSettings = prev.periodSettings.filter(p => p.id !== periodIdToDelete);

        return {
            ...prev,
            periodSettings: updatedPeriodSettings,
            scheduleEntries: updatedScheduleEntriesStep2,
        };
    });
  };

  const openPrintOptionsModalHandler = (itemType: 'teacher' | 'gradeLevel' | 'physicalRoom', currentItemId: string | null) => {
    if (!appData) return;
    let allItemsForType: Identifiable[] = [];
    switch (itemType) {
        case 'teacher': allItemsForType = appData.teachers; break;
        case 'gradeLevel': allItemsForType = appData.gradeLevels; break;
        case 'physicalRoom': allItemsForType = appData.physicalRooms; break;
    }
    setPrintOptionsModalProps({ itemType, currentItemId, allItems: allItemsForType });
    setIsPrintOptionsModalOpen(true);
  };

  const getEntryDisplay = useCallback((entry: ScheduleEntry) => { 
        if (!appData) return { teachers: [] };
        const subject = appData.subjects.find(s => s.id === entry.subjectId);
        const entryTeachers = entry.teacherIds.map(tid => {
          if (tid === 'No Teacher Assigned') {
            return { id: 'No Teacher Assigned', name: 'No Teacher Assigned', teacherCode: '' } as Teacher;
          }
          return appData.teachers.find(t => t.id === tid);
        }).filter(Boolean) as Teacher[];
        const physicalRoom = appData.physicalRooms.find(c => c.id === entry.physicalRoomId);
        const gradeLevel = entry.gradeLevelId === 'Non-Student'
          ? { id: 'Non-Student', name: 'Non-Student (Teacher-Only)' } as GradeLevel
          : appData.gradeLevels.find(gl => gl.id === entry.gradeLevelId);
        return { subject, teachers: entryTeachers, physicalRoom, gradeLevel };
    }, [appData]);

  const handleActualPrint = (options: PrintOptions) => {
    if (!appData) return;
    setPrintJob(options);
    setIsPrintOptionsModalOpen(false);
  };


  const renderView = () => {
    if (!isDataLoaded || isAuthChecking || !appData) { 
        return <div className="flex justify-center items-center h-screen text-xl text-slate-600">Loading data...</div>;
    }
    
    if (!appData.currentUser) {
        return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
    }

    if (currentView === 'schedule') {
      return <ScheduleScreen 
                appData={appData} 
                setAppData={setAppData} 
                permissions={permissions} 
                openPrintOptionsModal={openPrintOptionsModalHandler}
            />;
    }

    if (currentView === 'manageData') {
      const screenAccessProps: ScreenAccessProps = { permissions };
      const allowedAssistantSubViews: ManageDataSubView[] = ['teachers', 'subjects', 'teacherSubjectAssignments'];
      const allowedManagerSubViews: ManageDataSubView[] = ['teachers', 'subjects', 'teacherSubjectAssignments'];

      if (appData.currentUser.role === 'assistant' && !allowedAssistantSubViews.includes(currentManageDataSubView)) {
        setCurrentManageDataSubView('subjects'); 
        return <div className="flex justify-center items-center h-full text-xl text-slate-600">Redirecting...</div>;
      }

      if (appData.currentUser.role === 'manager' && !allowedManagerSubViews.includes(currentManageDataSubView)) {
        setCurrentManageDataSubView('subjects');
        return <div className="flex justify-center items-center h-full text-xl text-slate-600">Redirecting...</div>;
      }
      
      const isUserAdminOrPlatAdmin = appData.currentUser.role === 'admin' || appData.currentUser.role === 'platform_admin';

      if (!isUserAdminOrPlatAdmin && currentManageDataSubView === 'users') {
        setCurrentManageDataSubView('subjects');
        return <div className="text-red-500 p-4">Access Denied. Redirecting to an accessible page.</div>;
      }

      switch (currentManageDataSubView) {
        case 'teacherSubjectAssignments': {
          const isAsst = appData.currentUser?.role === 'assistant';
          const asstDepts = appData.currentUser?.assignedDepartments || [];
          const filteredAssignments = isAsst
            ? appData.teacherSubjectAssignments.filter(asm => {
                const teacher = appData.teachers.find(t => t.id === asm.teacherId);
                return teacher && teacher.department && asstDepts.includes(teacher.department);
              })
            : appData.teacherSubjectAssignments;

          return <TeacherSubjectAssignmentScreen 
                    appData={appData} 
                    assignments={filteredAssignments}
                    setAssignments={(updater) => setAppData(prev => prev ? ({...prev, teacherSubjectAssignments: typeof updater === 'function' ? updater(prev.teacherSubjectAssignments) : updater}) : null)}
                    getIcon={entityConfigurations.teacherSubjectAssignments.getIcon}
                    fields={entityConfigurations.teacherSubjectAssignments.fields!} 
                    {...screenAccessProps}
                 />;
        }
        case 'periodSettings':
          return <PeriodSettingsManagementScreen
                    periodSettings={appData.periodSettings}
                    setPeriodSettings={(updater) => setAppData(prev => prev ? ({...prev, periodSettings: typeof updater === 'function' ? updater(prev.periodSettings) : updater}) : null)}
                    deletePeriodSetting={handleDeletePeriodSetting}
                    {...screenAccessProps}
                 />;
        case 'organizationSettings':
          return <OrganizationSettingsScreen
                    organizationSettings={appData.organizationSettings}
                    setOrganizationSettings={(newSettings) => {
                       setAppData(prev => {
                          if (!prev) return null;
                          const oldEmail = prev.organizationSettings?.schoolAdminEmail?.trim().toLowerCase();
                          const newEmail = newSettings?.schoolAdminEmail?.trim().toLowerCase();
                          
                          let newUsers = [...prev.users];
                          let currentUser = prev.currentUser;

                          if (newEmail && newEmail !== oldEmail) {
                              // Downgrade old admin if necessary
                              if (oldEmail) {
                                  newUsers = newUsers.map(u => u.email.toLowerCase() === oldEmail ? { ...u, role: 'manager' } : u);
                                  if (currentUser?.email.toLowerCase() === oldEmail) {
                                      currentUser = { ...currentUser, role: 'manager' };
                                  }
                              }
                              // Upgrade or create new admin
                              const existingNewAdmin = newUsers.find(u => u.email.toLowerCase() === newEmail);
                              if (existingNewAdmin) {
                                  newUsers = newUsers.map(u => u.email.toLowerCase() === newEmail ? { ...u, role: 'admin' } : u);
                                  if (currentUser?.email.toLowerCase() === newEmail) {
                                      currentUser = { ...currentUser, role: 'admin' };
                                  }
                              } else {
                                  newUsers.push({
                                      id: crypto.randomUUID(),
                                      name: 'School Admin',
                                      email: newEmail,
                                      role: 'admin',
                                      organizationId: resolvedUserOrgId
                                  });
                              }
                          }

                          return {
                             ...prev,
                             organizationSettings: newSettings,
                             users: newUsers,
                             currentUser
                          };
                       });
                    }}
                    currentUser={appData.currentUser}
                    resolvedUserOrgId={resolvedUserOrgId}
                    {...screenAccessProps}
                 />;
        case 'academicStructure':
             return <AcademicStructureScreen
                        appData={appData}
                        setAppData={setAppData}
                        {...screenAccessProps}
                    />;
        case 'users':
          const departments = Array.from(new Set(appData.teachers.map(t => t.department).filter(Boolean))) as string[];
          return <UserManagementScreen
                    users={appData.users}
                    setUsers={(updater) => setAppData(prev => {
                        if (!prev) return null;
                        const newUsers = typeof updater === 'function' ? updater(prev.users) : updater;
                        let newCurrentUser = prev.currentUser;
                        if (newCurrentUser) {
                            const updatedMe = newUsers.find(u => u.id === newCurrentUser!.id);
                            if (updatedMe) newCurrentUser = updatedMe;
                        }
                        return { ...prev, users: newUsers, currentUser: newCurrentUser };
                    })}
                    currentUser={appData.currentUser}
                    departments={departments}
                    {...screenAccessProps}
                 />;
        case 'teacherLoadReport':
             return <TeacherLoadReportScreen appData={appData} />;
        case 'adminSettings':
             return <AdminSettingsScreen appData={appData} setAppData={setAppData as any} />;
        case 'systemHealth':
             return <SystemHealthScreen appData={appData} />;
        case 'teachers':
        case 'subjects':
        case 'gradeLevels':
        case 'classrooms':
        case 'physicalRooms':
        case 'departments':
        case 'resourceTypes':
            const entityKey = currentManageDataSubView as EntityType; 
            const isAsst = appData.currentUser?.role === 'assistant';
            const asstDepts = appData.currentUser?.assignedDepartments || [];

            let itemsToPass: any[] = [];
            if (entityKey === 'classrooms') {
               itemsToPass = (appData.gradeLevels || []).filter(gl => gl.name.includes('/'));
            } else {
               itemsToPass = (appData[entityKey as keyof AppData] as any[]) || [];
            }
            
            if (isAsst) {
              if (entityKey === 'teachers') {
                itemsToPass = (appData.teachers || []).filter(t => t.department && asstDepts.includes(t.department));
              } else if (entityKey === 'subjects') {
                itemsToPass = (appData.subjects || []).filter(s => {
                  if ((s as any).department && asstDepts.includes((s as any).department)) return true;
                  return (appData.teacherSubjectAssignments || []).some(link => 
                    link.subjectId === s.id && 
                    (appData.teachers || []).some(t => t.id === link.teacherId && t.department && asstDepts.includes(t.department))
                  );
                });
              }
            }

            const props = {
                entityType: entityKey, 
                items: itemsToPass, 
                setItems: (updater: React.SetStateAction<any[]>) => { 
                  setAppData(prev => {
                    if (!prev) return null;
                    if (entityKey === 'classrooms') {
                       const prevClassrooms = prev.gradeLevels.filter(gl => gl.name.includes('/'));
                       const updatedClassrooms = typeof updater === 'function' ? updater(prevClassrooms) : updater;
                       const otherGradeLevels = prev.gradeLevels.filter(gl => !gl.name.includes('/'));
                       return { ...prev, gradeLevels: [...otherGradeLevels, ...updatedClassrooms] };
                    }
                    const prevItems = (prev[entityKey as keyof AppData] as any[]) || [];
                    const updatedItems = typeof updater === 'function' ? updater(prevItems) : updater;
                    return { ...prev, [entityKey]: updatedItems };
                  });
                },
                formFields: entityConfigurations[entityKey].fields!,
                entityNameSingular: entityConfigurations[entityKey].singular,
                entityNamePlural: entityConfigurations[entityKey].plural,
                getIcon: entityConfigurations[entityKey].getIcon,
                appData: appData, 
                permissions: permissions,
                googleAccessToken: googleAccessToken,
            };
            switch(entityKey) {
              case 'teachers': return <EntityManagementScreen<Teacher> {...props} items={itemsToPass} entityType={entityKey} appData={appData} setAppData={setAppData}/>;
              case 'subjects': return <EntityManagementScreen<Subject> {...props} items={itemsToPass} entityType={entityKey} appData={appData} setAppData={setAppData}/>; 
              case 'gradeLevels': return <EntityManagementScreen<GradeLevel> {...props} items={itemsToPass} entityType={entityKey} appData={appData} setAppData={setAppData} />;
              case 'classrooms': return <EntityManagementScreen<GradeLevel> {...props} items={itemsToPass} entityType={entityKey}/>;
              case 'physicalRooms':
        case 'departments':
        case 'resourceTypes': return <EntityManagementScreen<PhysicalRoom> {...props} items={itemsToPass} entityType={entityKey}/>;
            }
            break; 
        default: 
          if (!currentManageDataSubView) {
              return <div className="p-8 flex items-center justify-center text-slate-500 h-full">กำลังโหลด...</div>;
          }
          const exhaustiveCheck: any = currentManageDataSubView; 
          return <div className="p-8 flex items-center justify-center text-slate-500 h-full">หน้าจอไม่พร้อมใช้งาน (Type: {exhaustiveCheck})</div>;
      }
    }
    return null; 
  };
  
  const NavButton: React.FC<{
    viewName: View | ManageDataSubView | 'logout' | 'backup' | 'restore' | 'importData';
    label: string;
    icon: React.ElementType;
    isActive?: boolean;
    onClick?: () => void; 
    isSubItem?: boolean;
    className?: string;
    isFileInput?: boolean; 
    onFileChange?: (event: ChangeEvent<HTMLInputElement>) => void; 
  }> = ({ viewName, label, icon: Icon, isActive, onClick, isSubItem, className, isFileInput, onFileChange }) => {
    
    // Safety guard for undefined Icon
    const SafeIcon = Icon || Icons.DataManagement || (() => <div className="w-5 h-5" />);

    if (isFileInput) {
        return (
            <label className={`flex items-center w-full text-left px-3 py-2.5 rounded-md transition-colors duration-150 ease-in-out cursor-pointer overflow-hidden
                ${isSubItem ? 'pl-5 text-sm' : 'text-base'}
                ${isActive ? 'bg-blue-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200 hover:text-slate-800'}
                ${className || ''}`}
                htmlFor="restore-file-input"
            >
                <div className="w-6 flex justify-center shrink-0 mr-3">
                  <SafeIcon size={isSubItem ? 18 : 20} />
                </div>
                <span className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300">{label}</span>
                <input type="file" id="restore-file-input" accept=".json" className="hidden" onChange={onFileChange} />
            </label>
        );
    }
    return (
    <button
      onClick={onClick}
      className={`flex items-center w-full text-left px-3 py-2.5 rounded-md transition-colors duration-150 ease-in-out overflow-hidden
        ${isSubItem ? 'pl-5 text-sm' : 'text-base'}
        ${isActive ? 'bg-blue-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-200 hover:text-slate-800'}
        ${className || ''}`}
      aria-current={isActive ? "page" : undefined}
    >
      <div className="w-6 flex justify-center shrink-0 mr-3">
        <SafeIcon size={isSubItem ? 18 : 20} />
      </div>
      <span className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">{label}</span>
    </button>
  )};

  const manageDataSubViewItems: ManageDataSubView[] = [
    'organizationSettings',
    'departments',
    'resourceTypes',
    'academicStructure',
    'periodSettings',
    'teachers',
    'subjects',
    'gradeLevels',
    'physicalRooms',
    'teacherSubjectAssignments',
    'teacherLoadReport',
    'users',
    'adminSettings',
    'systemHealth',
  ];

  if (!isDataLoaded || isAuthChecking || !appData) {
    return <div className="flex justify-center items-center h-screen text-xl text-slate-600">Loading application...</div>;
  }
  if (!appData.currentUser) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  
  const isSuperAdmin = (appData.authorizedAdmins || []).includes(appData.currentUser.email);
  const isAuthAdmin = (appData.authorizedAdmins || []).includes(appData.currentUser.email);
  if (appData.currentUser.role === 'guest' && !isSuperAdmin && !isAuthAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center font-sans" id="waiting-approval-lander">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 space-y-6">
          <div className="flex justify-center">
            <div className="p-4 bg-amber-50 rounded-full border border-amber-200 text-amber-500">
              <Icons.Warning size={48} />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-800">รอการตรวจสอบและอนุมัติสิทธิ์</h2>
            <p className="text-sm font-semibold text-amber-600 bg-amber-50 px-3 py-1 rounded-full inline-block">
              สถานะ: แขก / ผู้เยี่ยมชม (Guest)
            </p>
          </div>
          <p className="text-slate-600 leading-relaxed text-sm">
            บัญชีของคุณได้รับการลงทะเบียนในสิทธิ์ "ผู้เยี่ยมชม (Guest)" เรียบร้อยแล้ว กรุณาติดต่อผู้ดูแลระบบของโรงเรียนท่าน เพื่อทำการเลื่อนสิทธิ์/บทบาทและจัดการตารางสอนได้อย่างเป็นทางการ
          </p>
          <div className="border-t border-slate-100 pt-6 flex flex-col items-center space-y-3">
            <div className="text-xs text-slate-500">
              อีเมลล็อกอิน: <strong className="font-mono text-slate-700">{appData.currentUser.email}</strong>
            </div>
            <button
              onClick={() => {
                import('./lib/firebase').then(({ logout }) => {
                  logout();
                });
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-200"
            >
              <Icons.Logout size={16} />
              <span>ออกจากระบบ (Logout)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const executeRestore = async () => {
      if (restoreConfirmationText !== 'RESTORE') {
          alert("Please type 'RESTORE' exactly to confirm.");
          return;
      }
      if (!restoreFile) return;

      try {
          const text = await restoreFile.text();
          const parsedData = JSON.parse(text);
          
          if (appData) {
            setAppData({
                ...parsedData.data,
                currentUser: appData.currentUser // preserve current user
            });
          }
          
          setShowRestoreConfirm(false);
          setRestoreFile(null);
          setRestoreConfirmationText("");
          alert("Data restored successfully!");
      } catch (e) {
          alert("Restore failed.");
      }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-100 print:block">
      <nav className="w-full md:w-[80px] md:hover:w-72 bg-white px-2 py-4 shadow-lg md:min-h-screen border-r border-slate-200 flex flex-col transition-all duration-300 ease-in-out z-30 group shrink-0 overflow-x-hidden whitespace-nowrap md:fixed md:h-screen md:top-0 print:hidden" aria-label="Main navigation">
        <div>
          <div className="text-2xl font-bold text-blue-700 mb-6 flex items-center overflow-hidden px-2">
              <div className="w-8 flex justify-center shrink-0 mr-3"><Icons.Schedule size={28}/></div>
              <span className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300">{APP_TITLE}</span>
          </div>
          {appData.currentUser && ( 
              <div className="mb-4 p-3 bg-slate-50 rounded-md border border-slate-200 text-sm overflow-hidden opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 mx-1">
                  <p className="text-slate-700 font-semibold truncate" title={appData.currentUser.name}>ผู้ใช้ปัจจุบัน: {appData.currentUser.name}</p>
                  <p className="text-slate-500">บทบาท: {appData.currentUser.role === 'admin' ? 'ผู้ดูแลระบบ' : appData.currentUser.role === 'manager' ? 'ผู้จัดการ' : appData.currentUser.role === 'assistant' ? 'ผู้ช่วยจัดตาราง' : 'แขก'}</p>
              </div>
          )}
          <ul className="space-y-1.5">
            <li>
              <NavButton
                viewName="schedule"
                label="Schedule Planner"
                icon={Icons.Schedule}
                isActive={currentView === 'schedule'}
                onClick={() => setCurrentView('schedule')}
              />
            </li>
            <li>
              <NavButton
                  viewName="manageData"
                  label="Manage Data"
                  icon={Icons.DataManagement}
                  isActive={currentView === 'manageData'}
                  onClick={() => {
                    setCurrentView('manageData');
                    const allowedAssistantViews: ManageDataSubView[] = ['teachers', 'subjects', 'teacherSubjectAssignments'];
                    const allowedManagerViews: ManageDataSubView[] = ['teachers', 'subjects', 'teacherSubjectAssignments'];
                    let defaultSubView: ManageDataSubView = 'organizationSettings'; 
                    if (appData.currentUser?.role === 'assistant') {
                        defaultSubView = allowedAssistantViews.includes(currentManageDataSubView as ManageDataSubView) ? currentManageDataSubView : 'subjects';
                    } else if (appData.currentUser?.role === 'manager') {
                        defaultSubView = allowedManagerViews.includes(currentManageDataSubView as ManageDataSubView) ? currentManageDataSubView : 'subjects';
                    } else if (appData.currentUser?.role === 'admin') {
                        defaultSubView = manageDataSubViewItems.includes(currentManageDataSubView as ManageDataSubView) ? currentManageDataSubView : 'organizationSettings';
                    }
                    setCurrentManageDataSubView(defaultSubView);
                  }}
              />
              {currentView === 'manageData' && (
                <ul className="mt-1 space-y-1 pl-1 md:pl-2 border-l-2 border-transparent md:group-hover:border-slate-200 ml-1 md:ml-2 md:opacity-0 md:group-hover:opacity-100 transition-all duration-300" role="menu">
                  {manageDataSubViewItems.map(key => {
                    const entityKey = key as ManageDataSubView;
                    const config = entityConfigurations[entityKey]; 
                    if (!config) return null; 

                    if (appData.currentUser?.role === 'assistant') {
                        const allowedAssistantSidebarViews: ManageDataSubView[] = ['teachers', 'subjects', 'teacherSubjectAssignments'];
                        if (!allowedAssistantSidebarViews.includes(entityKey)) {
                            return null; 
                        }
                    } else if (appData.currentUser?.role === 'manager') {
                        const allowedManagerSidebarViews: ManageDataSubView[] = ['teachers', 'subjects', 'teacherSubjectAssignments'];
                        if (!allowedManagerSidebarViews.includes(entityKey)) {
                            return null; 
                        }
                    } else if (appData.currentUser?.role !== 'admin') { 
                         const guestAllowedViews: ManageDataSubView[] = []; 
                         if(!guestAllowedViews.includes(entityKey)) return null;
                    }

                    // Only admin can manage users
                    if (entityKey === 'users' && appData.currentUser?.role !== 'admin') {
                        return null;
                    }

                    if (entityKey === 'adminSettings') {
                        const isSuperAdmin = (appData.authorizedAdmins || []).includes(appData.currentUser?.email || '');
                        const isAuthAdmin = (appData.authorizedAdmins || []).includes(appData.currentUser?.email || '');
                        if (!isSuperAdmin && !isAuthAdmin) {
                            return null;
                        }
                    }

                    return (
                      <li key={entityKey} role="none">
                        <NavButton
                          viewName={entityKey}
                          label={config.plural}
                          icon={config.getIcon()}
                          isActive={currentView === 'manageData' && currentManageDataSubView === entityKey}
                          onClick={() => {
                            setCurrentView('manageData');
                            setCurrentManageDataSubView(entityKey);
                          }}
                          isSubItem
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
            <li>
              <NavButton
                viewName="importData" 
                label="Import Data (Excel)" 
                icon={Icons.Import}
                isActive={isImportModalOpen} 
                onClick={() => setIsImportModalOpen(true)}
              />
            </li>
            {appData?.currentUser?.role === 'admin' && (
              <>
                <div className="my-2 border-t border-slate-200"></div>
                <li>
                  <NavButton
                    viewName="backup"
                    label="Backup Data (JSON)"
                    icon={Icons.Backup}
                    onClick={handleBackupData}
                  />
                </li>
                <li>
                  <NavButton
                    viewName="restore"
                    label="Restore Data (JSON)"
                    icon={Icons.Restore}
                    isFileInput={true}
                    onFileChange={handleRestoreData}
                  />
                </li>
              </>
            )}
          </ul>
        </div>
        <div className="mt-auto pt-4"> 
            <NavButton
                viewName="logout"
                label="Logout"
                icon={Icons.Logout} 
                onClick={handleLogout}
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
            />
        </div>
      </nav>
      <main className="flex-1 p-4 md:p-8 overflow-auto md:ml-[80px] print:ml-0 print:p-0 print:overflow-visible">
        {impersonatedOrgId && (
          <div className="bg-amber-500 text-white font-medium p-3 rounded-lg mb-6 flex justify-between items-center shadow-md animate-pulse shrink-0 print:hidden">
            <div className="flex items-center space-x-2">
              <span className="text-xl">⚠️</span>
              <span>
                กำลังอยู่ใน <strong>โหมดช่วยจัดตารางสอนทำงานแทนสถาบัน (Support Only Mode)</strong> สำหรับสถาบันรหัส: <code className="bg-amber-600 px-1.5 py-0.5 rounded font-bold text-xs">{impersonatedOrgId}</code> - ข้อมูลนี้เปิดใน <strong>โหมดอ่านอย่างเดียว (Read-Only)</strong>
              </span>
            </div>
            <button
              onClick={() => {
                setImpersonatedOrgId(null);
              }}
              className="bg-white text-amber-900 hover:bg-amber-50 text-xs px-2.5 py-1.5 rounded font-bold shadow-sm transition-all shadow-amber-900/10"
            >
              ออกจากโหมดเลียนแบบ
            </button>
          </div>
        )}
        {renderView()}
      </main>
      
      {isDataLoaded && appData && ( 
        <ImportDataModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          appData={appData}
          setAppData={setAppData}
          entityConfigurations={entityConfigurations as Record<ImportableEntityType, { singular: string; plural: string; fields: FormField[]; getIcon: () => React.ElementType }>}
        />
      )}

      {showRestoreConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl border border-red-100 p-6 max-w-md w-full animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-4 text-red-600 mb-4">
              <Icons.Warning size={32} />
              <h3 className="text-xl font-bold">Destructive Action Warning</h3>
            </div>
            <p className="text-slate-700 mb-6">
              🚨 <strong>Warning:</strong> Restoring this backup will completely replace all current timetable and settings data. This action cannot be undone.
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Please type <span className="font-mono bg-red-100 text-red-800 px-1 rounded">RESTORE</span> to confirm:
              </label>
              <input
                type="text"
                className="w-full border border-slate-300 rounded-md p-2 focus:ring-red-500 focus:border-red-500 font-mono"
                value={restoreConfirmationText}
                onChange={(e) => setRestoreConfirmationText(e.target.value)}
                placeholder="RESTORE"
              />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowRestoreConfirm(false);
                  setRestoreFile(null);
                  setRestoreConfirmationText("");
                }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeRestore}
                disabled={restoreConfirmationText !== 'RESTORE'}
                className="px-4 py-2 bg-red-600 text-white rounded-md font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                Apply Restore
              </button>
            </div>
          </div>
        </div>
      )}
      
      {isPrintOptionsModalOpen && printOptionsModalProps && appData && (
        <PrintWithOptionsModal
            isOpen={isPrintOptionsModalOpen}
            onClose={() => setIsPrintOptionsModalOpen(false)}
            onConfirmPrint={handleActualPrint}
            itemType={printOptionsModalProps.itemType}
            currentItemId={printOptionsModalProps.currentItemId}
            allItems={printOptionsModalProps.allItems}
            appData={appData}
            googleAccessToken={googleAccessToken}
        />
      )}
      
      {printJob && appData && (
        <PrintLayout
          appData={appData}
          printOptions={printJob}
          onPrintComplete={() => setPrintJob(null)}
          getEntryDisplay={getEntryDisplay}
          permissions={permissions}
        />
      )}

    </div>
  );
};
export default App;