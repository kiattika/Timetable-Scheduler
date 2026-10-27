/**
 * Department resolution for assistant-scoped writes (pure, no Firebase imports so
 * it can be unit-tested). Used by assistantUpdateEntity's `authorize`.
 */

export type DepartmentEntityType = 'teachers' | 'subjects' | 'teacherSubjectAssignments' | 'scheduleEntries';

/**
 * Resolve the department name(s) an entity belongs to, from the current app doc.
 * Returns [] when the department cannot be determined (caller must treat that as
 * "deny" for assistant-scoped writes).
 *
 * scheduleEntries: a timetable slot is judged by WHO TEACHES IT. If every teacher
 * of the slot is in the assistant's departments the slot is theirs to arrange,
 * even when the subject itself is registered under another department (e.g. the
 * shared HomeRoom/HR subject). The subject's department is only a fallback for
 * slots whose teachers have no resolvable department (or that have no teachers).
 * A slot with at least one teacher from another department still resolves to that
 * department, so an assistant cannot arrange it (a manager/admin must).
 */
export function resolveEntityDepartments(type: DepartmentEntityType, entity: any, appDoc: Record<string, any>): string[] {
  const teachers: any[] = Array.isArray(appDoc.teachers) ? appDoc.teachers : [];
  const subjects: any[] = Array.isArray(appDoc.subjects) ? appDoc.subjects : [];
  const assignments: any[] = Array.isArray(appDoc.teacherSubjectAssignments) ? appDoc.teacherSubjectAssignments : [];
  const deptOfTeacher = (teacherId: string): string[] => {
    const t = teachers.find((x) => x.id === teacherId);
    return t?.department ? [String(t.department)] : [];
  };

  switch (type) {
    case 'teachers':
      return entity?.department ? [String(entity.department)] : [];
    case 'subjects': {
      if (entity?.department) return [String(entity.department)];
      const depts = new Set<string>();
      for (const a of assignments.filter((a) => a.subjectId === entity?.id)) {
        deptOfTeacher(a.teacherId).forEach((d) => depts.add(d));
      }
      return [...depts];
    }
    case 'teacherSubjectAssignments':
      return entity?.teacherId ? deptOfTeacher(entity.teacherId) : [];
    case 'scheduleEntries': {
      const teacherDepts = new Set<string>();
      for (const tid of Array.isArray(entity?.teacherIds) ? entity.teacherIds : []) {
        deptOfTeacher(tid).forEach((d) => teacherDepts.add(d));
      }
      if (teacherDepts.size > 0) return [...teacherDepts];
      const subj = subjects.find((s) => s.id === entity?.subjectId);
      return subj?.department ? [String(subj.department)] : [];
    }
    default:
      return [];
  }
}
