# Phase 1 — Dual-Write (Monolithic Doc + Mirror Subcollections) — Runbook

Branch: `phase-1-dual-write` (code + emulator tests only — nothing here has been
deployed or run against production).

Firebase project: `kiattisak-project-001` (alias `timetable`)
Firestore database: `ai-studio-ddf61d33-4a5f-4aed-a5a9-5bc34b3c98da` (**non-default** — always pass explicitly)

Goal: `teachers`, `subjects`, `gradeLevels`, `physicalRooms`,
`teacherSubjectAssignments`, `periodSettings`, `users` are written to BOTH their
existing inline array on `apps/{orgId}` AND a mirror subcollection, kept in sync
on every write and backfilled for existing data. **Reads do not change.** If the
dual-write is wrong it is invisible to users and rolled back by simply
redeploying the previous functions.

---

## 0. What changed (code)

| File | Change |
| --- | --- |
| `functions/src/orgWrites.ts` | New: `MIRRORED_ENTITY_FIELDS`, `applyEntityMirror`, `mirrorPeriodSettingsDoc`, `rebuildEntityMirror`, `mirrorUserDoc`, `deleteMirrorUserDoc`, `syncAllEntityMirrors`, `verifyOrgConsistency`. `applyOrgChanges` and `applyOrgReplace` now mirror all entity fields (not just `scheduleEntries`). |
| `functions/src/index.ts` | `assistantUpdateEntity` now mirrors `teachers` / `subjects` / `teacherSubjectAssignments` (was `scheduleEntries` only). `setUserRole` / `bootstrapAdmin` / `registerCurrentUser` mirror the changed user doc. New callable `verifyOrgConsistencyFn`. |
| `scripts/migrate-to-subcollections.ts` | Rewritten for Phase 1: additive backfill of the 7 entity types (+ single `periodSettings` doc + `users`), `--dry-run`, `--verify-only`, idempotent, targets the named DB, reuses the live write helpers. Old destructive version kept as `…​.phase2-bak`. |
| `firestore.rules` | Added a **read-only** rule for the mirror subcollections (same domain-account read as the array field). No client write grant — Admin SDK only. Scoped so `scheduleEntries` / `activityLogs` / `errors` are unaffected. |
| `test/orgWrites/entityLifecycle.emulator.test.ts` | `afterEach` runs `verifyOrgConsistency` after every lifecycle test; new "mirror mechanics" block. |
| `test/rules/firestore.rules.test.ts` | New block covering the mirror subcollection rules + a no-regression check. |
| `test/orgWrites/mirrorDualWrite.emulator.test.ts` | New — focused dual-write / backfill / consistency tests. |

### Mirror shapes

| Source (array on `apps/{orgId}`) | Mirror |
| --- | --- |
| `teachers`, `subjects`, `gradeLevels`, `physicalRooms`, `teacherSubjectAssignments`, `scheduleEntries` | one doc per entity: `apps/{orgId}/{field}/{entityId}` |
| `periodSettings` | **one** doc `apps/{orgId}/periodSettings/current` = `{ items: PeriodSetting[] }` (order is load-bearing — `scheduleEntry.period` indexes it) |
| `users` | one doc per user: `apps/{orgId}/users/{uid}` |

---

## 1. Dual-write pattern & sequencing (Task 1.2)

**Found pattern (`scheduleEntries`):** the authoritative `apps/{orgId}` doc field
is written first with the existing optimistic-concurrency `update(..., {lastUpdateTime})`
+ bounded retry; the subcollection is then synced with idempotent per-id
`set(merge:true)` / `delete()` (`syncScheduleSubcollection`, called *after* the
doc commit). `assistantUpdateEntity` does the same: `arrayUnion`/`arrayRemove` /
optimistic update on the doc, then `subDocRef.set`/`delete`.

**Phase 1 follows it exactly**, generalised to all entity types via
`syncAllEntityMirrors` / `applyEntityMirror`.

### Why doc-field first, not mirror-first

`runTransaction` is not an option (hangs on this ENTERPRISE DB). So the write is
two steps and can partially fail. The ordering choice:

- **doc-first** → the mirror can only ever *lag* the authoritative doc. A lagging
  mirror is harmless in Phase 1 (nothing reads it) and self-heals.
- **mirror-first** → a mirror could end up *ahead* of the doc (mirror written,
  doc write then abandoned). A mirror holding a "ghost" entity the authoritative
  doc never got is a latent bug for the Phase 2 read-flip. Rejected.

### Failure modes and how each is handled

