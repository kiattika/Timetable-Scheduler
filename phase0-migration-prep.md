# Phase 0 — Preparation Before Subcollection Migration (Data-Layer Safety Net)

## Context
This is Phase 0 of the migration plan from the architecture review document reviewed
earlier: moving `teachers`, `subjects`, `gradeLevels`, `physicalRooms`,
`teacherSubjectAssignments`, `periodSettings`, `organizationSettings`, `users` out of
the monolithic `apps/{orgId}` document into proper subcollections (matching how
`scheduleEntries`/`activityLogs` already were migrated).

**This phase does NOT touch the migration itself.** Its only goal is to make the
migration safe to attempt later: a real backup, and a regression-test safety net for
current behavior, so that if anything breaks during the actual migration (Phase 1+),
it's caught immediately rather than discovered by a teacher mid-semester.

## Task 1 — Verify the existing backup path actually works end-to-end
The app already has a "Backup Data (JSON)" feature (fixed for correctness/uniqueness
earlier this session — see `utils/backup.ts`, `buildTimetableBackupPayload`). Before
relying on it as the safety net for a risky migration:
1. Confirm it exports every field currently in `apps/{orgId}` that this migration will
   touch (teachers, subjects, gradeLevels, physicalRooms, teacherSubjectAssignments,
   periodSettings, organizationSettings, users, scheduleEntries, activityLogs) — audit
   against the actual current `AppData` type in `types.ts`, don't assume the backup
   payload builder is still in sync with the type if either has changed recently.
2. If anything is missing from the backup payload, fix it now — this is the one thing
   that must be 100% complete before we touch anything else.
3. Document (in the runbook) the exact manual step Kiattisak should take right before
   starting the real migration later: run a fresh backup via the UI, download it, and
   keep it somewhere outside the app (not just relying on it being present in
   Firestore).

## Task 2 — Add `schemaVersion` to `organizationSettings`
Per the migration plan: add a `schemaVersion` field (e.g. starting at `1` for the
current monolithic-document shape) so that once the real migration begins, the client
can tell whether it's reading old-shape or new-shape data during the dual-write
transition period. Just add the field and a sensible default/migration-on-read for
existing data now — don't build any dual-write logic yet, that's a later phase.

## Task 3 — Integration test safety net (the main deliverable of this phase)
The codebase currently has 84 tests, but they're focused on the diff/merge logic
(`orgWrites`) and Firestore rules — not on full entity lifecycles. Before migration,
add Firestore-emulator-based integration tests (extending the existing
`test:rules:emulate` suite, following the same patterns already established in
`test/orgWrites/`) covering, at minimum:

1. **Teacher lifecycle**: create a teacher → verify it appears correctly in a fresh
   read of `apps/{orgId}` → update a field → verify only that field changed → delete →
   verify it's gone and nothing else was affected.
2. **Subject lifecycle**: same shape as above, including the `subjectCode` uniqueness
   check (already implemented — write a test asserting it, if one doesn't already
   exist under this specific angle).
3. **Teacher–Subject assignment lifecycle**: create an assignment linking a teacher and
   subject → verify both sides are queryable → delete the teacher → assert the
   assignment doesn't silently leave a dangling/orphaned reference (confirm current
   behavior either way — this is about establishing a documented baseline, not
   necessarily fixing referential integrity if it's currently missing; if you find it's
   missing, note it clearly rather than silently fixing or ignoring it).
4. **Schedule entry lifecycle**: create a schedule entry (teacher + subject + room +
   time slot) → verify it's queryable via the subcollection → update → delete.
5. **Cross-entity read consistency**: after doing several of the above operations in
   sequence within one test, do a full fresh read of the org's data and assert the
   overall shape/counts are exactly what's expected — this is the test most likely to
   catch a subtle migration bug later (an entity silently vanishing or duplicating).
6. **The already-known gap**: per the architecture review, there is currently NO
   server-side conflict detection for double-booked teachers/rooms/classes when
   creating `scheduleEntries` — write a test that documents this honestly (e.g.
   `it.todo(...)` or a test that asserts the CURRENT permissive behavior with a comment
   explaining it's a known gap, not a passing guarantee of correctness) rather than
   silently building conflict detection now — that's explicitly a later, separate
   priority per the review document, not part of Phase 0.

## Constraints
- Do not start the actual dual-write migration (Phase 1 of the migration plan) — that's
  the next session's work, not this one.
- Do not modify `firestore.rules` or the Phase 1 RBAC work.
- Do not attempt to fix the missing server-side conflict detection gap in this phase —
  just document it via a test, per Task 3.6.
- All new tests must run via the existing `npm run test:rules:emulate` command
  alongside the current 84 — report the new total.

## Report back
- Confirm the backup payload audit result (Task 1) — was anything missing, and if so,
  what did you add?
- Confirm `schemaVersion` was added and where the default/migration-on-read logic lives.
- List the new test count and a one-line description of each new test file/suite.
- Explicitly flag the conflict-detection gap finding from Task 3.6 in your summary, so
  it's fresh context when we plan the actual migration next.
