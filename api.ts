import { AppData, Subject, PeriodSetting, User, ScheduleEntry, GradeLevel, Teacher, TeacherSubjectAssignment, PhysicalRoom, OrganizationSettings, FormField, DayOfWeek } from './types';
import { DEFAULT_PERIOD_SETTINGS, PREDEFINED_SUBJECT_COLORS } from './constants';
import { db } from './lib/firebase';
import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';

export const DEFAULT_DEPARTMENTS = [
  { id: 'dep1', name: 'Science' },
  { id: 'dep2', name: 'Mathematics' },
  { id: 'dep3', name: 'Chemistry' },
  { id: 'dep4', name: 'ภาษาไทย' },
  { id: 'dep5', name: 'สังคมศึกษา ศาสนาและวัฒนธรรม' },
  { id: 'dep6', name: 'สุขศึกษาและพลศึกษา' },
  { id: 'dep7', name: 'ศิลปะ' },
  { id: 'dep8', name: 'การงานอาชีพ' },
  { id: 'dep9', name: 'ภาษาต่างประเทศ' },
];

export const DEFAULT_RESOURCE_TYPES = [
  { id: 'rt1', name: 'ห้องเรียนทั่วไป' },
  { id: 'rt2', name: 'ห้องปฏิบัติการ' },
  { id: 'rt3', name: 'ห้องประชุม' },
  { id: 'rt4', name: 'ห้องสำนักงาน' },
  { id: 'rt5', name: 'หอประชุม' },
  { id: 'rt6', name: 'สนาม' },
  { id: 'rt7', name: 'โดม' }
];

export const safeUpsert = (existing: any[] | undefined, defaults: any[]) => {
  if (!existing || !Array.isArray(existing)) existing = [];
  const result = [...existing];
  defaults.forEach(def => {
    const exists = result.find(e => e.id === def.id || e.name === def.name);
    if (!exists) {
      result.push(def);
    }
  });
  return result;
};

