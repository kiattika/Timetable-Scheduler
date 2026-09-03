import { AppData, Subject, PeriodSetting, User, ScheduleEntry, GradeLevel, Teacher, TeacherSubjectAssignment, PhysicalRoom, OrganizationSettings, FormField, DayOfWeek, ActivityLog } from './types';
import { DEFAULT_PERIOD_SETTINGS, PREDEFINED_SUBJECT_COLORS } from './constants';
import { db, auth, functions } from './lib/firebase';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch, query, orderBy, limit, deleteField, runTransaction } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { computeOrgChanges, diffById, diffAssistantEntities, canonicalKey, failureKey, classifySaveError, describeSaveError, reconcileServerWithLocal, ORG_ARRAY_FIELDS, cleanUndefined as cleanUndefinedShared } from './lib/orgChangesClient';
import { normalizeLoadedSubject, normalizeLoadedSubjects } from './lib/normalizeAppData';

export { computeOrgChanges, diffById, diffAssistantEntities, canonicalKey, failureKey, classifySaveError, describeSaveError, reconcileServerWithLocal, ORG_ARRAY_FIELDS, normalizeLoadedSubject, normalizeLoadedSubjects };

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
      const subjectsWithDefaults = normalizeLoadedSubjects(parsedData.subjects);
      
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

const cleanUndefined = cleanUndefinedShared;

export type PersistResult = {
  permanentFailures: string[]; // user-facing messages, newly failed this cycle
  retryableFailures: number;
  persistedBaseline: AppData;  // the state now known to be persisted
  progressed: boolean;         // a write actually landed
};

const surfaceSaveError = (error: any) => {
  const msg: string = error?.message || '';
  const code: string = error?.code || '';
  if (msg.includes('409_CONFLICT_ASSIGNMENT_IN_USE') || code === 'functions/failed-precondition') {
    alert("ไม่สามารถลบลิงค์มอบหมายงานได้ (Action Blocked)\n\nรายวิชานี้ของรายชื่อครูดังกล่าว ถูกจัดวางลงบนตารางเรียน (Timetable Grid) ไปเรียบร้อยแล้ว หากต้องการลบลิงค์นี้ กรุณาไปลบคาบเรียนของวิชานี้ออกจากตารางสอนของห้องดังกล่าวให้หมดก่อน จึงจะกลับมาทำรายการลบลิงค์นี้ได้");
  } else if (code === 'functions/already-exists' || msg.includes('subjectCode') || msg.includes('รหัสวิชา')) {
    alert(`ไม่สามารถบันทึกได้: ${msg || 'รหัสวิชาซ้ำกับที่มีอยู่แล้ว'}`);
  } else if (code === 'functions/aborted' || msg.includes('concurrent edits') || msg.includes('พร้อมกัน')) {
    alert("⚠️ มีผู้ใช้อื่นกำลังแก้ไขข้อมูลพร้อมกัน\n\nระบบไม่ได้บันทึกการเปลี่ยนแปลงล่าสุดของคุณ กรุณาลองแก้ไขและบันทึกใหม่อีกครั้ง");
  } else if (code === 'functions/resource-exhausted' || msg.includes('daily read limit')) {
    alert("ฐานข้อมูลใช้โควตาการอ่านประจำวันหมดแล้ว กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแลระบบ");
  } else if (msg.includes('lock or unlock') || msg.includes('ล็อก/ปลดล็อก')) {
    alert("403 Forbidden: เฉพาะแอดมินเท่านั้นที่มีสิทธิ์ล็อกหรือปลดล็อกตารางเรียน");
  } else if (code === 'functions/permission-denied' || msg.includes('permission')) {
    const signedIn = !!auth.currentUser;
    alert(signedIn
      ? "❌ คุณไม่มีสิทธิ์บันทึกข้อมูลส่วนนี้ (Permission Denied)"
      : "❌ ยังไม่ได้เข้าสู่ระบบ กรุณาเข้าสู่ระบบด้วย Google (@utd.ac.th) ก่อนบันทึกข้อมูล");
  } else {
    console.error("commitOrgChanges error:", error);
  }
};

