/**
 * orgWrites — concurrency-safe writes to the monolithic `apps/{orgId}` document.
 *
 * Why this exists:
 * The old admin/manager save path (`saveAppData` in api.ts) sent the ENTIRE local
 * `appData` as a blind `set(..., { merge: true })`. `merge: true` only merges at
 * the top level, so `{ teachers: [...] }` REPLACES the whole array — a stale
 * client silently clobbered other users' concurrent changes (confirmed data loss).
 *
 * The fix (mirrors `assistantUpdateEntity`'s proven pattern):
 *  - the client sends only the adds/updates/deletes it actually made
 *    (diffed against its last-synced baseline), never "here is my whole array";
 *  - the server applies those onto a FRESH read of the document, merging
 *    array-of-object fields by `id`;
 *  - the write carries a `lastUpdateTime` precondition; on conflict we re-read,
 *    re-merge and retry (bounded). No `runTransaction` — it hangs on this
 *    ENTERPRISE-edition database.
 *
 * `mergeOrgChanges` is a PURE function (no Firestore) so the merge semantics are
 * unit-testable without an emulator.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type {
  Firestore,
  DocumentReference,
  DocumentSnapshot,
} from 'firebase-admin/firestore';

export type IdItem = { id: string;[k: string]: any };
export type FieldChange = { upsert?: IdItem[]; deleteIds?: string[] };
export type OrgChanges = {
  teachers?: FieldChange;
  subjects?: FieldChange;
  gradeLevels?: FieldChange;
  physicalRooms?: FieldChange;
  departments?: FieldChange;
  resourceTypes?: FieldChange;
  teacherSubjectAssignments?: FieldChange;
  periodSettings?: FieldChange;
  scheduleEntries?: FieldChange;
  organizationSettings?: { set?: Record<string, any> };
};

/** Array-of-object top-level fields of `apps/{orgId}` that this path may write. */
export const ORG_ARRAY_FIELDS = [
  'teachers',
  'subjects',
  'gradeLevels',
  'physicalRooms',
  'departments',
  'resourceTypes',
  'teacherSubjectAssignments',
  'periodSettings',
  'scheduleEntries',
] as const;
export type OrgArrayField = typeof ORG_ARRAY_FIELDS[number];

/**
 * Identity / permission fields that this path must NEVER write — they are owned
 * by dedicated callables (setUserRole / bootstrapAdmin / registerCurrentUser).
 */
export const PROTECTED_ORG_FIELDS = ['users', 'authorizedAdmins'] as const;

export type CallerRole = 'admin' | 'manager';

/** Order-insensitive canonical serialization (object keys sorted, array order kept). */
export const canon = (x: any): string => {
  if (x === undefined || x === null) return 'null';
  if (typeof x !== 'object') { try { return JSON.stringify(x); } catch { return String(x); } }
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  return '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
};

export class OrgChangeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'OrgChangeError';
  }
}

const asArray = (v: any): IdItem[] => (Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : []);
const normCode = (v: any): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** Sanitise an untrusted FieldChange from the client. */
export function sanitizeFieldChange(raw: any): FieldChange {
  const out: FieldChange = {};
  if (raw && Array.isArray(raw.upsert)) {
    out.upsert = raw.upsert.filter((x: any) => x && typeof x === 'object' && typeof x.id === 'string');
  }
  if (raw && Array.isArray(raw.deleteIds)) {
    out.deleteIds = raw.deleteIds.filter((x: any) => typeof x === 'string' && x.length > 0);
  }
  return out;
}

export function sanitizeOrgChanges(raw: any): OrgChanges {
  const clean: OrgChanges = {};
  if (!raw || typeof raw !== 'object') return clean;
  for (const f of ORG_ARRAY_FIELDS) {
    if (raw[f]) {
      const fc = sanitizeFieldChange(raw[f]);
      if ((fc.upsert && fc.upsert.length) || (fc.deleteIds && fc.deleteIds.length)) clean[f] = fc;
    }
  }
  if (raw.organizationSettings && typeof raw.organizationSettings.set === 'object' && raw.organizationSettings.set) {
    // Never allow nested undefined; drop obviously invalid keys.
    const set: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw.organizationSettings.set)) {
      if (typeof k === 'string' && k.length <= 100 && v !== undefined) set[k] = v;
    }
    if (Object.keys(set).length) clean.organizationSettings = { set };
  }
  return clean;
}