export const getSampleAppData = (): AppData => {
  const sampleAdminUser: User = { id: 'admin-user', name: 'Admin', email: 'admin@example.com', role: 'admin' };
   
  const departments = [...DEFAULT_DEPARTMENTS];

  const resourceTypes = [...DEFAULT_RESOURCE_TYPES];
  const gradeLevels: GradeLevel[] = [
    { id: 'm1', name: 'M.1' },
    { id: 'm4_8', name: 'M.4/8', homeroomPhysicalRoomId: 'r4' },
    { id: 'm5', name: 'M.5' },
    { id: 'm5_8', name: 'M.5/8', homeroomPhysicalRoomId: 'r3' }
  ];

  const teachers: Teacher[] = [
    { id: 't1', name: 'Dr. Smith', teacherCode: 'T101', department: 'Science', email: 'smith@example.com' },
    { id: 't2', name: 'Ms. Jones', teacherCode: 'T201', department: 'Mathematics', email: 'jones@example.com' },
    { id: 't3', name: 'Mr. Brown', teacherCode: 'T102', department: 'Chemistry', email: 'brown@example.com' },
    { id: 't4', name: 'Mr.Kiattisak', teacherCode: 'T202', department: 'Mathematics', email: 'kiattisak@example.com' },
    { id: 't5', name: 'Mrs.Koy Koy', teacherCode: 'T203', department: 'Mathematics', email: 'koy@example.com' },
    { id: 't6', name: 'Mrs.Noi Noi', teacherCode: 'T103', department: 'Chemistry', email: 'noi@example.com' }
  ];

  const subjects: Subject[] = [
    { id: 's1', name: 'Mathematics', color: '#FF6B6B', subjectCode: 'MTH101', periodsPerWeek: 5, teachingMode: 'single', schedulingPattern: '2/2/1', allowClassroomSharing: false, isHomeroomAdvisorySubject: false, autoLinkToHomeroomTeachers: false, applicableParentGradeLevelIds: ['m1'] },
    { id: 's2', name: 'Physics', color: '#4ccd73', subjectCode: 'PHY101', periodsPerWeek: 3, teachingMode: 'single', schedulingPattern: '2/1', allowClassroomSharing: false, isHomeroomAdvisorySubject: false, autoLinkToHomeroomTeachers: false },
    { id: 's3', name: 'Chemistry Lab', color: '#45B7D1', subjectCode: 'CHM-Lab', periodsPerWeek: 2, teachingMode: 'multiple', schedulingPattern: '2', allowClassroomSharing: true, isHomeroomAdvisorySubject: false, autoLinkToHomeroomTeachers: false },
    { id: 's4', name: 'คณิตศาสตร์พื้นฐาน', color: '#4ECDC4', subjectCode: 'ค32101', periodsPerWeek: 2, teachingMode: 'single', schedulingPattern: '1/1', allowClassroomSharing: false, isHomeroomAdvisorySubject: false, autoLinkToHomeroomTeachers: false, applicableParentGradeLevelIds: ['m5'] },
    { id: 's5', name: 'คณิตศาสตร์เพิ่มเติม', color: '#FED766', subjectCode: 'ค32201', periodsPerWeek: 4, teachingMode: 'single', schedulingPattern: '1/1/1/1', allowClassroomSharing: false, isHomeroomAdvisorySubject: false, autoLinkToHomeroomTeachers: false, applicableParentGradeLevelIds: ['m5'] }
  ];

  const teacherSubjectAssignments: TeacherSubjectAssignment[] = [
    { id: 'link_1', teacherId: 't2', subjectId: 's1', gradeLevelId: 'm1' },
    { id: 'link_2', teacherId: 't4', subjectId: 's4', gradeLevelId: 'm5_8' },
    { id: 'link_3', teacherId: 't5', subjectId: 's5', gradeLevelId: 'm5_8' },
    { id: 'link_4', teacherId: 't1', subjectId: 's2', gradeLevelId: 'm4_8' },
    { id: 'link_5', teacherId: 't3', subjectId: 's3', gradeLevelId: 'm4_8' },
    { id: 'link_6', teacherId: 't6', subjectId: 's3', gradeLevelId: 'm4_8' }
  ];

  const defaultOrgSettings: OrganizationSettings = {
    name: "โรงเรียนตัวอย่างพัฒนาการวิทยา",
    semester: "1",
    academicYear: "2569",
    operatingDays: [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday] as DayOfWeek[],
    directorName: "ดร.สมยศ รักดี",
    directorPosition: "ผู้อำนวยการโรงเรียน",
    deputyDirectorName: "นางสาวสมหญิง นำทาง",
    deputyDirectorPosition: "รองผู้อำนวยการฝ่ายวิชาการ"
  };

  const scheduleEntries: ScheduleEntry[] = [
    {
      id: "sh_1",
      gradeLevelId: "m1",
      day: DayOfWeek.Monday,
      period: 1,
      subjectId: "s1",
      teacherIds: ["t2"],
      physicalRoomId: "r1",
      blockId: "bk_1",
      blockIndex: 0,
      totalInBlock: 2
    },
    {
      id: "sh_2",
      gradeLevelId: "m1",
      day: DayOfWeek.Monday,
      period: 2,
      subjectId: "s1",
      teacherIds: ["t2"],
      physicalRoomId: "r1",
      blockId: "bk_1",
      blockIndex: 1,
      totalInBlock: 2
    }
  ];

  return {
    departments,
    resourceTypes,
    teachers,
    subjects,
    gradeLevels,
    physicalRooms: [],
    scheduleEntries,
    periodSettings: DEFAULT_PERIOD_SETTINGS.map((ps, index) => ({...ps, id: ps.id || `p${index}`})),
    teacherSubjectAssignments,
    organizationSettings: defaultOrgSettings,
    users: [sampleAdminUser],
    currentUser: null,
    authorizedAdmins: [],
  };
};