| # | Failure | Result | Recovery |
| --- | --- | --- | --- |
| 1 | doc `update` fails precondition (concurrent writer) | nothing written | existing bounded retry re-reads and re-merges |
| 2 | doc commit OK, mirror write throws (network / quota) | doc updated, mirror stale for those ids; whole callable throws `internal`/`unavailable` | client autosave (`classifySaveError` → **retryable**) resends the identical changeset; `mergeOrgChanges` is now a semantic no-op for the doc field → the **"no doc-field changes" branch also runs `syncAllEntityMirrors`** → mirror catches up. If the client gives up: `verifyOrgConsistency` flags it, `migrate-to-subcollections.ts` (no flags) heals it. |
| 3 | two concurrent `commitOrgChanges` | doc serialised by `lastUpdateTime`; each mirror write only touches the ids that writer changed → converge | — |
| 4 | `assistantUpdateEntity` delete with a stale `existing` object: `arrayRemove` no-ops but `subDocRef.delete()` still runs | mirror briefly *ahead* of doc for that id (pre-existing behaviour for `scheduleEntries`, now also the other 3 assistant types) | `verifyOrgConsistency` → `extraInMirror`; backfill re-adds from the doc |
| 5 | `assistantUpdateEntity` key-order-only "update" hits the semantic no-op guard | neither doc nor mirror rewritten | if the mirror was already stale it stays stale until a real edit / backfill — documented limitation, low impact |

**Idempotency of the mirror step:** `applyEntityMirror` is driven by the
*authoritative post-write array* (`updates[field]` or the untouched server array),
not the raw client payload — so an upsert `mergeOrgChanges` rejected (subjectCode
clash) is not mirrored, a delete it rejected (assignment in use) is not
mirror-deleted, and re-running with the same change is a no-op.

---

## 2. Backfill script (Task 2)

`scripts/migrate-to-subcollections.ts` — **audited & rewritten**. The previous
version used a bare `getFirestore()` (wrong DB), only handled
`scheduleEntries`/`activityLogs`, and **deleted those arrays from the main doc**
(that is Phase 2+ cleanup, not Phase 1). It is preserved as
`scripts/migrate-to-subcollections.ts.phase2-bak`.

The new script:

- **Additive only** — never writes/deletes a field on `apps/{orgId}`.
- **Reuses the live helpers** (`rebuildEntityMirror`, `mirrorPeriodSettingsDoc`,
  `mirrorUserDoc`, `verifyOrgConsistency`) — the entity→doc mapping is defined in
  exactly one place, so the script and production cannot drift.
- **Idempotent** — `rebuildEntityMirror` deletes any mirror doc whose id is not
  in the source array and upserts the rest; N runs === 1 run. Verified in
  `mirrorDualWrite.emulator.test.ts` ("backfill is idempotent" runs it 3× and
  asserts an identical, consistent result; a second run reports 0 net changes).
- **Dry run** — `--dry-run` prints per-field `+add / -del / ~upsert` counts and
  writes nothing.
- **Verify only** — `--verify-only` prints the `verifyOrgConsistency` report and
  exits non-zero on divergence.
- Targets `FIRESTORE_DATABASE_ID` (defaults to the prod named DB, same as the
  functions).

```
npx tsx scripts/migrate-to-subcollections.ts [orgId] [--dry-run | --verify-only]
```

---

## 3. Consistency verification (Task 3)

Three ways, same core (`verifyOrgConsistency` in `orgWrites.ts`):

1. **Callable** `verifyOrgConsistencyFn({ orgId?, includeUsers? })` — admin-only,
   read-only. Returns `{ ok, fields: [{ field, docCount, mirrorCount,
   missingInMirror[], extraInMirror[], contentMismatch[], ok }] }`.
2. **Script** `npx tsx scripts/migrate-to-subcollections.ts utd --verify-only`.
3. **Emulator tests** — `afterEach` in `entityLifecycle.emulator.test.ts` +
   dedicated cases in `mirrorDualWrite.emulator.test.ts`.

Checks: same entity count, same id set, field-by-field content (order-insensitive
via `canon`), and for `periodSettings` also **same order**.

---

## 4. Tests

`npm run test:rules:emulate`

- Phase 0 baseline: **111 passed + 1 todo** (112).
- Phase 1: **130 passed + 1 todo** (131). +19 tests:
  - `entityLifecycle.emulator.test.ts` — every lifecycle test now also asserts
    mirror consistency (`afterEach` → `verifyOrgConsistency`); + "Phase 1 — mirror
    mechanics" block (**6**: create/partial-update/delete mirror content, rejected
    upsert not mirrored, periodSettings single ordered doc, `applyOrgReplace`
    rebuild).
  - `mirrorDualWrite.emulator.test.ts` — **9** new: one-call multi-entity mirror,
    incremental sync, self-heal via re-sent changeset, backfill idempotency (3×),
    stale-row cleanup, and `verifyOrgConsistency` detecting content drift /
    extra-in-mirror / missing-in-mirror / periodSettings re-order / users drift.
  - `firestore.rules.test.ts` — **4**: mirror read allowed for domain accounts,
    denied for non-domain, no client write for anyone, and no regression to
    `scheduleEntries` / `activityLogs` / `errors`.

