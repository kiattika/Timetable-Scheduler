import type { Teacher, Subject, GradeLevel, TeacherSubjectAssignment } from '../types';
import { getChildGradeLevelIds } from '../components/scheduleUtils';

export interface HomeroomLinkDrift {
  /** Links that should exist (advisor of the class, subject auto-links to advisors) but do not. */
  missing: { teacherId: string; subjectId: string; gradeLevelId: string }[];
  /** Existing links on auto-link subjects whose teacher is not an advisor of that class (anymore). */
  stale: TeacherSubjectAssignment[];
}

/**
 * Compares Teacher-Subject Links with the homeroom advisors, for subjects that are set to
 * "auto-link to homeroom teachers" (autoLinkToHomeroomTeachers + applicable parent grades).
 * Only those subjects are considered, so links for any other subject are never reported or touched.
 */
export const computeHomeroomLinkDrift = (args: {
  teachers: Teacher[];
  subjects: Subject[];
  gradeLevels: GradeLevel[];
  links: TeacherSubjectAssignment[];
  /** Optional: restrict to some teachers (e.g. an assistant's own departments). */
  includeTeacher?: (t: Teacher) => boolean;
}): HomeroomLinkDrift => {
  const { teachers, subjects, gradeLevels, links, includeTeacher } = args;
  const scopedTeachers = includeTeacher ? teachers.filter(includeTeacher) : teachers;
  const scopedTeacherIds = new Set(scopedTeachers.map(t => t.id));
  const keyOf = (teacherId: string, subjectId: string, gradeLevelId: string) => `${teacherId}|${subjectId}|${gradeLevelId}`;
  const existing = new Set(links.map(l => keyOf(l.teacherId, l.subjectId, l.gradeLevelId)));

  const missing: HomeroomLinkDrift['missing'] = [];
  const stale: TeacherSubjectAssignment[] = [];

  subjects.forEach(subject => {
    if (!subject.autoLinkToHomeroomTeachers) return;
    const parents = subject.applicableParentGradeLevelIds || [];
    if (parents.length === 0) return;

    const valid = new Set<string>();
    parents.forEach(pid => getChildGradeLevelIds(pid, gradeLevels).forEach(c => valid.add(c)));

    const desired = new Set<string>();
    scopedTeachers.forEach(t => {
      (t.homeroomGradeLevelIds || []).forEach(hid => {
        if (!valid.has(hid)) return;
        const key = keyOf(t.id, subject.id, hid);
        desired.add(key);
        if (!existing.has(key)) missing.push({ teacherId: t.id, subjectId: subject.id, gradeLevelId: hid });
      });
    });

    links.forEach(l => {
      if (l.subjectId !== subject.id || !scopedTeacherIds.has(l.teacherId)) return;
      if (!desired.has(keyOf(l.teacherId, l.subjectId, l.gradeLevelId))) stale.push(l);
    });
  });

  return { missing, stale };
};

/** Applies a drift result to a links array (removes stale, adds missing). Pure. */
export const applyHomeroomLinkDrift = (
  links: TeacherSubjectAssignment[],
  drift: HomeroomLinkDrift
): TeacherSubjectAssignment[] => {
  const staleIds = new Set(drift.stale.map(l => l.id));
  const next = links.filter(l => !staleIds.has(l.id));
  drift.missing.forEach(m => {
    if (!next.some(l => l.teacherId === m.teacherId && l.subjectId === m.subjectId && l.gradeLevelId === m.gradeLevelId)) {
      next.push({ id: crypto.randomUUID(), teacherId: m.teacherId, subjectId: m.subjectId, gradeLevelId: m.gradeLevelId });
    }
  });
  return next;
};