export type MergeSummary = Record<string, { upserts: number; deletes: number; length: number }>;
export type RejectedChange = { field: string; id: string; reason: string };

/**
 * PURE. Given the fresh server document, the client's changes and the caller's
 * role, return the field updates to write, a summary, and any individual changes
 * that were REJECTED (skipped, not applied) — subjectCode collision, an
 * assignment still on the timetable. The rest of the changeset is still applied,
 * so one bad entity never blocks an otherwise-valid save. Only a structural
 * permission violation (non-admin toggling isLocked) still throws.
 */
export function mergeOrgChanges(
  serverDoc: Record<string, any>,
  changes: OrgChanges,
  callerRole: CallerRole,
): { updates: Record<string, any>; summary: MergeSummary; rejected: RejectedChange[] } {
  const updates: Record<string, any> = {};
  const summary: MergeSummary = {};
  const rejected: RejectedChange[] = [];

  // ---- organizationSettings: shallow key-level merge ----
  if (changes.organizationSettings?.set && typeof changes.organizationSettings.set === 'object') {
    const set = changes.organizationSettings.set;
    const serverSettings =
      serverDoc.organizationSettings && typeof serverDoc.organizationSettings === 'object'
        ? serverDoc.organizationSettings
        : {};
    if ('isLocked' in set && !!set.isLocked !== !!serverSettings.isLocked && callerRole !== 'admin') {
      throw new OrgChangeError('permission-denied', 'เฉพาะแอดมินเท่านั้นที่ล็อก/ปลดล็อกตารางเรียนได้ (admin only).');
    }
    updates.organizationSettings = { ...serverSettings, ...set };
    summary.organizationSettings = {
      upserts: Object.keys(set).length,
      deletes: 0,
      length: Object.keys(updates.organizationSettings).length,
    };
  }

  // ---- array-of-object fields: merge by id ----
  for (const field of ORG_ARRAY_FIELDS) {
    const change = changes[field];
    if (!change) continue;
    const upsertList = change.upsert || [];
    const deleteIds = new Set((change.deleteIds || []).filter((x): x is string => typeof x === 'string'));
    if (upsertList.length === 0 && deleteIds.size === 0) continue;

    const serverArr = asArray(serverDoc[field]);
    const byId = new Map<string, IdItem>();
    for (const it of serverArr) byId.set(it.id, it);

    // teacherSubjectAssignments: skip (don't apply) a delete of one still on the timetable.
    if (field === 'teacherSubjectAssignments' && deleteIds.size > 0) {
      const schedule = asArray(serverDoc.scheduleEntries);
      for (const id of Array.from(deleteIds)) {
        const asm = byId.get(id);
        if (!asm) continue;
        const inUse = schedule.some(
          (e: any) =>
            e.subjectId === asm.subjectId &&
            Array.isArray(e.teacherIds) &&
            e.teacherIds.includes(asm.teacherId) &&
            e.gradeLevelId === asm.gradeLevelId,
        );
        if (inUse) {
          deleteIds.delete(id);
          rejected.push({ field, id, reason: '409_CONFLICT_ASSIGNMENT_IN_USE' });
        }
      }
    }

    for (const id of deleteIds) byId.delete(id);

    // subjectCode uniqueness — skip a colliding upsert, keep the rest.
    const rejectedUpsertIds = new Set<string>();
    if (field === 'subjects') {
      const existingCodes = new Map<string, string>(); // normCode -> id, from entities NOT changed here
      const changedIds = new Set(upsertList.map((s) => s?.id).filter((x): x is string => typeof x === 'string'));
      for (const s of serverArr) {
        if (changedIds.has(s.id)) continue;
        const c = normCode(s.subjectCode);
        if (c) existingCodes.set(c, s.id);
      }
      for (const item of upsertList) {
        const c = normCode(item?.subjectCode);
        if (!c) continue;
        const owner = existingCodes.get(c);
        if (owner && owner !== item.id) {
          rejectedUpsertIds.add(item.id);
          rejected.push({ field, id: item.id, reason: `subjectCode "${item.subjectCode}" already used` });
        } else {
          existingCodes.set(c, item.id);
        }
      }
    }

    let upserts = 0;
    for (const item of upsertList) {
      if (!item || typeof item.id !== 'string' || deleteIds.has(item.id) || rejectedUpsertIds.has(item.id)) continue;
      const existing = byId.get(item.id);
      byId.set(item.id, existing ? { ...existing, ...item } : item);
      upserts++;
    }

    const merged = Array.from(byId.values());
    // Semantic no-op guard: if the merged array is identical to the server array
    // apart from map key order (the ENTERPRISE db returns keys in arbitrary order,
    // so a client's stringify-based diff over-reports "changed"), skip the write.
    if (canon(merged) === canon(serverArr)) continue;
    updates[field] = merged;
    summary[field] = { upserts, deletes: deleteIds.size, length: merged.length };
  }

  // Drop an organizationSettings write that only reorders keys.
  if (updates.organizationSettings && canon(updates.organizationSettings) === canon(serverDoc.organizationSettings)) {
    delete updates.organizationSettings;
    delete summary.organizationSettings;
  }

  return { updates, summary, rejected };
}