/**
 * Persist admin/manager edits to apps/{orgId}. Sends only this client's own
 * change-set (diffed against `baseline`) to the commitOrgChanges Cloud Function,
 * which merges it onto a fresh server read with optimistic concurrency — no more
 * blind full-document overwrite / lost updates.
 *
 * @param baseline last-synced AppData snapshot (from App's lastSavedDataStr). When
 *   omitted, a safe upsert-only sync runs (no deletes).
 * @param opts.replace  admin restore-from-backup: replace all managed content.
 */
export const saveAppData = async (
  data: AppData,
  orgId: string = ORG_ID,
  baseline: AppData | null = null,
  opts: { replace?: boolean } = {},
): Promise<void> => {
  const commitFn = httpsCallable(functions, 'commitOrgChanges');

  try {
    if (opts.replace) {
      const { currentUser, ...rest } = data;
      await commitFn({ orgId, replace: cleanUndefined({ ...rest, organizationId: orgId }) });
      return;
    }

    const { changes, newActivityLogs, hasChanges } = computeOrgChanges(baseline, data);
    if (!hasChanges) return;
    await commitFn({ orgId, changes: cleanUndefined(changes), newActivityLogs });
  } catch (error: any) {
    surfaceSaveError(error);
    throw error;
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

const labelOf = (key: string, entity: any): string =>
  entity?.name || entity?.subjectCode || entity?.teacherCode || entity?.code || `${key}/${entity?.id ?? '?'}`;

const applyOpToBaseline = (baseline: AppData, key: string, op: 'create' | 'update' | 'delete', entity: any): void => {
  const arr: any[] = Array.isArray((baseline as any)[key]) ? [...(baseline as any)[key]] : [];
  const i = arr.findIndex(e => e && e.id === entity?.id);
  if (op === 'delete') {
    if (i >= 0) arr.splice(i, 1);
  } else if (i >= 0) {
    arr[i] = entity;
  } else {
    arr.push(entity);
  }
  (baseline as any)[key] = arr;
};

/**
 * Diff the department-scoped entity arrays between the last-persisted baseline
 * and the current in-memory state, and route each add / change / removal through
 * the assistantUpdateEntity Cloud Function.
 *
 * - `knownFailed` suppresses an op that already failed permanently, until the
 *   user changes that entity again (fixes the "error runs forever" retry storm).
 * - Returns which state is now persisted so the caller advances its baseline
 *   past ONLY the successful ops, never past a doomed one.
 */
export const persistAssistantChanges = async (
  prev: AppData | null,
  next: AppData | null,
  orgId: string = ORG_ID,
  knownFailed?: Map<string, string>,
): Promise<PersistResult> => {
  // Start from the last-known-persisted state (never assume `next` is persisted).
  const persistedBaseline: AppData = prev ? JSON.parse(JSON.stringify(prev)) : ({} as AppData);
  const result: PersistResult = { permanentFailures: [], retryableFailures: 0, persistedBaseline, progressed: false };
  if (!next) return result;

  for (const key of ASSISTANT_SYNC_KEYS) {
    const before: any[] = Array.isArray((prev as any)?.[key]) ? (prev as any)[key] : [];
    const after: any[] = Array.isArray((next as any)?.[key]) ? (next as any)[key] : [];

    const { ops, skippedDeletes, suppressed } = diffAssistantEntities(before, after, knownFailed, key);
    if (skippedDeletes.length > 0) {
      console.warn(
        `[persistAssistantChanges] SKIPPING ${skippedDeletes.length} '${key}' delete(s) — ` +
        `looks like a transient state, not an intentional delete (before=${before.length}, after=${after.length}).`
      );
    }
    if (suppressed > 0) {
      console.warn(`[persistAssistantChanges] ${suppressed} '${key}' op(s) suppressed — already failed permanently, unchanged since.`);
    }

    for (const { op, id, entity } of ops) {
      const fk = `${key}:${id}`;
      try {
        await callAssistantUpdate(key, op, entity, orgId);
        knownFailed?.delete(fk);
        applyOpToBaseline(persistedBaseline, key, op, entity);
        result.progressed = true;
      } catch (err: any) {
        if (classifySaveError(err) === 'permanent') {
          if (knownFailed) knownFailed.set(fk, failureKey(op, entity));
          result.permanentFailures.push(describeSaveError(labelOf(key, entity), err));
        } else {
          result.retryableFailures++;
        }
      }
    }
  }

  return result;
};

/**
 * Admin/manager autosave. Sends this client's own change-set to commitOrgChanges.
 * The whole changeset is atomic server-side, so on a PERMANENT failure the exact
 * changeset hash is blocked (no auto-retry storm) until the user changes something;
 * on success / retryable failure the baseline advances / stays put accordingly.
 */
export const persistOrgChanges = async (
  prev: AppData | null,
  next: AppData,
  orgId: string = ORG_ID,
  knownFailed?: Map<string, string>,
): Promise<PersistResult> => {
  const persistedBaseline: AppData = prev ? JSON.parse(JSON.stringify(prev)) : JSON.parse(JSON.stringify(next));
  const result: PersistResult = { permanentFailures: [], retryableFailures: 0, persistedBaseline, progressed: false };

  const { changes, newActivityLogs, hasChanges } = computeOrgChanges(prev, next);
  if (!hasChanges) {
    result.persistedBaseline = JSON.parse(JSON.stringify(next));
    return result;
  }

  const hash = canonicalKey(changes);
  const FK = '__org__';
  if (knownFailed?.get(FK) === hash) {
    console.warn('[persistOrgChanges] changeset suppressed — identical to one that already failed permanently.');
    return result; // baseline stays at prev; nothing sent
  }

  try {
    const commitFn = httpsCallable(functions, 'commitOrgChanges');
    const res: any = await commitFn({ orgId, changes: cleanUndefined(changes), newActivityLogs });
    const rejected: Array<{ field: string; id: string; reason: string }> = Array.isArray(res?.data?.rejected) ? res.data.rejected : [];

    result.progressed = true;
    if (rejected.length === 0) {
      knownFailed?.delete(FK);
      result.persistedBaseline = JSON.parse(JSON.stringify(next));
    } else {
      // The valid part of the changeset was applied; only these entities were
      // skipped server-side. Block the identical changeset from auto-retrying,
      // surface the reasons, and keep the rejected entities "dirty" locally.
      if (knownFailed) knownFailed.set(FK, hash);
      const pb: any = JSON.parse(JSON.stringify(next));
      const prevBy = (f: string) => {
        const m = new Map<string, any>();
        for (const e of (Array.isArray((prev as any)?.[f]) ? (prev as any)[f] : [])) if (e && e.id) m.set(e.id, e);
        return m;
      };
      for (const r of rejected) {
        const arr: any[] = Array.isArray(pb[r.field]) ? pb[r.field] : [];
        const original = prevBy(r.field).get(r.id);
        const i = arr.findIndex((e) => e && e.id === r.id);
        const label = arr.find((e) => e && e.id === r.id)?.name
          || arr.find((e) => e && e.id === r.id)?.subjectCode || r.id;
        if (original) { if (i >= 0) arr[i] = original; else arr.push(original); }
        else if (i >= 0) arr.splice(i, 1);
        pb[r.field] = arr;
        result.permanentFailures.push(describeSaveError(label, { message: r.reason }));
      }
      result.persistedBaseline = pb;
    }
  } catch (err: any) {
    if (classifySaveError(err) === 'permanent') {
      if (knownFailed) knownFailed.set(FK, hash);
      const changedFields = Object.keys(changes).filter(f => f !== 'organizationSettings');
      result.permanentFailures.push(describeSaveError(changedFields.join(', ') || 'การเปลี่ยนแปลง', err));
    } else {
      result.retryableFailures++;
    }
  }
  return result;
};

export { buildTimetableBackupPayload, triggerJsonDownload } from './utils/backup';
