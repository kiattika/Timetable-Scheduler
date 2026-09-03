# Phase 1 — Firestore RBAC: Deployment Runbook

Branch: `phase-1-firestore-rbac`
Firebase project: `kiattisak-project-001` (alias `timetable`)
Firestore database: `ai-studio-ddf61d33-4a5f-4aed-a5a9-5bc34b3c98da` (**non-default** — always pass it explicitly)

This branch contains **code + emulator tests only** for the rules work. The
`assistantUpdateEntity` / `registerCurrentUser` functions HAVE been deployed
(commit `ea29517`) to fix a production hang — see the critical issue below.
Follow the steps below **in order**. Do not reorder or skip.

---

## ⚠️ CRITICAL — production database is ENTERPRISE edition with a hard read cap

Discovered 2026-09-02 while fixing an `assistantUpdateEntity` hang.

`ai-studio-ddf61d33-4a5f-4aed-a5a9-5bc34b3c98da` is a **Firestore ENTERPRISE
edition** database with a **"free tier database" daily read quota that billing
cannot lift** (`firebase firestore:databases:get` → `Edition: ENTERPRISE`; the
quota error literally says *"This database cannot exceed free quota limits even
when a billing instrument is enabled"*). Once the daily read units are spent,
**every** Firestore read across the whole app fails with `RESOURCE_EXHAUSTED`.

Two consequences already fixed in code (commit `ea29517`, deployed):

1. **`db.runTransaction()` against this DB hangs ~20-70s on `tx.get()`** under any
   concurrency (plain `.get()`/`.update()` are fine). `assistantUpdateEntity` and
   `registerCurrentUser` were rewritten to use atomic `FieldValue.arrayUnion` /
   `arrayRemove` and optimistic `lastUpdateTime` preconditions — no transactions.
   A 15s `Promise.race` deadline turns any future stall into a fast, clear error.
2. **Client autosave retry storm** (`App.tsx`) amplified the read burn — an
   `assistantSyncInFlight` guard now serialises assistant syncs. **Needs a client
   redeploy** to take effect.

**Still open — infrastructure decision required (NOT a code fix):**
the data must move off this Enterprise free-tier DB, or the app will keep hitting
the daily cap under normal load. The project's `(default)` database is **STANDARD**
edition (normal pay-as-you-go quotas, full transaction support) and unused. Moving
there (or to a new STANDARD named DB) means updating, together:
- `firebase.json` → `firestore[0].database`
- `FIRESTORE_DATABASE_ID` in `functions/src/index.ts`
- `VITE_FIREBASE_DATABASE_ID` in the client build/deploy env
- copy `apps/utd` + `apps/utd/scheduleEntries` + `apps/utd/activityLogs` across
- re-run the Phase 1 claims backfill note is unaffected (claims are per-project)

Until then: the quota resets daily (~00:00 America/Los_Angeles). Ask testers to
close the app when not actively testing.

---

## ⚠️ CRITICAL #2 — admin/manager save was a blind full-document overwrite

Discovered 2026-09-02. Confirmed data loss: a teacher and 3 of 4 subjects were
silently erased during concurrent multi-role editing.

`saveAppData` sent the ENTIRE local `appData` as `set(apps/{orgId}, ..., {merge:true})`.
`merge:true` only merges top-level keys, so `{teachers:[...]}` REPLACES the whole
array — a stale client wipes out other users' concurrent changes.

**Fixed** (commit `d62bedf`):
- New callable **`commitOrgChanges`** (deployed): client sends only its own
  diff vs the last-synced baseline; server merges onto a fresh read by `id`,
  with a `lastUpdateTime` precondition + bounded retry. Never writes
  `users` / `authorizedAdmins`. `replace` mode for admin restore preserves the
  user list.
- `assistantUpdateEntity` / `registerCurrentUser` share the same
  `optimisticDocUpdate` helper; no more near-duplicate inline retry loops.
- `subjectCode` uniqueness now enforced server-side (both write paths) +
  client-side form validation + Excel-import dedup.
- `test/orgWrites/` — 33 pure + emulator cases incl. the acceptance scenario.

**⚠️ NOT deployed: the client.** `commitOrgChanges` is inert until the web
client is rebuilt and deployed — the old blind-overwrite `saveAppData` is still
what production runs. **Keep concurrent multi-role editing paused until the
client ships.**

Client deploy: `npm run build` → your normal hosting/Cloud Run pipeline. Then
smoke-test the acceptance scenario below.

### Acceptance smoke test (after client deploy)
1. Client A (assistant) adds a new subject via the app.
2. Client B (admin/manager) — open in a second browser BEFORE step 1, make an
   unrelated edit (add a teacher), let it autosave.
3. Confirm A's subject is still present. Reverse the order and repeat.
4. Two admins editing different fields concurrently — both edits survive.
5. Two clients creating a subject with the same `subjectCode` ~simultaneously —
   exactly one succeeds, the other gets a clear "รหัสวิชาซ้ำ" error, no dup lands.

### Still broken, separately (not in scope of this fix)
`resetSemesterTimetable` (api.ts) still uses a client `runTransaction`, which
hangs on the ENTERPRISE database. Admin "reset for new semester" will time out.
Needs the same non-transactional treatment.

---

## ⚠️ CRITICAL #3 — every save re-sent (almost) every entity ("spurious updates")

Discovered / confirmed 2026-09-03.

Change-detection compared entities with `JSON.stringify`, which is **key-order
sensitive**. The production **ENTERPRISE**-edition DB returns document/array-element
map keys in an **arbitrary per-map order** (REST probe: every teacher/subject in
`apps/utd` has a different key order; the diagnostic caught live spurious calls
with `existingKeys=[teacherId,id,subjectId,gradeLevelId]` vs
`payloadKeys=[gradeLevelId,subjectId,id,teacherId]` — same keys, same content).
So whenever the diff baseline and current `appData` came from different SDK
document states, **every** entity looked "changed" → one "add a subject" fired
dozens of `assistantUpdateEntity` / `commitOrgChanges` writes. On a quota-capped
DB this alone could exhaust the daily cap.

Compounded by three divergent client-side subject-normalisation implementations
(`fetchAppData` / `useAppAuth` / `executeRestore`) producing different key SETS.

**Fixed** (commits `0125ad2`, `e0c94b1`):
- `canonicalKey` (recursively sorts object keys, keeps array order) replaces
  `JSON.stringify` in every change-detection site — client (`diffById`,
  `computeOrgChanges`, new shared `diffAssistantEntities`, the App autosave gate)
  and functions (conflict logging).
- One shared `normalizeLoadedSubject` (`lib/normalizeAppData.ts`) for all load paths.
- **Server no-op guard (deployed):** `assistantUpdateEntity` and `mergeOrgChanges`
  detect a payload that only reorders keys and return success with **no write**.
  Verified in production — the pre-existing spurious storm now returns
  SUCCESS/no-op instead of 403.

**⚠️ Client still pending deploy.** The server guard contains the damage (no
writes, no errors) but the spurious *calls* keep happening until the client
ships `0125ad2`. Acceptance test after client deploy:
1. Assistant adds ONE subject → Network shows exactly ONE `assistantUpdateEntity` call.
2. Admin edits ONE teacher field → `commitOrgChanges` payload `changes.teachers.upsert`
   has only that teacher; no other fields populated.

---

## 0. What changed

| Area | Change |
| --- | --- |
| `functions/src/index.ts` | All `getFirestore()` → `getDb()` targeting the **named** database (they were silently using `(default)`). `setUserRole` / `bootstrapAdmin` now also write `orgId` + `assignedDepartments` claims. New callables: `backfillUserClaims`, `registerCurrentUser`, `assistantUpdateEntity`. |
| `firestore.rules` | Writes now gated on `role` + `orgId` claims. Managers cannot write `users` / `authorizedAdmins`. Assistants cannot write `apps/{appId}` or its subcollections directly. **Reads unchanged** (still `@utd.ac.th` domain gate — see note below). |
| `api.ts` | `registerCurrentUser()` + `persistAssistantChanges()` (routes assistant edits through `assistantUpdateEntity`). |
| `App.tsx` | Blob autosave restricted to `admin` / `manager`; assistants go through `persistAssistantChanges`. |
| `hooks/useAppAuth.ts` | First-login registration now calls `registerCurrentUser` instead of a direct `saveAppData` write. |
| `firebase.json` | Added `emulators` block. |
| `test/rules/` + `vitest.config.ts` | Emulator rule tests (19 cases). |
| `firestore.rules.bak` | Byte copy of the pre-change rules for instant rollback. |

### Design note — reads stay domain-gated
The plan's draft gated reads on `belongsToOrg()`. That was **not** adopted: the app's
guest onboarding + "waiting for approval" screen depend on a logged-in guest being
able to read `apps/utd` (and `useAppAuth` can only call `registerCurrentUser` after a
successful read). Tightening reads to `orgId` belongs with the deferred
`isUtdDomain()` → multi-tenant cleanup. The **write** vulnerability (guest / assistant
writing the whole document) is fully closed.

### Known behaviour changes to smoke-test
- A **manager** who edits `schoolAdminEmail` in Organization Settings (which rewrites
  the `users` array client-side) will now get a permission error. This is intended —
  only admins reassign admins — but the UI still shows the old "set your Firestore
  rules to allow all" alert. Acceptable for Phase 1; fix the client gate in Phase 2.
- `saveAppData` step 3 (re-writing the 10 most recent activity logs into the
  subcollection) fails silently for managers if those log docs already exist
  (`allow update` is admin-only). Already wrapped in "bypassed" handling; the primary
  `logActivity` path (new docs) is unaffected.

---

## 1. Pre-flight

```bash
git checkout phase-1-firestore-rbac
firebase login          # if needed:  ! firebase login
firebase use timetable

cd functions && npm ci && npm run build && cd ..
npm ci
npm run lint             # tsc --noEmit, must pass
```

Run the rule tests (needs Java; the Firestore emulator jar downloads on first run):

```bash
npm run test:rules:emulate      # firebase emulators:exec + vitest, 19 tests
```

If `emulators:exec` leaves a stale Firestore process on Windows (port 8080), kill it
(`netstat -ano | findstr :8080` → `taskkill /PID <pid> /F`) or run the emulator in its
own terminal (`firebase emulators:start --only firestore`) plus `npm run test:rules`.

### Optional: exercise the new callables in the emulator
The functions default `FIRESTORE_DATABASE_ID` to the prod named DB. For the emulator,
either create that named database in the Firestore emulator or run with
`FIRESTORE_DATABASE_ID=(default)`:

```bash
cd functions && FIRESTORE_DATABASE_ID='(default)' firebase emulators:start --only functions,firestore,auth
```

Manually verify: `backfillUserClaims({dryRun:true})`, `assistantUpdateEntity` allow/deny
by department, `registerCurrentUser` idempotency.

---

## 2. Deploy functions (safe — no behaviour change yet)

```bash
firebase deploy --only functions --project timetable
```

New functions (`backfillUserClaims`, `registerCurrentUser`, `assistantUpdateEntity`)
are additive. `setUserRole` / `bootstrapAdmin` now write richer claims but only when
called. The `getDb()` change means `logLoginAttempt`, `cleanupOldActivityLogs`, and the
Firestore-sync half of `setUserRole` now hit the **named** DB instead of `(default)` —
verify after deploy:

```bash
# a fresh login should now land its "Logged In" activity doc in the NAMED db
firebase firestore:documents:list "apps/utd/activityLogs" \
  --database ai-studio-ddf61d33-4a5f-4aed-a5a9-5bc34b3c98da --project timetable | head
```

---

## 3. Backfill claims for ALL existing users — **BLOCKING PREREQUISITE**

Reads are not affected, but every admin/manager loses **write** access until their
account has an `orgId` claim. Do this before touching rules.

From an authenticated admin browser session (e.g. a dev console snippet on the live
app, or `firebase functions:shell`):

```js
// dry run first
const r = await firebase.functions().httpsCallable('backfillUserClaims')({ dryRun: true });
console.log(r.data);   // { totalUsers, updatedCount, alreadyCompliant, updatedEmails }

// then for real
const r2 = await firebase.functions().httpsCallable('backfillUserClaims')({});
console.log(r2.data);
```

**Verification (do not proceed until green):**
- `r2.data.totalUsers` === your total Firebase Auth user count
  (`firebase auth:export users.json --project timetable` → count records).
- `r2.data.updatedCount + r2.data.alreadyCompliant === r2.data.totalUsers`.
- Re-run `backfillUserClaims` → `updatedCount` should now be `0`.
- Spot-check 3–4 users in Firebase console → Authentication → user → custom claims:
  each has `role`, `orgId: "utd"`, `assignedDepartments: [...]`.

Existing sessions pick up new claims within ~1h or on next sign-in / token refresh.
Ask known admin/manager testers to sign out and back in before step 5.

---

## 4. Deploy client (`api.ts` / `App.tsx` / `useAppAuth`)

Safe before the rules change — the old rules still allow these writes, and the new
client paths (`registerCurrentUser`, `assistantUpdateEntity`) already have their
functions live from step 2.

```bash
npm run build
# deploy via your normal hosting/Cloud Run pipeline for this repo
```

Confirm: an admin and a manager can still load and save; an assistant can still edit
their department's teachers/subjects/assignments/schedule (now via the callable —
check the Network tab for `assistantUpdateEntity`).