/** Append-only activity-log entries to write to the subcollection (never a blob). */
export function sanitizeActivityLogs(raw: any): IdItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && typeof l === 'object' && typeof l.id === 'string')
    .slice(0, 25);
}

// ===========================================================================
// PHASE 1 — dual-write of the monolithic-doc entity arrays to mirror
// subcollections. Reads are UNCHANGED in this phase: the array fields on
// `apps/{orgId}` stay authoritative and every reader still uses them. The
// subcollections are a write-only shadow copy so a later phase can flip reads.
//
// Sequencing (see docs/phase-1-dual-write-runbook.md for the full rationale):
//   1. the authoritative `apps/{orgId}` doc field is written FIRST, with the
//      existing optimistic-concurrency + retry (unchanged);
//   2. only AFTER that commit succeeds, each per-entity change is replayed onto
//      its mirror subcollection with idempotent `set(merge)` / `delete()`.
// So the mirror can only ever LAG the authoritative doc, never lead it. A lag is
// invisible (nothing reads the mirror yet) and self-heals: a failed mirror write
// throws the whole callable, the client autosave retries the identical
// changeset, `mergeOrgChanges` is then a semantic no-op for the doc field, and
// the "no doc-field changes" branch re-runs the mirror step until it lands.
// `scripts/migrate-to-subcollections.ts` + `verifyOrgConsistency` catch anything
// that stays diverged.
// ===========================================================================

/**
 * Array-of-`{id}` fields of `apps/{orgId}` that are mirrored one-doc-per-entity
 * to `apps/{orgId}/{field}/{entityId}`. `scheduleEntries` already worked this way
 * before Phase 1 and is included here so there is a single code path.
 * `periodSettings` is NOT here — it is order-significant and settings-shaped, so
 * it mirrors to ONE doc (see `mirrorPeriodSettingsDoc`). `users` is mirrored by
 * the identity callables (setUserRole / registerCurrentUser), not this path.
 */
export const MIRRORED_ENTITY_FIELDS = [
  'teachers',
  'subjects',
  'gradeLevels',
  'physicalRooms',
  'teacherSubjectAssignments',
  'scheduleEntries',
] as const;
export type MirroredEntityField = typeof MIRRORED_ENTITY_FIELDS[number];

/** Well-known id of the single doc that mirrors the ordered `periodSettings` array. */
export const PERIOD_SETTINGS_MIRROR_DOC_ID = 'current';

/** Chunked `Promise.all` to stay well under any per-op burst limits. */
async function runChunked(ops: Promise<any>[], size = 100): Promise<void> {
  for (let i = 0; i < ops.length; i += size) {
    await Promise.all(ops.slice(i, i + size));
  }
}

/**
 * Replay one field's change onto its mirror subcollection, AFTER the
 * authoritative doc write. `authoritative` is the post-write array for that field
 * (`updates[field]` when it changed, else the untouched server array) — the
 * mirror is asserted to match it, so re-running with the same `change` is
 * idempotent and self-healing. An upsert whose id is absent from `authoritative`
 * (rejected by `mergeOrgChanges` — subjectCode clash) is skipped; a delete whose
 * id is still present (rejected — assignment in use) is skipped.
 */
