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

/**
 * The schema version this client writes / expects for the `apps/{orgId}` document.
 *
 *   1 — monolithic document: every entity array (teachers, subjects, gradeLevels,
 *       physicalRooms, teacherSubjectAssignments, periodSettings, users, …) lives
 *       inline on the one `apps/{orgId}` doc. `scheduleEntries` / `activityLogs`
 *       are already mirrored to subcollections.
 *
 * The subcollection migration (a later phase) bumps this. Until then every load
 * path stamps `schemaVersion: 1` onto settings that predate the field so the rest
 * of the app can branch on a value that is always present ("migration-on-read").
 */
export const CURRENT_ORG_SCHEMA_VERSION = 1;

/**
 * Migration-on-read for `organizationSettings`. Guarantees `schemaVersion` is a
 * positive integer on every non-null settings object, without a server write.
 * `null` (a brand-new / unloaded org) is passed through untouched — its default
 * comes from `getSampleAppData()`.
 */
export const normalizeLoadedOrganizationSettings = (s: any): any => {
  if (!s || typeof s !== 'object') return s ?? null;
  const v = s.schemaVersion;
  const valid = typeof v === 'number' && Number.isInteger(v) && v > 0;
  return valid ? s : { ...s, schemaVersion: CURRENT_ORG_SCHEMA_VERSION };
};
