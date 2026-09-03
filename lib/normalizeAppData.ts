/**
 * Single source of truth for load-time entity normalisation.
 *
 * Previously `fetchAppData` (api.ts), `useAppAuth.updateCombinedAppData` and
 * `App.executeRestore` each normalised subjects DIFFERENTLY — one added
 * `allowPhysicalRoomSharing` / `allowClassroomSharing`, another added only
 * `teachingMode`, a third added six more fields. A subject whose diff baseline
 * came from one path and current state from another therefore had a different
 * key SET and was flagged "changed" on every save. This module makes every load
 * path produce identical objects.
 *
 * No imports — safe to unit-test in plain Node.
 */

/** Fill the defaults every subject must have, deterministically and identically
 *  regardless of which load path calls it. */
export const normalizeLoadedSubject = (s: any): any => {
  if (!s || typeof s !== 'object') return s;

  // Resolve room-sharing from either the new or legacy field, with the
  // one-time migration default for special subject types.
  let allowSharing = s.allowPhysicalRoomSharing;
  if (allowSharing === undefined && s.allowClassroomSharing !== undefined) {
    allowSharing = s.allowClassroomSharing;
  }
  if (allowSharing === undefined || allowSharing === null) {
    allowSharing = s.type === 'STUDENT_ONLY' || s.type === 'TEACHER_ONLY';
  }

  return {
    ...s,
    teachingMode: s.teachingMode || 'single',
    allowPhysicalRoomSharing: Boolean(allowSharing),
    allowClassroomSharing: Boolean(allowSharing),
  };
};

export const normalizeLoadedSubjects = (subjects: any): any[] =>
  Array.isArray(subjects) ? subjects.map(normalizeLoadedSubject) : [];
