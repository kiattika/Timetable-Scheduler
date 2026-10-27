/**
 * Bulk-delete helper for Teacher-Subject links.
 * A link can't be deleted while its subject is still placed on the timetable for that
 * teacher + class (same rule as the single-row delete and the server's
 * 409_CONFLICT_ASSIGNMENT_IN_USE). Those links are skipped and reported, the rest are deleted.
 */
import type { TeacherSubjectAssignment } from '../types';

export interface BulkDeletePlan {
  deletableIds: string[];
  blocked: TeacherSubjectAssignment[];
}

export const planBulkDelete = (
  selectedIds: Iterable<string>,
  assignments: TeacherSubjectAssignment[],
  scheduleEntries: Array<{ subjectId?: string; gradeLevelId?: string; teacherIds?: string[] }> | undefined,
): BulkDeletePlan => {
  const selected = new Set(selectedIds);
  const entries = Array.isArray(scheduleEntries) ? scheduleEntries : [];
  const deletableIds: string[] = [];
  const blocked: TeacherSubjectAssignment[] = [];
  for (const a of assignments) {
    if (!selected.has(a.id)) continue;
    const inUse = entries.some(
      (e) => e.subjectId === a.subjectId && e.gradeLevelId === a.gradeLevelId && e.teacherIds?.includes(a.teacherId),
    );
    if (inUse) blocked.push(a);
    else deletableIds.push(a.id);
  }
  return { deletableIds, blocked };
};
