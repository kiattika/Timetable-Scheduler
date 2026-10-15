import type { Teacher, Subject, GradeLevel, ScheduleEntry, TeacherSubjectAssignment } from '../types';
import { parseSubjectCode, levelFromGradeName, UNKNOWN_GROUP, type SubjectLevel } from './subjectCode';

export interface LoadMetrics {
  lowerBasic: number;   // ม.ต้น พื้นฐาน
  lowerExtra: number;   // ม.ต้น เพิ่มเติม
  upperBasic: number;   // ม.ปลาย พื้นฐาน
  upperExtra: number;   // ม.ปลาย เพิ่มเติม
  activity: number;     // กิจกรรมพัฒนาผู้เรียน / โฮมรูม / ชุมนุม ฯลฯ
  other: number;        // ประถม หรือไม่ทราบจากรหัสวิชา
  total: number;
}

export const emptyMetrics = (): LoadMetrics => ({ lowerBasic: 0, lowerExtra: 0, upperBasic: 0, upperExtra: 0, activity: 0, other: 0, total: 0 });

export const lowerTotal = (m: LoadMetrics) => m.lowerBasic + m.lowerExtra;
export const upperTotal = (m: LoadMetrics) => m.upperBasic + m.upperExtra;

export const addMetrics = (a: LoadMetrics, b: LoadMetrics): LoadMetrics => ({
  lowerBasic: a.lowerBasic + b.lowerBasic, lowerExtra: a.lowerExtra + b.lowerExtra,
  upperBasic: a.upperBasic + b.upperBasic, upperExtra: a.upperExtra + b.upperExtra,
  activity: a.activity + b.activity, other: a.other + b.other, total: a.total + b.total,
});

export type LoadSource = 'schedule' | 'links';

/** Classify `periods` periods of `subject` taught to `gradeName` into the right bucket. */
const classify = (m: LoadMetrics, subject: Subject | undefined, gradeName: string | undefined, periods: number) => {
  m.total += periods;
  if (!subject) { m.other += periods; return; }
  const parsed = parseSubjectCode(subject.subjectCode);
  const isActivity =
    parsed?.kind === 'activity' || subject.isHomeroomAdvisorySubject || subject.isBroadAssignment ||
    subject.type === 'TEACHER_ONLY' || subject.type === 'STUDENT_ONLY';
  if (isActivity) { m.activity += periods; return; }
  let level: SubjectLevel = parsed?.level ?? 'unknown';
  if (level === 'unknown') level = levelFromGradeName(gradeName);
  const kind = parsed?.kind ?? 'unknown';
  if (level === 'lower' && kind === 'basic') m.lowerBasic += periods;
  else if (level === 'lower' && kind === 'extra') m.lowerExtra += periods;
  else if (level === 'upper' && kind === 'basic') m.upperBasic += periods;
  else if (level === 'upper' && kind === 'extra') m.upperExtra += periods;
  else m.other += periods;
};

export interface WorkloadResult {
  perTeacher: { teacher: Teacher; metrics: LoadMetrics }[];
  byDepartment: { department: string; teacherCount: number; metrics: LoadMetrics }[];
  overall: { teacherCount: number; metrics: LoadMetrics };
  /** by subject group letter (from the subject code) */
  byGroup: { group: string; subjectCount: number; metrics: LoadMetrics }[];
}

export const computeWorkload = (args: {
  teachers: Teacher[];
  subjects: Subject[];
  gradeLevels: GradeLevel[];
  scheduleEntries: ScheduleEntry[];
  assignments: TeacherSubjectAssignment[];
  source: LoadSource;
}): WorkloadResult => {
  const { teachers, subjects, gradeLevels, scheduleEntries, assignments, source } = args;
  const subjectById = new Map(subjects.map(s => [s.id, s]));
  const gradeName = (id: string) => gradeLevels.find(g => g.id === id)?.name;

  const teacherMetrics = new Map<string, LoadMetrics>();
  const groupMetrics = new Map<string, { metrics: LoadMetrics; subjects: Set<string> }>();
  const touch = (teacherId: string, subjectId: string, gradeId: string, periods: number) => {
    if (periods <= 0) return;
    const subject = subjectById.get(subjectId);
    const gName = gradeId === 'Non-Student' ? undefined : gradeName(gradeId);
    if (!teacherMetrics.has(teacherId)) teacherMetrics.set(teacherId, emptyMetrics());
    classify(teacherMetrics.get(teacherId)!, subject, gName, periods);

    const g = parseSubjectCode(subject?.subjectCode)?.group ?? UNKNOWN_GROUP;
    if (!groupMetrics.has(g)) groupMetrics.set(g, { metrics: emptyMetrics(), subjects: new Set() });
    const gm = groupMetrics.get(g)!;
    classify(gm.metrics, subject, gName, periods);
    gm.subjects.add(subjectId);
  };

  if (source === 'schedule') {
    scheduleEntries.forEach(e => (e.teacherIds || []).forEach(tid => touch(tid, e.subjectId, e.gradeLevelId, 1)));
  } else {
    assignments.forEach(a => touch(a.teacherId, a.subjectId, a.gradeLevelId, subjectById.get(a.subjectId)?.periodsPerWeek ?? 0));
  }

  const perTeacher = teachers
    .map(t => ({ teacher: t, metrics: teacherMetrics.get(t.id) || emptyMetrics() }))
    .sort((a, b) => {
      const d = (a.teacher.department || '').localeCompare(b.teacher.department || '', 'th');
      if (d !== 0) return d;
      const c = (a.teacher.teacherCode || '').localeCompare(b.teacher.teacherCode || '', undefined, { numeric: true, sensitivity: 'base' });
      if (c !== 0) return c;
      return (a.teacher.name || '').localeCompare(b.teacher.name || '', 'th');
    });

  const deptMap = new Map<string, { teacherCount: number; metrics: LoadMetrics }>();
  perTeacher.forEach(({ teacher, metrics }) => {
    const d = teacher.department || '(ไม่ระบุกลุ่มสาระฯ)';
    if (!deptMap.has(d)) deptMap.set(d, { teacherCount: 0, metrics: emptyMetrics() });
    const e = deptMap.get(d)!;
    e.teacherCount += 1;
    e.metrics = addMetrics(e.metrics, metrics);
  });
  const byDepartment = [...deptMap.entries()]
    .map(([department, v]) => ({ department, ...v }))
    .sort((a, b) => a.department.localeCompare(b.department, 'th'));

  const overall = byDepartment.reduce(
    (acc, d) => ({ teacherCount: acc.teacherCount + d.teacherCount, metrics: addMetrics(acc.metrics, d.metrics) }),
    { teacherCount: 0, metrics: emptyMetrics() }
  );

  const byGroup = [...groupMetrics.entries()]
    .map(([group, v]) => ({ group, subjectCount: v.subjects.size, metrics: v.metrics }))
    .sort((a, b) => (a.group === UNKNOWN_GROUP ? 1 : b.group === UNKNOWN_GROUP ? -1 : a.group.localeCompare(b.group, 'th')));

  return { perTeacher, byDepartment, overall, byGroup };
};
