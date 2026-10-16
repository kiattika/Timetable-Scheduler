# Phase 3, step 1 — `scheduleEntries` live only in their subcollection

**Why.** `apps/{orgId}` is one Firestore document with a hard 1 MiB limit. A full timetable
(~75 classes x ~32 periods x ~480 B ≈ 1.1 MB) cannot fit, and the logo/emblem images already used ~700 KB.
Symptom: `commitOrgChanges` -> 500 `INVALID_ARGUMENT ... exceeds the maximum allowed size of 1,048,576 bytes`.

**What changed (functions).**
- `commitOrgChanges` / `applyOrgChanges`: scheduleEntries upserts/deletes go straight to `apps/{org}/scheduleEntries/{id}`
  (`set merge` / `delete`, idempotent). They are no longer merged into an array on the main doc.
- The "assignment still on the timetable" guard (409) now queries the subcollection by `subjectId`.
- Legacy array cleanup: the first commit after deploy copies any legacy entry missing from the subcollection,
  then removes the `scheduleEntries` field from the main doc (`FieldValue.delete()`).
- `assistantUpdateEntity` (type `scheduleEntries`): reads/writes the subcollection doc only.
- Restore (`applyOrgReplace`): rebuilds the subcollection from the backup and drops the legacy field.
- `verifyOrgConsistency`: scheduleEntries has nothing on the main doc to compare, reported ok.

**Client.** No change needed: it already reads scheduleEntries from the subcollection first and only falls back to the
main-doc array when the subcollection is empty (the array is gone after the first commit).

**Deploy.** `firebase deploy --only functions:commitOrgChanges,functions:assistantUpdateEntity`

**Roll back.** Redeploy the previous functions. The subcollection is complete, so nothing is lost; the old code would
re-create the array on the main doc.

**Not done yet (later steps).** `teacherSubjectAssignments` (~333 KB) and `subjects` (~251 KB) still live on the main doc
too; with scheduleEntries gone the doc stays at roughly 0.75 MB, so these are optional.