export const getInitialAppDataForApi = (): AppData => {
    // keeping defaults...
    const initialAdminUser: User | null = null;
    const physicalRooms: PhysicalRoom[] = [
        {id: 'r1', code: '931', name: 'Computer Lab, Building 9 Fl 3 Room 1', type: 'ห้องปฏิบัติการ'},
        {id: 'r2', code: 'F001', name: 'Football Field', type: 'สนาม/ลานกิจกรรม'},
        {id: 'r3', code: 'M001', name: 'Meeting Room', type: 'ห้องเรียนทั่วไป'},
        {id: 'r4', code: '943', name: 'Homeroom M.5/8', type: 'ห้องเรียนทั่วไป'}
    ];
    const gradeLevels: GradeLevel[] = [
        {id: 'm1', name: 'M.1'}, 
    ];
    const teachers: Teacher[] = [];
    const subjects: Subject[] = [];
    const teacherSubjectAssignments: TeacherSubjectAssignment[] = [];
    const defaultOrgSettings: OrganizationSettings = {
        name: "โรงเรียนตัวอย่างพัฒนาการ",
        semester: "1",
        academicYear: new Date().getFullYear().toString(),
        operatingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as DayOfWeek[],
    };
    return {
        departments: [...DEFAULT_DEPARTMENTS], resourceTypes: [...DEFAULT_RESOURCE_TYPES],
        teachers, subjects, gradeLevels, physicalRooms, scheduleEntries: [],
        periodSettings: DEFAULT_PERIOD_SETTINGS.map((ps, index) => ({...ps, id: ps.id || `p${index}`})),
        teacherSubjectAssignments, organizationSettings: defaultOrgSettings,
        users: initialAdminUser ? [initialAdminUser] : [], currentUser: null, authorizedAdmins: [], 
    };
};

export const fetchAppData = async (orgId: string = 'default'): Promise<AppData> => {
  const defaultInitialData = getSampleAppData();
  try {
    const docRef = doc(db, 'apps', orgId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const parsedData = docSnap.data() as any;
      const subjectsWithDefaults = (parsedData.subjects || []).map((s: Subject) => ({...s, teachingMode: s.teachingMode || 'single'}));
      
      const resolvedData: AppData = {
        departments: safeUpsert(parsedData.departments, defaultInitialData.departments), resourceTypes: safeUpsert(parsedData.resourceTypes, defaultInitialData.resourceTypes), teachers: parsedData.teachers || [],
        subjects: subjectsWithDefaults,
        gradeLevels: parsedData.gradeLevels || [],
        physicalRooms: parsedData.physicalRooms || [],
        scheduleEntries: parsedData.scheduleEntries || [],
        periodSettings: parsedData.periodSettings || defaultInitialData.periodSettings,
        teacherSubjectAssignments: parsedData.teacherSubjectAssignments || [],
        organizationSettings: parsedData.organizationSettings || defaultInitialData.organizationSettings,
        users: parsedData.users && parsedData.users.length > 0 ? parsedData.users : defaultInitialData.users,
        activityLogs: parsedData.activityLogs || [],
        authorizedAdmins: parsedData.authorizedAdmins || [],
        currentUser: null, 
      };
      return resolvedData;
    }
  } catch (error) {
    console.warn(`Failed to parse data from Firestore for org ${orgId}, falling back to initial data:`, error);
  }
  return defaultInitialData;
};

const cleanUndefined = (obj: any): any => {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined) {
        cleaned[key] = cleanUndefined(val);
      }
    }
    return cleaned;
  }
  return obj;
};

