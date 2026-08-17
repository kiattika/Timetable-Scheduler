import { GradeLevel } from '../types';

export const isSharable = (subject: any) => Boolean(subject?.allowPhysicalRoomSharing === true || subject?.allowPhysicalRoomSharing === 'true' || subject?.allowPhysicalRoomSharing === 1 || subject?.type === 'STUDENT_ONLY' || subject?.subjectType === 'STUDENT_ONLY');

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