---

## 5. Deploy the rules — point of no easy return

```bash
# sanity: confirm the target database in firebase.json is the named one
firebase deploy --only firestore:rules --project timetable
```

`firebase.json` already targets `ai-studio-ddf61d33-…`, so this updates the correct DB.

---

## 6. Production smoke test — immediately after step 5

With **real accounts**, one per role (sign out/in first so claims are fresh):

| Role | Expect |
| --- | --- |
| `admin` | Load app, edit a teacher, save OK. Edit a user role via User Management OK. |
| `manager` | Load app, edit a subject/schedule, save OK. User Management save → **denied** (expected). |
| `assistant` | Load app. Edit a teacher **in an assigned department** → OK (via `assistantUpdateEntity`). Edit one **outside** → denied with a clear message. |
| `guest` | Sees "waiting for approval" screen, no errors in console. |
| logged out | Login screen; no Firestore permission spam in console. |

Also confirm a brand-new `@utd.ac.th` sign-in creates a `users` entry (via
`registerCurrentUser`) and shows the guest screen.

---

## 7. Rollback (if any role is wrongly locked out)

```bash
cp firestore.rules firestore.rules.phase1   # keep the new one
cp firestore.rules.bak firestore.rules
firebase deploy --only firestore:rules --project timetable
cp firestore.rules.phase1 firestore.rules   # restore working copy
```

`firestore.rules.bak` is the exact pre-change ruleset. The deployed functions and
client from steps 2/4 are backward-compatible and do **not** need rolling back — the
old rules simply allow the direct writes again. The claims added in step 3 are
harmless under the old rules.

If only the `getDb()` change is the problem (logging landing in the wrong DB),
that is cosmetic for logs and does not warrant a rules rollback.

---

## 8. Out of scope (Phase 2)
- Monolithic `apps/{appId}` document → subcollection migration.
- Removing `isUtdDomain()` / tightening reads to `belongsToOrg()`.
- Client-side gate so managers don't hit the `schoolAdminEmail` permission error.
- Explicit top-level field whitelist in the rules (currently a `users` /
  `authorizedAdmins` deny-list) once integration tests pin the document shape.
- Functions-level integration tests for `assistantUpdateEntity` / `backfillUserClaims`.
