import { GradeLevel, PhysicalRoom, ScheduleEntry, DayOfWeek } from '../types';

export const isSharable = (subject: any) => Boolean(
  subject?.allowPhysicalRoomSharing === true || 
  subject?.allowPhysicalRoomSharing === 'true' || 
  subject?.allowPhysicalRoomSharing === 1 || 
  subject?.allowPhysicalRoomSharing === '1' || 
  subject?.allowClassroomSharing === true || 
  subject?.allowClassroomSharing === 'true' || 
  (typeof subject?.name === 'string' && (subject.name.includes('พักกลางวัน') || subject.name.includes('กิจกรรมชุมนุม') || subject.name.includes('โฮมรูม'))) ||
  (typeof subject?.subjectCode === 'string' && (subject.subjectCode.toUpperCase() === 'HR' || subject.subjectCode.toUpperCase() === 'LUNCH'))
);

/** True when the subject is offered in the given semester (empty list / no semester = every semester). */
export const subjectOfferedInSemester = (subject: any, semester?: string): boolean => {
  const sem = (semester || '').trim();
  const list: string[] | undefined = subject?.applicableSemesters;
  return !sem || !list || list.length === 0 || list.includes(sem);
};

/** Short text for a cell that has many teachers (the full list stays in the tooltip). */
export const teachersCellLabel = (names: string[], subject?: any): string => {
  if (names.length > 3 || (subject?.isBroadAssignment && names.length > 1)) {
    return subject?.isBroadAssignment && subject?.autoLinkToHomeroomTeachers
      ? `คณะครูที่ปรึกษา (${names.length} คน)`
      : `คณะครู (${names.length} คน)`;
  }
  return names.join(', ');
};

/**
 * Printed label for level-wide activities run by the homeroom advisors:
 * scouts -> "ผู้กำกับลูกเสือ ม.1", military students (นศท.) -> "ผู้กำกับ นศท. ม.4".
 * Returns null for any other subject so the normal teacher names are printed.
 */
export const levelActivityLabel = (subject: any, gradeName?: string): { leader: string; activity: string } | null => {
  if (!subject || !subject.isBroadAssignment) return null;
  const name = String(subject.name || '');
  const level = (gradeName || '').split('/')[0].trim().replace(/^M\.?\s*/i, 'ม.');
  const suffix = level ? ` ${level}` : '';
  if (name.includes('ลูกเสือ') || name.includes('เนตรนารี')) return { leader: `ผู้กำกับลูกเสือ${suffix}`, activity: name };
  if (name.includes('นศท') || name.includes('นักศึกษาวิชาทหาร')) return { leader: `ผู้กำกับ นศท.${suffix}`, activity: name };
  return null;
};

export const getParentGradeLevelId = (childGradeLevelId: string, allGradeLevels: GradeLevel[]): string | null => {
    const childGrade = allGradeLevels.find(gl => gl.id === childGradeLevelId);
    if (!childGrade || !childGrade.name.includes('/')) return null;
    const parentName = childGrade.name.split('/')[0];
    const parentGrade = allGradeLevels.find(gl => gl.name === parentName);
    return parentGrade ? parentGrade.id : null;
};

export const getChildGradeLevelIds = (parentGradeLevelId: string, allGradeLevels: GradeLevel[]): string[] => {
    const parentGrade = allGradeLevels.find(gl => gl.id === parentGradeLevelId);
    if (!parentGrade) return [];
    // Ensure parentGrade.name is not an empty string or just "/" to prevent issues
    if (!parentGrade.name || parentGrade.name === '/') return [];
    return allGradeLevels
        .filter(gl => gl.name.startsWith(parentGrade.name + '/') && gl.id !== parentGradeLevelId)
        .map(gl => gl.id);
};

export const isParentGrade = (gradeLevelId: string, allGradeLevels: GradeLevel[]): boolean => {
    const grade = allGradeLevels.find(gl => gl.id === gradeLevelId);
    if (!grade) return false;
    // Ensure grade.name is not an empty string or just "/"
    if (!grade.name || grade.name === '/') return false;
    return !grade.name.includes('/') && allGradeLevels.some(other => other.name.startsWith(grade.name + '/') && other.id !== grade.id);
};

export const isChildOf = (childGradeLevelId: string, parentGradeLevelId: string, allGradeLevels: GradeLevel[]): boolean => {
    const parentIdFromName = getParentGradeLevelId(childGradeLevelId, allGradeLevels);
    return parentIdFromName === parentGradeLevelId;
};

/**
 * True when a schedule entry placed on `entryGradeId` already covers the class a teacher is homeroom advisor of:
 * the entry sits on that very class, or on its parent level (e.g. M.1 for a teacher whose homeroom is M.1/2 — how
 * level-wide activities are scheduled). Such an entry is NOT a "homeroom changed" discrepancy.
 */
export const entryCoversHomeroom = (entryGradeId: string, homeroomGradeIds: string[] | undefined, allGradeLevels: GradeLevel[]): boolean =>
    (homeroomGradeIds || []).some(h => h === entryGradeId || isChildOf(h, entryGradeId, allGradeLevels));

// Excludes rooms already booked by a DIFFERENT schedule entry at the same day+period.
// `excludeEntryId` lets an in-progress edit keep showing its own current room as available.
export const getAvailablePhysicalRooms = (
    allRooms: PhysicalRoom[],
    scheduleEntries: ScheduleEntry[],
    day: DayOfWeek,
    period: number,
    excludeEntryId?: string | null
): PhysicalRoom[] => {
    const bookedRoomIds = new Set<string>();
    scheduleEntries.forEach(e => {
        if (e.day === day && e.period === period && e.id !== excludeEntryId && e.physicalRoomId) {
            bookedRoomIds.add(e.physicalRoomId);
        }
    });
    return allRooms.filter(r => !bookedRoomIds.has(r.id));
};

/** True when the given period is the lunch break of the grade level (or of its parent grade level). */
export const isLunchPeriodForGrade = (
    period: { lunchGradeLevelIds?: string[] } | undefined | null,
    gradeLevelId: string | undefined | null,
    allGradeLevels: GradeLevel[]
): boolean => {
    const ids = period?.lunchGradeLevelIds;
    if (!ids || ids.length === 0 || !gradeLevelId) return false;
    if (ids.includes(gradeLevelId)) return true;
    const parentId = getParentGradeLevelId(gradeLevelId, allGradeLevels);
    return !!parentId && ids.includes(parentId);
};
