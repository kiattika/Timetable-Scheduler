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

/**
 * PURE. Given the fresh server document, the client's changes and the caller's
 * role, return the field updates to write plus a summary. Throws OrgChangeError
 * on a violation (uniqueness, permission, assignment-in-use).
 */
export function mergeOrgChanges(
  serverDoc: Record<string, any>,
  changes: OrgChanges,
  callerRole: CallerRole,
): { updates: Record<string, any>; summary: MergeSummary } {
  const updates: Record<string, any> = {};
  const summary: MergeSummary = {};

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

    // teacherSubjectAssignments: block deleting one that is still on the timetable.
    if (field === 'teacherSubjectAssignments' && deleteIds.size > 0) {
      const schedule = asArray(serverDoc.scheduleEntries);
      for (const id of deleteIds) {
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
          throw new OrgChangeError(
            '409_CONFLICT_ASSIGNMENT_IN_USE',
            `ไม่สามารถลบลิงค์มอบหมายงานได้ รายวิชานี้ถูกจัดวางบนตารางเรียนแล้ว (assignment ${id} is still placed on the timetable).`,
          );
        }
      }
    }

    for (const id of deleteIds) byId.delete(id);

    let upserts = 0;
    for (const item of upsertList) {
      if (!item || typeof item.id !== 'string' || deleteIds.has(item.id)) continue;
      const existing = byId.get(item.id);
      byId.set(item.id, existing ? { ...existing, ...item } : item);
      upserts++;
    }

    // subjectCode uniqueness — only for subjects touched in THIS request, so a
    // pre-existing duplicate in untouched data does not block every save.
    if (field === 'subjects') {
      const merged = Array.from(byId.values());
      const changedIds = new Set(upsertList.map((s) => s?.id).filter((x): x is string => typeof x === 'string'));
      for (const s of merged) {
        if (!changedIds.has(s.id)) continue;
        const code = normCode(s.subjectCode);
        if (!code) continue;
        const clash = merged.find((o) => o.id !== s.id && normCode(o.subjectCode) === code);
        if (clash) {
          throw new OrgChangeError(
            'already-exists',
            `รหัสวิชา "${s.subjectCode}" ถูกใช้โดยวิชา "${clash.name || clash.id}" อยู่แล้ว (subjectCode must be unique).`,
          );
        }
      }
    }

    updates[field] = Array.from(byId.values());
    summary[field] = { upserts, deletes: deleteIds.size, length: updates[field].length };
  }

  return { updates, summary };
}

/** Append-only activity-log entries to write to the subcollection (never a blob). */
export function sanitizeActivityLogs(raw: any): IdItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && typeof l === 'object' && typeof l.id === 'string')
    .slice(0, 25);
}

async function syncScheduleSubcollection(
  appDocRef: DocumentReference,
  change: FieldChange | undefined,
): Promise<void> {
  if (!change) return;
  const coll = appDocRef.collection('scheduleEntries');
  const ops: Promise<any>[] = [];
  for (const e of change.upsert || []) {
    if (e && typeof e.id === 'string') ops.push(coll.doc(e.id).set(e, { merge: true }));
  }
  for (const id of change.deleteIds || []) {
    if (typeof id === 'string' && id) ops.push(coll.doc(id).delete());
  }
  // Chunk to stay well under any per-op burst limits.
  for (let i = 0; i < ops.length; i += 100) {
    await Promise.all(ops.slice(i, i + 100));
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
        if (JSON.stringify(prevServer[f]) !== JSON.stringify(server[f])) changedUnderUs.push(f);
      }
      if (JSON.stringify(prevServer.organizationSettings) !== JSON.stringify(server.organizationSettings)) {
        changedUnderUs.push('organizationSettings');
      }
      log(
        `CONFLICT retry ${attempt - 1}: another writer changed [${changedUnderUs.join(', ') || 'nothing detectable'}] ` +
          `between updateTime ${prevServer.__ut ?? '?'} and ${snap.updateTime?.toMillis?.() ?? '?'}`,
      );
    }

    const { updates, summary } = mergeOrgChanges(server, changes, callerRole);

    if (Object.keys(updates).length === 0) {
      await syncScheduleSubcollection(appDocRef, changes.scheduleEntries);
      await writeActivityLogs(appDocRef, opts.activityLogs || []);
      log(`no doc-field changes; synced ${(changes.scheduleEntries?.upsert?.length || 0)} schedule upserts`);
      return { summary, attempts: attempt, conflicts };
    }

    try {
      await appDocRef.update(updates, { lastUpdateTime: snap.updateTime! });
      await syncScheduleSubcollection(appDocRef, changes.scheduleEntries);
      await writeActivityLogs(appDocRef, opts.activityLogs || []);
      log(`committed on attempt ${attempt} after ${conflicts} conflict(s): ${JSON.stringify(summary)}`);
      return { summary, attempts: attempt, conflicts };
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
      // Rebuild the scheduleEntries subcollection to match.
      const coll = appDocRef.collection('scheduleEntries');
      const existing = await coll.listDocuments();
      const keep = new Set(asArray(managed.scheduleEntries).map((e) => e.id));
      const ops: Promise<any>[] = [];
      for (const d of existing) if (!keep.has(d.id)) ops.push(d.delete());
      for (const e of asArray(managed.scheduleEntries)) ops.push(coll.doc(e.id).set(e, { merge: true }));
      for (let i = 0; i < ops.length; i += 100) await Promise.all(ops.slice(i, i + 100));
      log(`restore replace committed (attempt ${attempt}): ${asArray(managed.scheduleEntries).length} schedule entries`);
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
