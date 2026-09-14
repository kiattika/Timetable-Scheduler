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
