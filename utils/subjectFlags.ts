/**
 * Which of the "special" subject checkboxes make sense for which subject type.
 *
 *  - TEACHER_ONLY (PLC, meetings): no class and no room, so room sharing, Broad, Homeroom and Auto-link do not apply.
 *  - STUDENT_ONLY: the teacher is fixed to "No Teacher Assigned", so Homeroom (advisor) and Auto-link do not apply.
 *  - Auto-link (homeroom teachers) needs the subject to be Homeroom or Broad.
 */
export type SubjectFlagField =
  | 'allowPhysicalRoomSharing' | 'allowClassroomSharing' | 'isBroadAssignment'
  | 'isHomeroomAdvisorySubject' | 'autoLinkToHomeroomTeachers';

const LOCKED_BY_TYPE: Record<string, SubjectFlagField[]> = {
  TEACHER_ONLY: ['allowPhysicalRoomSharing', 'allowClassroomSharing', 'isBroadAssignment', 'isHomeroomAdvisorySubject', 'autoLinkToHomeroomTeachers'],
  STUDENT_ONLY: ['isHomeroomAdvisorySubject', 'autoLinkToHomeroomTeachers'],
};

/** True when `field` cannot be used for a subject of this type (and current Homeroom/Broad choices). */
export const isSubjectFlagLocked = (item: any, field: SubjectFlagField): boolean => {
  if ((LOCKED_BY_TYPE[item?.type] || []).includes(field)) return true;
  if (field === 'autoLinkToHomeroomTeachers') return !item?.isHomeroomAdvisorySubject && !item?.isBroadAssignment;
  return false;
};

/** Short reason shown next to a locked checkbox. */
export const subjectFlagLockReason = (item: any, field: SubjectFlagField): string | null => {
  if (!isSubjectFlagLocked(item, field)) return null;
  if ((LOCKED_BY_TYPE[item?.type] || []).includes(field)) {
    return item.type === 'TEACHER_ONLY' ? 'วิชาเฉพาะครูไม่มีห้อง/ระดับชั้น จึงใช้ตัวเลือกนี้ไม่ได้' : 'วิชาเฉพาะนักเรียนไม่มีครู จึงใช้ตัวเลือกนี้ไม่ได้';
  }
  return 'ใช้ได้เมื่อติ๊ก Broad หรือ Homeroom อย่างใดอย่างหนึ่ง';
};

/** Clears every flag the subject type does not allow, so conflicting combinations are never saved. */
export const normalizeSubjectFlags = <T extends Record<string, any>>(item: T): T => {
  const out: Record<string, any> = { ...item };
  (['allowPhysicalRoomSharing', 'allowClassroomSharing', 'isBroadAssignment', 'isHomeroomAdvisorySubject'] as SubjectFlagField[]).forEach(f => {
    if (isSubjectFlagLocked(out, f) && out[f]) out[f] = false;
  });
  if (isSubjectFlagLocked(out, 'autoLinkToHomeroomTeachers') && out.autoLinkToHomeroomTeachers) out.autoLinkToHomeroomTeachers = false;
  return out as T;
};

export type SubjectTypeValue = 'STANDARD' | 'TEACHER_ONLY' | 'STUDENT_ONLY';

export const SUBJECT_TYPE_LABELS_TH: Record<SubjectTypeValue, string> = {
  STANDARD: 'ปกติ',
  TEACHER_ONLY: 'เฉพาะครู',
  STUDENT_ONLY: 'เฉพาะนักเรียน',
};

// Accepts the enum value, Thai labels used in the exports/UI, or loose English wording. Unknown/blank -> undefined.
export const parseSubjectType = (raw: unknown): SubjectTypeValue | undefined => {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!v) return undefined;
  if (v === 'standard' || v === 'ปกติ' || v === 'วิชาปกติ' || v === 'ทั่วไป') return 'STANDARD';
  if (v.includes('teacher') || v.includes('เฉพาะครู') || v.includes('วิชาเฉพาะครู')) return 'TEACHER_ONLY';
  if (v.includes('student') || v.includes('เฉพาะนักเรียน') || v.includes('วิชาเฉพาะนักเรียน')) return 'STUDENT_ONLY';
  return undefined;
};
