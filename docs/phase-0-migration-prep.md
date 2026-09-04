# Phase 0 — Migration Prep (Data-Layer Safety Net)

Prerequisite work for the `apps/{orgId}` monolithic-document → subcollection
migration. **Phase 0 does not migrate anything.** It makes the migration safe to
attempt: a verified backup, a `schemaVersion` marker, and an integration-test
safety net over current entity behaviour.

Source task: `phase0-migration-prep.md` (repo root).

---

## 1. Backup payload audit (Task 1) — RESULT

Audited `BackupEnvelope` (`utils/backup.ts`, `buildTimetableBackupPayload`)
against the current `AppData` type (`types.ts`), for every field the migration
will move: `teachers`, `subjects`, `gradeLevels`, `physicalRooms`,
`teacherSubjectAssignments`, `periodSettings`, `organizationSettings`, `users`,
`scheduleEntries`, `activityLogs`.

| Field | Status |
| --- | --- |
| teachers, gradeLevels, physicalRooms, teacherSubjectAssignments, periodSettings, scheduleEntries | ✅ captured verbatim (pass-through) |
| subjects | ✅ captured; load-time defaults (`teachingMode`, room-sharing flags, …) are added on top — no original field is dropped |
| departments, resourceTypes | ✅ captured (not in the migration's move-list, but backed up anyway) |
| organizationSettings | ✅ captured (top-level **and** under `data`), now including `schemaVersion` |
| users | ✅ captured — all fields that are actually persisted server-side (`id`, `name`, `email`, `role`, `organizationId`, `assignedDepartments`) |
| authorizedAdmins | ✅ captured |
| activityLogs | ⚠️ see fix below |
| currentUser | ✅ correctly **excluded** (live-session only, never persisted) |

### What was missing / wrong, and the fixes applied

1. **`activityLogs` were pruned to the last 7 days** in the backup payload
   (`pruneActivityLogs(logs, 7)`). For a "complete pre-migration snapshot" that
   silently dropped older history. **Fixed:** the backup now keeps the full
   in-memory activity-log snapshot.
   *Residual limitation (documented, not a Phase 0 fix):* `fetchAppData` only
   loads the **100 most-recent** activity-log docs from the subcollection, so the
   backup can contain at most those 100. The full history lives in
   `apps/{orgId}/activityLogs/*` and is retained 90 days by
   `cleanupOldActivityLogs`. A restore via the admin "replace" path
   (`applyOrgReplace`) does **not** rewrite `activityLogs` at all — they are
   preserved in the JSON file for forensic/manual use only.

2. **`users[].organizationId` fell back to the literal string `"default"`** when a
   user record had no `organizationId`. `"default"` is a known-bad value in this
   project (it is also the wrong Firestore database id). **Fixed:** falls back to
   the real org id (`VITE_ORG_ID` / `"utd"`).

3. **`legacyUnclaimedRole` is absent from the backed-up user records** — verified
   **NOT a gap.** That field is derived in-memory in `useAppAuth` for a one-time
   UI banner and is never written into `apps/{orgId}.users`. Omitting it is
   correct.

Regression test: `test/orgWrites/backupPayload.test.ts` (pins full coverage +
both fixes; will fail if `AppData` and the payload builder drift apart).

### Manual step for Kiattisak — do this immediately before starting the real migration

> 1. Open the app as an **admin**, go to the data/admin screen, click
>    **"Backup Data (JSON)"**, and let it download.
> 2. Save that `.json` file **outside the app and outside Firestore** — e.g.
>    Google Drive + a local copy. Do **not** rely on it merely existing in a
>    Firestore doc.
> 3. Open the file and sanity-check the `summary` counts (teachers / subjects /
>    scheduleEntries / users) against what the app shows.
> 4. Only proceed with the migration once that file is safely stored and verified.

---

## 2. `schemaVersion` (Task 2)

Added `organizationSettings.schemaVersion?: number` (`types.ts`).

- **Meaning:** `1` = current monolithic-document shape. The subcollection
  migration will bump it so a client can tell old-shape from new-shape data
  during the dual-write transition.
- **Default / migration-on-read:** `normalizeLoadedOrganizationSettings()` in
  **`lib/normalizeAppData.ts`** (constant `CURRENT_ORG_SCHEMA_VERSION = 1`). It
  stamps `schemaVersion: 1` onto any non-null settings object that lacks a valid
  one; `null` settings pass through untouched. Wired into **all three load
  paths**: `fetchAppData` (`api.ts`), `useAppAuth.updateCombinedAppData`
  (`hooks/useAppAuth.ts`), and `App.executeRestore` (`App.tsx`). New orgs get it
  from `getSampleAppData()`'s default settings.
- **No dual-write logic** was added (that is a later phase). No forced server
  write — the field lands on the server the next time settings are saved for any
  other reason; until then every client sees it via the read-time default.

Test: `test/orgWrites/schemaVersion.test.ts`.

---

## 3. Integration-test safety net (Task 3)

New file: **`test/orgWrites/entityLifecycle.emulator.test.ts`** — Firestore
emulator, exercising the real server write path
(`applyOrgChanges` / `applyOrgReplace` from `functions/src/orgWrites.ts`).
Runs under `npm run test:rules:emulate` alongside the existing suite.

| Suite | What it pins |
| --- | --- |
| Teacher lifecycle | create → fresh read (all fields) → partial update (only sent field changes) → delete (only that row) |
| Subject lifecycle | create → read → rename with code preserved → delete; `subjectCode` collision (case-insensitive) rejected & not written; same-code self-update allowed |
| Teacher–Subject assignment lifecycle | create + both sides resolve; **KNOWN-GAP baseline:** deleting the teacher leaves a *dangling* assignment (no server-side cascade / referential integrity); in-use assignment-delete rejected, free one allowed |
| Schedule entry lifecycle | create → present in **both** the doc field and the `scheduleEntries` subcollection mirror → update period (both) → delete (both) |
| Cross-entity read consistency | a mixed sequence of writes + deletes → one full fresh read asserts exact ids/counts across every array, the subcollection mirror, and that `users` / `authorizedAdmins` / `organizationSettings` / `organizationId` were never touched |
| Schedule conflict detection | `it.todo(...)` for the unimplemented check **+** a baseline test asserting the server currently **accepts** a double-booked teacher/room/class |

### ⚠️ Task 3.6 finding — carry this into the migration plan

**There is no server-side conflict detection for `scheduleEntries`.** The write
path (`mergeOrgChanges` → merge-by-id, `syncScheduleSubcollection` → blind
upsert) will happily persist two entries that put the **same teacher / same room
/ same class** in the **same day + period**. The baseline test
(`Schedule conflict detection — KNOWN GAP`) documents this; it is **not** an
assertion that the permissive behaviour is correct. Per the architecture review,
building conflict detection is a **separate, later priority** and is explicitly
out of scope for Phase 0.

Related gap (Task 3.3): **no referential integrity between the entity arrays.**
Deleting a teacher / subject / grade level does not cascade to
`teacherSubjectAssignments` or `scheduleEntries` server-side. Any cleanup today
is client-side (`App.tsx`) and is bypassed by direct callable writes. The
migration must decide whether to add cascade/cleanup as part of the move.

### Test count

`npm run test:rules:emulate`:

- Before: **84** passed.
- After: **111 passed + 1 `todo`** (112 total). Added **+27 passing tests +1 todo**:
  - `test/orgWrites/entityLifecycle.emulator.test.ts` — **13** emulator lifecycle
    tests + **1 `it.todo`** (the unimplemented conflict check).
  - `test/orgWrites/schemaVersion.test.ts` — **6** pure tests
    (`normalizeLoadedOrganizationSettings` / migration-on-read).
  - `test/orgWrites/backupPayload.test.ts` — **8** pure tests (backup coverage +
    the two Task 1 fixes).

---

## Constraints honoured

- No dual-write / Phase 1 migration logic started.
- `firestore.rules` and the Phase 1 RBAC work untouched.
- The missing conflict detection is **documented via tests only**, not built.