All 112 Phase 0 tests still pass unchanged.

### Backfill script — verified against the emulator this session

`firebase emulators:start --only firestore` + seed `apps/utd` (with a planted
stale mirror row) →

- `… --dry-run` → reports `teachers +add=2 -del=1`, writes nothing.
- `…` (real) → `teachers upserts=2 deletes=1` (stale row pruned), ends
  `post-backfill consistency: OK ✓`.
- `…` again → `deletes=0` everywhere (idempotent), still `OK ✓`.
- `… --verify-only` → `✓ CONSISTENT`, exit 0.

---

## 5. PRODUCTION RUNBOOK (Kiattisak drives this — do not run from the dev session)

> Pre-req: Phase 1 RBAC (rules + claims backfill) already live. Take a fresh
> **Backup Data (JSON)** first (see `docs/phase-0-migration-prep.md` §1).

### Step 1 — deploy functions (additive, no behaviour change for users)

```bash
git checkout phase-1-dual-write
cd functions && npm ci && npm run build && cd ..
npm ci && npm run lint

firebase deploy --only functions --project timetable
```

New/changed callables: `verifyOrgConsistencyFn` (new), `commitOrgChanges` /
`assistantUpdateEntity` / `setUserRole` / `bootstrapAdmin` / `registerCurrentUser`
(now also mirror-write). Reads unchanged. Rollback = redeploy previous functions.

Smoke: as admin, edit one teacher field, save. Then:

```js
const r = await firebase.functions().httpsCallable('verifyOrgConsistencyFn')({ orgId: 'utd', includeUsers: true });
console.log(r.data);   // that teacher's mirror should now exist; other fields will show missingInMirror until step 3
```

### Step 2 — backfill DRY RUN

```bash
export FIRESTORE_DATABASE_ID='ai-studio-ddf61d33-4a5f-4aed-a5a9-5bc34b3c98da'
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json   # admin creds

npx tsx scripts/migrate-to-subcollections.ts utd --dry-run
```

Expect: per-field `source=N mirror=M +add=… -del=0 ~upsert=…`. `-del` should be
**0** on a first run (nothing stale). Sanity-check `source` counts against the app.

### Step 3 — backfill FOR REAL

```bash
npx tsx scripts/migrate-to-subcollections.ts utd
```

It runs `verifyOrgConsistency` at the end and exits non-zero if anything still
diverges. Expect `✓ Backfill complete and verified consistent.`

### Step 4 — verify again (independent)

```bash
npx tsx scripts/migrate-to-subcollections.ts utd --verify-only
```

or the callable:

```js
const r = await firebase.functions().httpsCallable('verifyOrgConsistencyFn')({ orgId: 'utd', includeUsers: true });
console.log(JSON.stringify(r.data, null, 2));   // ok: true, every field ok: true
```

### Step 5 — soak (recommended a few days)

Leave the app in normal use. Re-run step 4 daily. `ok: true` every time means the
live dual-write is holding. Any divergence: capture the report, re-run step 3
(idempotent — it heals), investigate the diff.

### Step 6 — (optional, low-risk) deploy the mirror read rules

```bash
firebase deploy --only firestore:rules --project timetable
```

Only grants domain-account **read** on the mirror subcollections (needed before
Phase 2 flips reads; harmless now). Not required for Phase 1 to function — the
dual-write is Admin SDK. Safe to defer to the start of Phase 2.

### Rollback

- Functions: `firebase deploy --only functions` from the previous commit. The
  mirror subcollections are then simply abandoned (nothing reads them). Optional
  cleanup: delete the subcollections.
- Rules: `cp firestore.rules.bak firestore.rules && firebase deploy --only firestore:rules` (the mirror read rule is purely additive; rollback only if step 6 was done and something unexpected happens).
- The monolithic `apps/{orgId}` doc was never at risk in this phase.

---

## 6. Out of scope (later phases)

- Flipping any reader (`fetchAppData`, `useAppAuth` listeners, UI) onto the
  subcollections — **Phase 2**.
- Removing the inline arrays from `apps/{orgId}` (`…​.phase2-bak` script) — Phase 3+.
- `activityLogs` / `errors` — already mirrored / already subcollections.
- Tightening mirror-subcollection **write** rules beyond default-deny.
- `assistantUpdateEntity` stale-`existing` delete edge (failure mode #4) and the
  key-order no-op edge (#5) — healed by backfill; a targeted fix can wait.