export const saveAppData = async (data: AppData, orgId: string = 'default'): Promise<void> => {
  try {
    const docRef = doc(db, 'apps', orgId);
    // Ensure we don't save currentUser state
    const dataToSave = { ...data, currentUser: null, orgId, organizationId: orgId };
    const cleanedData = cleanUndefined(dataToSave);
    
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(docRef);
      if (docSnap.exists()) {
         const serverData = docSnap.data() as AppData;
         
         // Check if the isLocked setting itself has changed
         const oldLocked = !!serverData.organizationSettings?.isLocked;
         const newLocked = !!cleanedData.organizationSettings?.isLocked;
         if (oldLocked !== newLocked) {
             if (data.currentUser?.role !== 'admin') {
                 throw new Error("403_FORBIDDEN_ADMIN_ONLY");
             }
         }

         if (serverData.organizationSettings?.isLocked && oldLocked === newLocked) {
             const serverEntriesStr = JSON.stringify(serverData.scheduleEntries || []);
             const newEntriesStr = JSON.stringify(cleanedData.scheduleEntries || []);
             if (serverEntriesStr !== newEntriesStr) {
                 throw new Error("403_FORBIDDEN_LOCKED");
             }
         }

         const serverEntries = serverData.scheduleEntries || [];
         const newEntries = cleanedData.scheduleEntries || [];
         
         const serverAssignments = serverData.teacherSubjectAssignments || [];
         const newAssignments = cleanedData.teacherSubjectAssignments || [];
         const removedAssignments = serverAssignments.filter((oldA: any) => !newAssignments.some((newA: any) => newA.id === oldA.id));
         for (const removed of removedAssignments) {
             const hasDependency = newEntries.some((entry: any) => 
                 entry.subjectId === removed.subjectId && 
                 entry.teacherIds?.includes(removed.teacherId) &&
                 entry.gradeLevelId === removed.gradeLevelId
             );
             if (hasDependency) {
                 throw new Error("409_CONFLICT_ASSIGNMENT_IN_USE");
             }
         }

         // Find modified or newly added entries
         // An entry is "new/modified" if it is in newEntries but its exact state is not in serverEntries
         // For race condition prevention, we just check if any new entry conflicts with an existing server entry
         // A conflict is when:
         // - Same gradeLevel, day, period (different entry ID)
         // - Same teacher, day, period (different entry ID)
         // - Same physicalRoom, day, period (different entry ID)

         for (const newEntry of newEntries) {
            // Check if this newEntry's state was changed from what we knew
            const serverEntry = serverEntries.find((se: any) => se.id === newEntry.id);
            const isUnchanged = serverEntry && 
                serverEntry.day === newEntry.day && 
                serverEntry.period === newEntry.period && 
                serverEntry.gradeLevelId === newEntry.gradeLevelId &&
                serverEntry.physicalRoomId === newEntry.physicalRoomId &&
                JSON.stringify(serverEntry.teacherIds) === JSON.stringify(newEntry.teacherIds);

            if (isUnchanged) continue;

            // It's changed or new. Check for conflicts with OTHER server entries.
            const conflictingGrade = serverEntries.find((se: any) => se.id !== newEntry.id && se.day === newEntry.day && se.period === newEntry.period && se.gradeLevelId === newEntry.gradeLevelId && !(se.cohort && newEntry.cohort && se.cohort !== newEntry.cohort));
            const conflictingRoom = newEntry.physicalRoomId ? serverEntries.find((se: any) => {
                if (se.id !== newEntry.id && se.day === newEntry.day && se.period === newEntry.period && se.physicalRoomId === newEntry.physicalRoomId && !(se.cohort && newEntry.cohort && se.cohort !== newEntry.cohort)) {
                    const existingSubject = cleanedData.subjects?.find((s: any) => s.id === se.subjectId);
                    const newSubject = cleanedData.subjects?.find((s: any) => s.id === newEntry.subjectId);
                    const isSharable = (subject: any) => Boolean(subject?.allowPhysicalRoomSharing === true || subject?.allowPhysicalRoomSharing === 'true' || subject?.allowPhysicalRoomSharing === 1 || subject?.type === 'STUDENT_ONLY' || subject?.subjectType === 'STUDENT_ONLY');
                    if (isSharable(existingSubject) && isSharable(newSubject)) {
                        return false;
                    }
                    return true;
                }
                return false;
            }) : null;
            const conflictingTeacher = serverEntries.find((se: any) => se.id !== newEntry.id && se.day === newEntry.day && se.period === newEntry.period && se.teacherIds?.some((tid: string) => newEntry.teacherIds?.includes(tid)) && !(se.cohort && newEntry.cohort && se.cohort !== newEntry.cohort));

            if (conflictingGrade || conflictingRoom || conflictingTeacher) {
                // Determine error message safely inside the promise
                // We'll throw an Error to abort the transaction.
                throw new Error("RACE_CONDITION_CONFLICT");
            }
         }
      }
      
      transaction.set(docRef, cleanedData, { merge: true });
    });
  } catch (error: any) {
    if (error.message === "403_FORBIDDEN_ADMIN_ONLY") {
        alert("403 Forbidden: เฉพาะแอดมินหลักประจำโรงเรียนเท่านั้นที่มีสิทธิ์ล็อกหรือปลดล็อกตารางเรียน (Authorized School Admin Only)");
    } else if (error.message === "403_FORBIDDEN_LOCKED") {
        alert("ไม่สามารถแก้ไขได้ เนื่องจากตารางเรียนประจำภาคเรียนนี้ถูกล็อกโดยฝ่ายวิชาการแล้ว");
    } else if (error.message === "RACE_CONDITION_CONFLICT") {
        alert("🚨 Conflict Detected: Another user has already updated this schedule block. Your changes will be reverted to match the server.");
        // The onSnapshot listener will automatically pull the newest state and revert the UI.
    } else if (error.message === "409_CONFLICT_ASSIGNMENT_IN_USE") {
        alert("ไม่สามารถลบลิงค์มอบหมายงานได้ (Action Blocked)\n\nรายวิชานี้ของรายชื่อครูดังกล่าว ถูกจัดวางลงบนตารางเรียน (Timetable Grid) ไปเรียบร้อยแล้ว หากต้องการลบลิงค์นี้ กรุณาไปลบคาบเรียนของวิชานี้ออกจากตารางสอนของห้องดังกล่าวให้หมดก่อน จึงจะกลับมาทำรายการลบลิงค์นี้ได้");
    } else {
        console.error(`Error saving data to Firestore API for org ${orgId}:`, error);
        throw error;
    }
  }
};