export async function applyEntityMirror(
  appDocRef: DocumentReference,
  field: string,
  change: FieldChange | undefined,
  authoritative: IdItem[],
): Promise<void> {
  if (!change) return;
  const coll = appDocRef.collection(field);
  const byId = new Map<string, IdItem>();
  for (const e of asArray(authoritative)) byId.set(e.id, e);

  const ops: Promise<any>[] = [];
  for (const item of change.upsert || []) {
    if (!item || typeof item.id !== 'string') continue;
    const landed = byId.get(item.id);
    if (landed) ops.push(coll.doc(item.id).set(landed, { merge: true }));
  }
  for (const id of change.deleteIds || []) {
    if (typeof id === 'string' && id && !byId.has(id)) ops.push(coll.doc(id).delete());
  }
  await runChunked(ops);
}

/**
 * Mirror the ordered `periodSettings` array to a single doc
 * `apps/{orgId}/periodSettings/current` as `{ items: [...] }`. One doc (not
 * one-per-item) because the array order is load-bearing — `scheduleEntry.period`
 * is an index into it.
 */
export async function mirrorPeriodSettingsDoc(
  appDocRef: DocumentReference,
  items: IdItem[],
): Promise<void> {
  await appDocRef
    .collection('periodSettings')
    .doc(PERIOD_SETTINGS_MIRROR_DOC_ID)
    .set({ items: asArray(items) }, { merge: false });
}

/**
 * Full rebuild of one entity mirror subcollection to match `entities` exactly:
 * delete every mirror doc whose id is not in `entities`, then upsert all of
 * `entities`. Used by the restore/replace path and the backfill script (NOT the
 * incremental save path). Idempotent.
 */
export async function rebuildEntityMirror(
  appDocRef: DocumentReference,
  field: string,
  entities: IdItem[],
): Promise<{ upserts: number; deletes: number }> {
  const coll = appDocRef.collection(field);
  const keep = new Set(asArray(entities).map((e) => e.id));
  const existing = await coll.listDocuments();
  const ops: Promise<any>[] = [];
  let deletes = 0;
  for (const d of existing) {
    if (!keep.has(d.id)) { ops.push(d.delete()); deletes++; }
  }
  let upserts = 0;
  for (const e of asArray(entities)) { ops.push(coll.doc(e.id).set(e, { merge: true })); upserts++; }
  await runChunked(ops);
  return { upserts, deletes };
}

/** Mirror a single user record to `apps/{orgId}/users/{uid}` (Phase 1 dual-write
 *  for the identity callables). Best-effort — callers log, never fail on it. */
export async function mirrorUserDoc(appDocRef: DocumentReference, user: IdItem): Promise<void> {
  if (!user || typeof user.id !== 'string') return;
  await appDocRef.collection('users').doc(user.id).set(user, { merge: true });
}

/** Remove a user's mirror doc. */
export async function deleteMirrorUserDoc(appDocRef: DocumentReference, userId: string): Promise<void> {
  if (typeof userId !== 'string' || !userId) return;
  await appDocRef.collection('users').doc(userId).delete();
}

/**
 * Replay a whole `OrgChanges` onto every mirror subcollection, given the
 * pre-write server snapshot and the `mergeOrgChanges` `updates`. Safe to call in
 * both the committed and the no-op branch of `applyOrgChanges`.
 */
async function syncAllEntityMirrors(
  appDocRef: DocumentReference,
  changes: OrgChanges,
  server: Record<string, any>,
  updates: Record<string, any>,
): Promise<void> {
  for (const field of MIRRORED_ENTITY_FIELDS) {
    const change = changes[field as keyof OrgChanges] as FieldChange | undefined;
    if (!change) continue;
    const authoritative: IdItem[] =
      Array.isArray(updates[field]) ? updates[field] : asArray(server[field]);
    await applyEntityMirror(appDocRef, field, change, authoritative);
  }
  if (changes.periodSettings) {
    const authoritative: IdItem[] =
      Array.isArray(updates.periodSettings) ? updates.periodSettings : asArray(server.periodSettings);
    await mirrorPeriodSettingsDoc(appDocRef, authoritative);
  }
}

