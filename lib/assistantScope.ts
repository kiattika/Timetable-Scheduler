/**
 * Client-side mirror of the server's scope rule for assistants arranging timetable
 * slots (resolveEntityDepartments('scheduleEntries') in functions/src/departmentAuth.ts
 * + `covers` in assistantUpdateEntity). MUST stay in sync with that file; the parity
 * test in test/orgWrites/assistantScope.test.ts fails if the two drift apart.
 *
 * The server is the security boundary. This exists so an assistant is stopped BEFORE
 * the slot is written locally, instead of seeing a "ghost" card that the server then
 * rejects.
 *
 * Rule: a slot is judged by who teaches it. Every teacher with a known department
 * must be in the assistant's departments (one teacher or several). The subject's
 * department is only a fallback when no teacher department can be resolved.
 */

export interface DeptRef {
  id: string;
  department?: string;
}

export const ASSISTANT_CROSS_DEPT_MESSAGE =
  'วิชานี้มีครูผู้สอนอยู่นอกกลุ่มสาระฯ ของคุณ กรุณาแจ้งผู้จัดการหรือผู้ดูแลระบบให้เป็นผู้จัดให้';

export const slotDepartments = (
  entry: { subjectId?: string; teacherIds?: string[] },
  teachers: DeptRef[],
  subjects: DeptRef[],
): string[] => {
  const teacherDepts = new Set<string>();
  for (const tid of Array.isArray(entry.teacherIds) ? entry.teacherIds : []) {
    const dept = teachers.find((t) => t.id === tid)?.department;
    if (dept) teacherDepts.add(String(dept));
  }
  if (teacherDepts.size > 0) return [...teacherDepts];
  const subjectDept = subjects.find((s) => s.id === entry.subjectId)?.department;
  return subjectDept ? [String(subjectDept)] : [];
};

export const assistantMayArrange = (
  entry: { subjectId?: string; teacherIds?: string[] },
  teachers: DeptRef[],
  subjects: DeptRef[],
  assignedDepartments: string[],
): boolean => {
  const depts = slotDepartments(entry, teachers, subjects);
  return depts.length > 0 && depts.every((d) => assignedDepartments.includes(d));
};
