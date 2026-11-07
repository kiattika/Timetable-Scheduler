# Phase 3, step 2 — `teacherSubjectAssignments` live only in their subcollection

**Why.** The links are the largest array on `apps/{orgId}` (1,081 links ≈ 232 KB) and the one written most. With
dual-write every link change rewrote the whole array (optimistic concurrency on the 1 MiB main doc, ~5 s per change,
conflicts when many people schedule at once).

**Precondition.** The Phase-2 read flip is on system-wide and `Verify` is ok — the mirror subcollection is complete
and already what everyone reads.

## What changed

**Functions (`orgWrites.ts`, `index.ts`)**
- `SUBCOLLECTION_ONLY_FIELDS = ['scheduleEntries', 'teacherSubjectAssignments']`.
- `commitOrgChanges` / `applyOrgChanges`: link upserts/deletes go straight to `apps/{org}/teacherSubjectAssignments/{id}`
  (`applySubcollectionChanges`, `set merge` / `delete`). The array merge never touches the field.
- "Link still on the timetable" guard: `filterAssignmentDeletesInUse` (pure, tested) over the affected link docs
  (`getAll` by id) and the timetable entries of their subjects.
- Legacy array: the first commit after deploy copies any link missing from the subcollection, then deletes the field
  from the main doc (`healLegacySubcollectionField`, generic version of the step-1 helper). It runs before the
  commit's own changes, so a delete in the same commit is never undone.
- `assistantUpdateEntity`: links read/written as subcollection docs; if the legacy array is still on the main doc it
  is folded in and dropped first. Department check of a subject without a department now loads that subject's links
  from the subcollection.
- Restore (`applyOrgReplace`): every subcollection-only field in the backup is rebuilt as its subcollection and the
  legacy array dropped.
- `migrate-to-subcollections.ts`: skips a subcollection-only field that has no array on the main doc (rebuilding it
  from the missing array would have deleted every document — this also protected `scheduleEntries`).

**Client**
- `useAppAuth`: links always come from their subcollection listener, whatever the read-flip switch says (falls back to
  a legacy array only if the listener fails). Order: main-doc order while the array exists, then by id.
- `fetchAppData` (backups, reset preview): reads the link subcollection.
- `resetSemesterTimetable`: deletes the ids found in the subcollection (+ any legacy array).
- System Health `Verify`: once the array is gone, links are reported ok (nothing to compare).
- Backup guard: `findIncompleteBackupWarning` — a timetable with entries but no teachers/subjects/links blocks the
  backup in the reset dialog and asks for confirmation in the system menu.

## Deploy (order matters)
1. Back up (Organization page) and keep the file off this computer.
2. **Client first** — publish from AI Studio, reload. New clients read links from the subcollection and back up from it.
3. Functions:
   ```powershell
   cd functions; npm ci; npm run build; cd ..
   firebase deploy --only "functions:commitOrgChanges,functions:assistantUpdateEntity" --project kiattisak-smart-school
   ```
4. Make one real edit (any) as admin/manager → log shows
   `legacy teacherSubjectAssignments array: 1081 items, 0 copied to subcollection before removal`.
5. System Health: main document ≈ 230 KB smaller; Verify ok; download a backup and check `summary.teacherSubjectAssignmentsCount`.

## Roll back
Redeploy the previous functions and client, then restore the backup from step 1 (or a newer one made by this
client). The old functions would otherwise rebuild the array from nothing.