async function writeActivityLogs(appDocRef: DocumentReference, logs: IdItem[]): Promise<void> {
  if (!logs.length) return;
  const coll = appDocRef.collection('activityLogs');
  await Promise.all(logs.slice(0, 25).map((l) => coll.doc(l.id).set(l, { merge: true })));
}

export type ApplyResult = {
  summary: MergeSummary;
  attempts: number;
  conflicts: number;
  rejected: RejectedChange[];
};

/**
 * Optimistic read → merge → conditional write, with bounded retry-on-conflict.
 * No transaction (they hang on the ENTERPRISE database).
 */
export async function applyOrgChanges(
  db: Firestore,
  appDocRef: DocumentReference,
  changes: OrgChanges,
  callerRole: CallerRole,
  opts: { maxAttempts?: number; log?: (msg: string) => void; activityLogs?: IdItem[] } = {},
): Promise<ApplyResult> {
  const maxAttempts = opts.maxAttempts ?? 6;
  const log = opts.log ?? (() => {});
  let conflicts = 0;
  let prevServer: Record<string, any> | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const snap = await appDocRef.get();
    if (!snap.exists) throw new OrgChangeError('not-found', `${appDocRef.path} does not exist.`);
    const server = snap.data() || {};

    if (prevServer) {
      const changedUnderUs: string[] = [];
      for (const f of ORG_ARRAY_FIELDS) {
        if (canon(prevServer[f]) !== canon(server[f])) changedUnderUs.push(f);
      }
      if (canon(prevServer.organizationSettings) !== canon(server.organizationSettings)) {
        changedUnderUs.push('organizationSettings');
      }
      log(
        `CONFLICT retry ${attempt - 1}: another writer changed [${changedUnderUs.join(', ') || 'nothing detectable'}] ` +
          `between updateTime ${prevServer.__ut ?? '?'} and ${snap.updateTime?.toMillis?.() ?? '?'}`,
      );
    }

    const { updates, summary, rejected } = mergeOrgChanges(server, changes, callerRole);
    if (rejected.length) log(`rejected ${rejected.length} change(s): ${JSON.stringify(rejected)}`);

    if (Object.keys(updates).length === 0) {
      await syncAllEntityMirrors(appDocRef, changes, server, updates);
      await writeActivityLogs(appDocRef, opts.activityLogs || []);
      log(`no doc-field changes; re-asserted mirror subcollections`);
      return { summary, attempts: attempt, conflicts, rejected };
    }

    try {
      await appDocRef.update(updates, { lastUpdateTime: snap.updateTime! });
      await syncAllEntityMirrors(appDocRef, changes, server, updates);
      await writeActivityLogs(appDocRef, opts.activityLogs || []);
      log(`committed on attempt ${attempt} after ${conflicts} conflict(s): ${JSON.stringify(summary)}`);
      return { summary, attempts: attempt, conflicts, rejected };
    } catch (err: any) {
      // 9 = FAILED_PRECONDITION, 10 = ABORTED — doc changed since our read.
      if ((err?.code === 9 || err?.code === 10) && attempt < maxAttempts) {
        conflicts++;
        prevServer = { ...server, __ut: snap.updateTime?.toMillis?.() };
        await new Promise((r) => setTimeout(r, 50 * attempt));
        continue;
      }
      throw err;
    }
  }

  throw new OrgChangeError(
    'aborted',
    'มีผู้ใช้อื่นแก้ไขข้อมูลพร้อมกันจำนวนมาก ระบบไม่ได้บันทึกการเปลี่ยนแปลงล่าสุด กรุณาลองอีกครั้ง (too many concurrent edits).',
  );
}

/**
 * Full-replace path for admin restore-from-backup. Replaces every managed content
 * field wholesale, but NEVER touches `users` / `authorizedAdmins` (so a bad backup
 * cannot lock everyone out). Precondition-guarded with a short retry.
 */