export const resetSemesterTimetable = async (orgId: string = 'default', currentUser: any): Promise<void> => {
  try {
    if (currentUser?.role !== 'admin') {
      throw new Error("403_FORBIDDEN_ADMIN_ONLY");
    }
    const docRef = doc(db, 'apps', orgId);
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(docRef);
      if (!docSnap.exists()) return;
      const data = docSnap.data() as AppData;
      
      const updatedData = {
        ...data,
        scheduleEntries: [],
        teacherSubjectAssignments: [],
        activityLogs: [{
          id: crypto.randomUUID(),
          action: `System reset for the new semester by ${currentUser?.name || currentUser?.email || 'Admin'}`,
          entityType: "system",
          entityId: "system",
          timestamp: new Date().toISOString(),
          userName: currentUser?.name || currentUser?.email || "Admin"
        }],
        organizationSettings: {
          ...data.organizationSettings,
          isLocked: false // unlock automatically
        }
      };
      const cleanedData = cleanUndefined(updatedData);
      transaction.set(docRef, cleanedData, { merge: true });
    });
  } catch (error: any) {
    if (error.message === "403_FORBIDDEN_ADMIN_ONLY") {
      alert("403 Forbidden: เฉพาะ Admin เท่านั้นที่มีสิทธิ์ล้างตารางเรียนเพื่อเริ่มภาคเรียนใหม่");
    } else {
      console.error("Error resetting semester timetable:", error);
      throw error;
    }
  }
};