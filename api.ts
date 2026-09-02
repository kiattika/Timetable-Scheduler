import { AppData, Subject, PeriodSetting, User, ScheduleEntry, GradeLevel, Teacher, TeacherSubjectAssignment, PhysicalRoom, OrganizationSettings, FormField, DayOfWeek, ActivityLog } from './types';
import { DEFAULT_PERIOD_SETTINGS, PREDEFINED_SUBJECT_COLORS } from './constants';
import { db, auth, functions } from './lib/firebase';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch, query, orderBy, limit, deleteField, runTransaction } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

export const ORG_ID = import.meta.env.VITE_ORG_ID || 'utd';

export const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const pruneActivityLogs = (logs: ActivityLog[] = [], maxDays: number = 7): ActivityLog[] => {
  const cutoffTime = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  return logs.filter(log => {
    if (!log || !log.timestamp) return false;
    const logTime = new Date(log.timestamp).getTime();
    return !isNaN(logTime) && logTime >= cutoffTime;
  });
};

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
  const sampleAdminUser: User = { id: 'admin-user', name: 'Admin', email: 'admin@utd.ac.th', role: 'admin' };
   
  const departments = [...DEFAULT_DEPARTMENTS];
  const resourceTypes = [...DEFAULT_RESOURCE_TYPES];
  const gradeLevels: GradeLevel[] = [
    { id: 'm1', name: 'M.1' },
    { id: 'm4_8', name: 'M.4/8', homeroomPhysicalRoomId: 'r4' },
    { id: 'm5', name: 'M.5' },
    { id: 'm5_8', name: 'M.5/8', homeroomPhysicalRoomId: 'r3' }
  ];

  const teachers: Teacher[] = [
    { id: 't1', name: 'Dr. Smith', teacherCode: 'T101', department: 'Science', email: 'smith@utd.ac.th' },
    { id: 't2', name: 'Ms. Jones', teacherCode: 'T201', department: 'Mathematics', email: 'jones@utd.ac.th' },
    { id: 't3', name: 'Mr. Brown', teacherCode: 'T102', department: 'Chemistry', email: 'brown@utd.ac.th' },
    { id: 't4', name: 'Mr.Kiattisak', teacherCode: 'T202', department: 'Mathematics', email: 'kiattisak@utd.ac.th' },
    { id: 't5', name: 'Mrs.Koy Koy', teacherCode: 'T203', department: 'Mathematics', email: 'koy@utd.ac.th' },
    { id: 't6', name: 'Mrs.Noi Noi', teacherCode: 'T103', department: 'Chemistry', email: 'noi@utd.ac.th' }
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
    name: "โรงเรียนอุตรดิตถ์",
    semester: "1",
    academicYear: "2569",
    operatingDays: [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday] as DayOfWeek[],
    directorName: "ผู้อำนวยการโรงเรียนอุตรดิตถ์",
    directorPosition: "ผู้อำนวยการโรงเรียน",
    deputyDirectorName: "รองผู้อำนวยการฝ่ายวิชาการ",
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

export const fetchAppData = async (orgId: string = ORG_ID): Promise<AppData> => {
  const defaultInitialData = getSampleAppData();
  try {
    const docRef = doc(db, 'apps', orgId);
    let docSnap: any = null;
    try {
      docSnap = await getDoc(docRef);
    } catch (docErr: any) {
      console.warn("Main doc getDoc notice:", docErr?.message || docErr);
    }

    // Fetch subcollection: scheduleEntries (safely without failing)
    let loadedScheduleEntries: ScheduleEntry[] = [];
    try {
      const scheduleEntriesRef = collection(db, 'apps', orgId, 'scheduleEntries');
      const scheduleSnap = await getDocs(scheduleEntriesRef);
      if (!scheduleSnap.empty) {
        loadedScheduleEntries = scheduleSnap.docs.map(d => ({ ...d.data(), id: d.id } as ScheduleEntry));
      }
    } catch (subErr) {
      console.warn("Subcollection scheduleEntries notice (using main doc):", subErr);
    }

    // Fetch subcollection: activityLogs (safely without failing)
    let loadedActivityLogs: ActivityLog[] = [];
    try {
      const activityLogsRef = collection(db, 'apps', orgId, 'activityLogs');
      const activityLogsQuery = query(activityLogsRef, orderBy('timestamp', 'desc'), limit(100));
      const activitySnap = await getDocs(activityLogsQuery);
      if (activitySnap && !activitySnap.empty) {
        loadedActivityLogs = activitySnap.docs.map(d => ({ ...d.data(), id: d.id } as ActivityLog));
      }
    } catch (logErr) {
      console.warn("Subcollection activityLogs notice:", logErr);
    }

    if (docSnap && docSnap.exists()) {
      const parsedData = docSnap.data() as any;
      const subjectsWithDefaults = (parsedData.subjects || []).map((s: any) => {
        let allowSharing = s.allowPhysicalRoomSharing;
        if (allowSharing === undefined && s.allowClassroomSharing !== undefined) {
          allowSharing = s.allowClassroomSharing;
        }
        // One-time migration: default to true for existing STUDENT_ONLY / TEACHER_ONLY subjects if previously unset
        if (allowSharing === undefined || allowSharing === null) {
          if (s.type === 'STUDENT_ONLY' || s.type === 'TEACHER_ONLY') {
            allowSharing = true;
          } else {
            allowSharing = false;
          }
        }
        return {
          ...s,
          teachingMode: s.teachingMode || 'single',
          allowPhysicalRoomSharing: Boolean(allowSharing),
          allowClassroomSharing: Boolean(allowSharing),
        };
      });
      
      // If subcollection was empty but main document has scheduleEntries, use main document
      const finalScheduleEntries: ScheduleEntry[] = Array.isArray(loadedScheduleEntries) && loadedScheduleEntries.length > 0 
        ? loadedScheduleEntries 
        : (Array.isArray(parsedData.scheduleEntries) ? parsedData.scheduleEntries : []);

      const finalActivityLogs: ActivityLog[] = Array.isArray(loadedActivityLogs) && loadedActivityLogs.length > 0
        ? loadedActivityLogs
        : (Array.isArray(parsedData.activityLogs) ? parsedData.activityLogs : []);

      const resolvedData: AppData = {
        departments: safeUpsert(parsedData.departments, defaultInitialData.departments),
        resourceTypes: safeUpsert(parsedData.resourceTypes, defaultInitialData.resourceTypes),
        teachers: parsedData.teachers || [],
        subjects: subjectsWithDefaults,
        gradeLevels: parsedData.gradeLevels || [],
        physicalRooms: parsedData.physicalRooms || [],
        scheduleEntries: finalScheduleEntries,
        periodSettings: parsedData.periodSettings || defaultInitialData.periodSettings,
        teacherSubjectAssignments: parsedData.teacherSubjectAssignments || [],
        organizationSettings: parsedData.organizationSettings || defaultInitialData.organizationSettings,
        users: parsedData.users && parsedData.users.length > 0 ? parsedData.users : defaultInitialData.users,
        activityLogs: finalActivityLogs,
        authorizedAdmins: parsedData.authorizedAdmins || [],
        currentUser: null, 
      };
      return resolvedData;
    } else if (loadedScheduleEntries.length > 0) {
      return {
        ...defaultInitialData,
        scheduleEntries: loadedScheduleEntries,
        activityLogs: loadedActivityLogs
      };
    }
  } catch (error: any) {
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

export const saveAppData = async (data: AppData, orgId: string = ORG_ID): Promise<void> => {
  try {
    const docRef = doc(db, 'apps', orgId);
    
    const { scheduleEntries = [], activityLogs = [], currentUser, ...mainDocContent } = data;

    // Save complete dataset in main doc as well for instant single-document persistence
    const mainDocToSave = {
      ...mainDocContent,
      organizationId: orgId,
      scheduleEntries: scheduleEntries,
      activityLogs: (activityLogs || []).slice(0, 50)
    };
    const cleanedMainDoc = cleanUndefined(mainDocToSave);

    // 1. Save main doc (teachers, subjects, assignments, settings, scheduleEntries, etc.)
    try {
      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(docRef);
        if (docSnap.exists()) {
          const serverData = docSnap.data() as AppData;
          
          // Check if the isLocked setting itself has changed
          const oldLocked = !!serverData.organizationSettings?.isLocked;
          const newLocked = !!data.organizationSettings?.isLocked;
          if (oldLocked !== newLocked) {
            if (currentUser?.role !== 'admin') {
              throw new Error("403_FORBIDDEN_ADMIN_ONLY");
            }
          }

          const serverAssignments = serverData.teacherSubjectAssignments || [];
          const newAssignments = data.teacherSubjectAssignments || [];
          const removedAssignments = serverAssignments.filter((oldA: any) => !newAssignments.some((newA: any) => newA.id === oldA.id));
          for (const removed of removedAssignments) {
            const hasDependency = (scheduleEntries || []).some((entry: any) => 
              entry.subjectId === removed.subjectId && 
              entry.teacherIds?.includes(removed.teacherId) &&
              entry.gradeLevelId === removed.gradeLevelId
            );
            if (hasDependency) {
              throw new Error("409_CONFLICT_ASSIGNMENT_IN_USE");
            }
          }
        }
        
        transaction.set(docRef, cleanedMainDoc, { merge: true });
      });
    } catch (txErr: any) {
      if (txErr.message === "403_FORBIDDEN_ADMIN_ONLY" || txErr.message === "409_CONFLICT_ASSIGNMENT_IN_USE") {
        throw txErr;
      }
      // If transaction encountered an issue, fallback to setDoc
      await setDoc(docRef, cleanedMainDoc, { merge: true });
    }

    // 2. Synchronize scheduleEntries subcollection (apps/{orgId}/scheduleEntries/{entryId}) in background
    if (Array.isArray(scheduleEntries)) {
      try {
        const scheduleEntriesColRef = collection(db, 'apps', orgId, 'scheduleEntries');
        const currentScheduleSnap = await getDocs(scheduleEntriesColRef);
        const existingDocIds = new Set(currentScheduleSnap.docs.map(d => d.id));
        const newEntryIds = new Set(scheduleEntries.map(e => e.id));

        // Batch in chunks of 400 (Firestore limit is 500 ops per batch)
        const batches: any[] = [];
        let currentBatch = writeBatch(db);
        let opCount = 0;

        const pushBatch = () => {
          batches.push(currentBatch);
          currentBatch = writeBatch(db);
          opCount = 0;
        };

        // Upsert current entries
        for (const entry of scheduleEntries) {
          if (!entry.id) continue;
          const entryDocRef = doc(db, 'apps', orgId, 'scheduleEntries', entry.id);
          currentBatch.set(entryDocRef, cleanUndefined(entry), { merge: true });
          opCount++;
          if (opCount >= 400) pushBatch();
        }

        // Delete removed entries
        for (const existingId of existingDocIds) {
          if (!newEntryIds.has(existingId)) {
            const entryDocRef = doc(db, 'apps', orgId, 'scheduleEntries', existingId);
            currentBatch.delete(entryDocRef);
            opCount++;
            if (opCount >= 400) pushBatch();
          }
        }

        if (opCount > 0) {
          batches.push(currentBatch);
        }

        for (const b of batches) {
          await b.commit();
        }
      } catch (subErr: any) {
        console.warn("Subcollection scheduleEntries sync bypassed (Main doc safely saved):", subErr?.message || subErr);
      }
    }

    // 3. Save new activityLogs into subcollection (apps/{orgId}/activityLogs/{logId})
    if (Array.isArray(activityLogs) && activityLogs.length > 0) {
      try {
        const latestLogs = activityLogs.slice(0, 10);
        for (const log of latestLogs) {
          if (!log.id) continue;
          const logDocRef = doc(db, 'apps', orgId, 'activityLogs', log.id);
          await setDoc(logDocRef, cleanUndefined(log), { merge: true });
        }
      } catch (logErr: any) {
        console.warn("Subcollection activityLogs sync bypassed (Main doc safely saved):", logErr?.message || logErr);
      }
    }

  } catch (error: any) {
    if (error.message === "403_FORBIDDEN_ADMIN_ONLY") {
      alert("403 Forbidden: เฉพาะแอดมินหลักประจำโรงเรียนเท่านั้นที่มีสิทธิ์ล็อกหรือปลดล็อกตารางเรียน (Authorized School Admin Only)");
    } else if (error.message === "403_FORBIDDEN_LOCKED") {
      alert("ไม่สามารถแก้ไขได้ เนื่องจากตารางเรียนประจำภาคเรียนนี้ถูกล็อกโดยฝ่ายวิชาการแล้ว");
    } else if (error.message === "RACE_CONDITION_CONFLICT") {
      alert("🚨 Conflict Detected: Another user has already updated this schedule block. Your changes will be reverted to match the server.");
    } else if (error.message === "409_CONFLICT_ASSIGNMENT_IN_USE") {
      alert("ไม่สามารถลบลิงค์มอบหมายงานได้ (Action Blocked)\n\nรายวิชานี้ของรายชื่อครูดังกล่าว ถูกจัดวางลงบนตารางเรียน (Timetable Grid) ไปเรียบร้อยแล้ว หากต้องการลบลิงค์นี้ กรุณาไปลบคาบเรียนของวิชานี้ออกจากตารางสอนของห้องดังกล่าวให้หมดก่อน จึงจะกลับมาทำรายการลบลิงค์นี้ได้");
    } else if (error.message?.includes("Missing or insufficient permissions") || error.code === "permission-denied") {
      const isUserSignedIn = !!auth.currentUser;
      if (!isUserSignedIn) {
        alert(
          "❌ ไม่สามารถบันทึกข้อมูลได้: ยังไม่ได้เข้าสู่ระบบ\n\n" +
          "กรุณากดปุ่ม 'เข้าสู่ระบบด้วย Google (@utd.ac.th)' เพื่อรับสิทธิ์การเขียนและบันทึกข้อมูลลงฐานข้อมูล Firebase"
        );
      } else {
        alert(
          "❌ พบข้อผิดพลาดด้านสิทธิ์การใช้งาน Firestore (Permission Denied)\n\n" +
          "กรุณาไปที่ Firebase Console (https://console.firebase.google.com) ของโปรเจกต์คุณ -> เลือก Firestore Database -> แถบ Rules\n" +
          "และตั้งค่ากฏเป็น:\n\n" +
          "rules_version = '2';\n" +
          "service cloud.firestore {\n" +
          "  match /databases/{database}/documents {\n" +
          "    match /{document=**} {\n" +
          "      allow read, write: if true;\n" +
          "    }\n" +
          "  }\n" +
          "}"
        );
      }
      console.error("Firestore Rules error:", error);
      throw error;
    } else {
      console.error(`Error saving data to Firestore API for org ${orgId}:`, error);
      throw error;
    }
  }
};

export const resetSemesterTimetable = async (orgId: string = ORG_ID, currentUser: any): Promise<void> => {
  try {
    if (currentUser?.role !== 'admin') {
      throw new Error("403_FORBIDDEN_ADMIN_ONLY");
    }
    const docRef = doc(db, 'apps', orgId);
    
    // 1. Delete all docs in scheduleEntries subcollection
    const scheduleEntriesColRef = collection(db, 'apps', orgId, 'scheduleEntries');
    const scheduleSnap = await getDocs(scheduleEntriesColRef);
    
    if (!scheduleSnap.empty) {
      const batches: any[] = [];
      let currentBatch = writeBatch(db);
      let opCount = 0;
      for (const d of scheduleSnap.docs) {
        currentBatch.delete(d.ref);
        opCount++;
        if (opCount >= 400) {
          batches.push(currentBatch);
          currentBatch = writeBatch(db);
          opCount = 0;
        }
      }
      if (opCount > 0) batches.push(currentBatch);
      for (const b of batches) {
        await b.commit();
      }
    }

    // 2. Add reset log to activityLogs subcollection
    const resetLogId = crypto.randomUUID();
    const resetLogDocRef = doc(db, 'apps', orgId, 'activityLogs', resetLogId);
    await setDoc(resetLogDocRef, {
      id: resetLogId,
      action: `System reset for the new semester by ${currentUser?.name || currentUser?.email || 'Admin'}`,
      entityType: "system",
      entityId: "system",
      timestamp: new Date().toISOString(),
      userName: currentUser?.name || currentUser?.email || "Admin"
    });

    // 3. Update main doc: clear teacherSubjectAssignments, unlock, remove legacy fields
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(docRef);
      if (!docSnap.exists()) return;
      const data = docSnap.data() as AppData;
      
      const updatedData = {
        ...data,
        scheduleEntries: deleteField(),
        activityLogs: deleteField(),
        teacherSubjectAssignments: [],
        organizationSettings: {
          ...data.organizationSettings,
          isLocked: false
        }
      };
      transaction.set(docRef, updatedData, { merge: true });
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

/**
 * First-login self-registration via Cloud Function.
 * Replaces the previous client-side saveAppData() write in useAppAuth — the new
 * Firestore Rules block non-manager roles (including brand-new guests) from
 * writing apps/{orgId} directly.
 */
export const registerCurrentUser = async (orgId: string = ORG_ID, name?: string): Promise<void> => {
  try {
    const fn = httpsCallable(functions, 'registerCurrentUser');
    await fn({ orgId, name });
  } catch (err: any) {
    console.warn('registerCurrentUser notice:', err?.message || err);
  }
};

/**
 * Entity types an assistant-role user may edit, scoped to their assigned
 * departments. Under the new Firestore Rules assistants cannot write apps/{orgId}
 * (or its subcollections) directly, so these edits are routed through the
 * assistantUpdateEntity Cloud Function, which enforces the department check
 * server-side.
 */
export const ASSISTANT_SYNC_KEYS = ['teachers', 'subjects', 'teacherSubjectAssignments', 'scheduleEntries'] as const;
export type AssistantEntityKey = typeof ASSISTANT_SYNC_KEYS[number];

const callAssistantUpdate = async (
  type: AssistantEntityKey,
  op: 'create' | 'update' | 'delete',
  entity: any,
  orgId: string
): Promise<void> => {
  const fn = httpsCallable(functions, 'assistantUpdateEntity');
  await fn({ type, op, id: entity?.id, payload: entity, orgId });
};

/**
 * Diff the department-scoped entity arrays between the previously-persisted state
 * and the current in-memory state, and route each add / change / removal through
 * the assistantUpdateEntity Cloud Function. Called by the App autosave effect for
 * assistant-role users in place of saveAppData().
 *
 * Errors from individual entity calls (e.g. an edit outside the assistant's
 * departments) are collected and re-thrown so the caller can surface them without
 * losing the other successful writes.
 */
export const persistAssistantChanges = async (
  prev: AppData | null,
  next: AppData | null,
  orgId: string = ORG_ID
): Promise<void> => {
  if (!next) return;
  const errors: string[] = [];

  for (const key of ASSISTANT_SYNC_KEYS) {
    const before: any[] = Array.isArray((prev as any)?.[key]) ? (prev as any)[key] : [];
    const after: any[] = Array.isArray((next as any)?.[key]) ? (next as any)[key] : [];
    const beforeById = new Map(before.filter(e => e && e.id).map(e => [e.id, e]));
    const afterById = new Map(after.filter(e => e && e.id).map(e => [e.id, e]));

    for (const [id, entity] of afterById) {
      const prior = beforeById.get(id);
      try {
        if (!prior) {
          await callAssistantUpdate(key, 'create', entity, orgId);
        } else if (JSON.stringify(prior) !== JSON.stringify(entity)) {
          await callAssistantUpdate(key, 'update', entity, orgId);
        }
      } catch (err: any) {
        errors.push(`${key}/${id}: ${err?.message || err}`);
      }
    }

    for (const [id] of beforeById) {
      if (!afterById.has(id)) {
        try {
          await callAssistantUpdate(key, 'delete', { id }, orgId);
        } catch (err: any) {
          errors.push(`${key}/${id} (delete): ${err?.message || err}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Assistant sync completed with errors:\n${errors.join('\n')}`);
  }
};

export { buildTimetableBackupPayload, triggerJsonDownload } from './utils/backup';
