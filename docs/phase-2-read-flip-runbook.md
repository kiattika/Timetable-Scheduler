# Phase 2 — read flip (flag-gated)

**What it does.** With `VITE_READ_FROM_SUBCOLLECTIONS=true` the client builds
`teachers`, `subjects`, `gradeLevels`, `physicalRooms`, `teacherSubjectAssignments`
and `periodSettings` from the Phase-1 mirror subcollections instead of the arrays on
`apps/{orgId}`. Default **off** = behaviour identical to before.

**Unchanged:** writes (`commitOrgChanges` still writes the doc first, then mirrors),
`scheduleEntries` / `activityLogs` (already subcollections), `users`,
`authorizedAdmins`, `organizationSettings`, `departments`, `resourceTypes` (stay on
the main doc — small and security-relevant).

**Rules of the read** (`lib/subcollectionReads.ts`, unit-tested):
- the UI waits until the main-doc listener AND all 6 mirror listeners reported, so a
  half-loaded empty list can never become the autosave baseline;
- mirror empty + doc non-empty (never backfilled) -> use the doc array;
- listener failed / permission-denied after retries -> use the doc array;
- otherwise mirror is the truth for content and membership; the doc array is only an
  ORDER hint (subcollections have no order). A divergence is logged once per field:
  `[read-flip] teachers: mirror and doc differ ...`.

## Before turning it on
1. `npx tsx scripts/migrate-to-subcollections.ts utd --verify-only` -> `ok: true`
   (set `FIRESTORE_DATABASE_ID=smartschool`, `GOOGLE_CLOUD_PROJECT=kiattisak-smart-school`).
2. The mirror **read rules** must be deployed to `smartschool`:
   `firebase deploy --only firestore:rules` (rule `match /{mirrorColl}/{docId}`).
   Without it the mirror listeners get permission-denied, retry ~20 s, then fall back
   to the doc arrays (works, but slow to load).
3. Cost: a client now reads ~800 docs on load (147 teachers + 31 subjects + 81 grades +
   25 rooms + 490 links + periodSettings) vs 1 doc before. Watch the read quota in the
   GCP console for a day.

## Turn on / roll back (buttons in the app)
System Health -> "แหล่งอ่านข้อมูล: เอกสารหลัก / แฟ้มย่อย (Phase 2)" (admin only):
- **Verify** button = the in-browser equivalent of `migrate-to-subcollections.ts --verify-only` (~800 reads).
- **1) This browser only** (ตามระบบ / เปิด / ปิด): localStorage, affects nobody else. "ปิดเฉพาะเครื่องนี้" is the escape hatch.
- **2) System-wide**: stored in `organizationSettings.readFromSubcollections` (saved through the normal autosave,
  no functions change). Enabling is blocked until Verify passes in this session. Everyone picks it up on next app load.
- Precedence: this browser > system-wide > `VITE_READ_FROM_SUBCOLLECTIONS` (build env, still supported) > off.
- The choice is made once per page load (first main-doc snapshot); after pressing a button, reload the page.
- Roll back: press the same button the other way (or "ปิดเฉพาะเครื่องนี้" first if you cannot reach the page normally).

## Smoke test after turning on
- Log in as admin: teacher / subject / link counts match the Manage pages before the flip.
- Edit a subject, reload: the edit persists. Add and delete a link: both persist.
- Open a second browser as another user: an edit shows up live.
- Browser console has no `[read-flip] ... differ` warnings.