export async function applyOrgReplace(
  db: Firestore,
  appDocRef: DocumentReference,
  fullDoc: Record<string, any>,
  opts: { log?: (msg: string) => void } = {},
): Promise<{ attempts: number }> {
  const log = opts.log ?? (() => {});
  const managed: Record<string, any> = {};
  for (const f of ORG_ARRAY_FIELDS) {
    if (Array.isArray(fullDoc[f])) managed[f] = fullDoc[f];
  }
  if (fullDoc.organizationSettings && typeof fullDoc.organizationSettings === 'object') {
    managed.organizationSettings = fullDoc.organizationSettings;
  }
  if (typeof fullDoc.organizationId === 'string') managed.organizationId = fullDoc.organizationId;

  // subjectCode uniqueness across the incoming set.
  const seen = new Map<string, string>();
  for (const s of asArray(managed.subjects)) {
    const code = normCode(s.subjectCode);
    if (!code) continue;
    const owner = seen.get(code);
    if (owner && owner !== s.id) {
      throw new OrgChangeError('already-exists', `ไฟล์สำรองมีรหัสวิชาซ้ำ "${s.subjectCode}" (duplicate subjectCode in backup).`);
    }
    seen.set(code, s.id);
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const snap = await appDocRef.get();
    if (!snap.exists) throw new OrgChangeError('not-found', `${appDocRef.path} does not exist.`);
    try {
      await appDocRef.set(managed, { merge: true });
      // Phase 1: rebuild the mirror for each field the restore actually wrote to
      // the doc. A field absent from `managed` (not in the backup) leaves BOTH
      // the doc array and its mirror untouched — never wipe a mirror whose source
      // array we did not replace.
      for (const f of MIRRORED_ENTITY_FIELDS) {
        if (Array.isArray(managed[f])) await rebuildEntityMirror(appDocRef, f, asArray(managed[f]));
      }
      if (Array.isArray(managed.periodSettings)) {
        await mirrorPeriodSettingsDoc(appDocRef, asArray(managed.periodSettings));
      }
      log(
        `restore replace committed (attempt ${attempt}): ` +
          `${asArray(managed.scheduleEntries).length} schedule entries, mirrors rebuilt`,
      );
      return { attempts: attempt };
    } catch (err: any) {
      if ((err?.code === 9 || err?.code === 10) && attempt < 3) {
        log(`restore replace conflict, retry ${attempt}`);
        await new Promise((r) => setTimeout(r, 100 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new OrgChangeError('aborted', 'มีการแก้ไขข้อมูลระหว่างการกู้คืน กรุณาลองอีกครั้ง (concurrent edits during restore).');
}

/**
 * Generic optimistic single-document array update: read → build → conditional
 * write → bounded retry. Shared by `assistantUpdateEntity`'s update path.
 */
export async function optimisticDocUpdate<T>(
  appDocRef: DocumentReference,
  build: (snap: DocumentSnapshot) =>
    | { updates: Record<string, any>; after?: () => Promise<void>; result: T }
    | Promise<{ updates: Record<string, any>; after?: () => Promise<void>; result: T }>,
  opts: { maxAttempts?: number; label?: string; log?: (m: string) => void } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const log = opts.log ?? (() => {});
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const snap = await appDocRef.get();
    if (!snap.exists) throw new OrgChangeError('not-found', `${appDocRef.path} does not exist.`);
    const { updates, after, result } = await build(snap);
    if (Object.keys(updates).length === 0) {
      if (after) await after();
      return result;
    }
    try {
      await appDocRef.update(updates, { lastUpdateTime: snap.updateTime! });
      if (after) await after();
      return result;
    } catch (err: any) {
      if ((err?.code === 9 || err?.code === 10) && attempt < maxAttempts) {
        log(`${opts.label || 'optimisticDocUpdate'}: conflict on attempt ${attempt}, retrying`);
        await new Promise((r) => setTimeout(r, 40 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new OrgChangeError('aborted', 'Could not save due to concurrent edits — please try again.');
}

// ===========================================================================
// PHASE 1 — consistency verification. Reads the authoritative `apps/{orgId}`
// doc arrays and every mirror subcollection and reports any divergence. This is
// what lets a later phase trust the mirrors enough to flip reads onto them.
// ===========================================================================

export type FieldConsistency = {
  field: string;
  docCount: number;
  mirrorCount: number;
  missingInMirror: string[]; // id present in the doc array, absent from the mirror
  extraInMirror: string[]; // id present in the mirror, absent from the doc array
  contentMismatch: string[]; // id in both, but content differs (order-insensitive)
  ok: boolean;
};

export type OrgConsistencyReport = {
  orgId: string;
  checkedAt: string;
  ok: boolean;
  fields: FieldConsistency[];
};

/** Compare one entity field's doc array against its mirror docs. */
function compareEntityField(field: string, docArr: IdItem[], mirrorArr: IdItem[]): FieldConsistency {
  const docById = new Map<string, IdItem>();
  for (const e of asArray(docArr)) docById.set(e.id, e);
  const mirById = new Map<string, IdItem>();
  for (const e of asArray(mirrorArr)) mirById.set(e.id, e);

  const missingInMirror: string[] = [];
  const contentMismatch: string[] = [];
  for (const [id, e] of docById) {
    if (!mirById.has(id)) missingInMirror.push(id);
    else if (canon(e) !== canon(mirById.get(id))) contentMismatch.push(id);
  }
  const extraInMirror: string[] = [];
  for (const id of mirById.keys()) if (!docById.has(id)) extraInMirror.push(id);

  return {
    field,
    docCount: docById.size,
    mirrorCount: mirById.size,
    missingInMirror: missingInMirror.sort(),
    extraInMirror: extraInMirror.sort(),
    contentMismatch: contentMismatch.sort(),
    ok: !missingInMirror.length && !extraInMirror.length && !contentMismatch.length,
  };
}

/**
 * Verify every Phase 1 mirror subcollection against the authoritative
 * `apps/{orgId}` doc fields: same ids, same content, and (for periodSettings)
 * same order. Read-only. Safe to run any time.
 */
export async function verifyOrgConsistency(
  appDocRef: DocumentReference,
  opts: { includeUsers?: boolean } = {},
): Promise<OrgConsistencyReport> {
  const snap = await appDocRef.get();
  if (!snap.exists) throw new OrgChangeError('not-found', `${appDocRef.path} does not exist.`);
  const server = snap.data() || {};
  const fields: FieldConsistency[] = [];

  for (const field of MIRRORED_ENTITY_FIELDS) {
    const mirrorSnap = await appDocRef.collection(field).get();
    const mirrorArr = mirrorSnap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
    fields.push(compareEntityField(field, asArray(server[field]), mirrorArr));
  }

  // periodSettings — one doc holding the ordered array.
  {
    const psDoc = await appDocRef.collection('periodSettings').doc(PERIOD_SETTINGS_MIRROR_DOC_ID).get();
    const docArr = asArray(server.periodSettings);
    const mirrorItems = psDoc.exists ? asArray((psDoc.data() as any)?.items) : [];
    const base = compareEntityField('periodSettings', docArr, mirrorItems);
    // order matters for periodSettings: also flag a pure re-order as a mismatch
    const orderOk = canon(docArr.map((x) => x.id)) === canon(mirrorItems.map((x) => x.id));
    fields.push({ ...base, ok: base.ok && orderOk, contentMismatch: orderOk ? base.contentMismatch : [...new Set([...base.contentMismatch, '__order__'])] });
  }

  if (opts.includeUsers) {
    const mirrorSnap = await appDocRef.collection('users').get();
    const mirrorArr = mirrorSnap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
    fields.push(compareEntityField('users', asArray(server.users), mirrorArr));
  }

  return {
    orgId: appDocRef.id,
    checkedAt: new Date().toISOString(),
    ok: fields.every((f) => f.ok),
    fields,
  };
}

/** Map an OrgChangeError code to a Firebase callable error code. */
export function mapOrgErrorCode(code: string): string {
  switch (code) {
    case 'already-exists':
      return 'already-exists';
    case 'permission-denied':
      return 'permission-denied';
    case 'not-found':
      return 'not-found';
    case 'aborted':
      return 'aborted';
    case '409_CONFLICT_ASSIGNMENT_IN_USE':
      return 'failed-precondition';
    default:
      return 'internal';
  }
}

export { FieldValue };
