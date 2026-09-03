/**
 * Pure client-side helpers for the concurrency-safe admin/manager save path.
 * No Firebase imports — unit-testable in a plain Node/vitest environment.
 *
 * The client diffs its current in-memory appData against the last-synced baseline
 * and sends ONLY its own change-set to the `commitOrgChanges` Cloud Function,
 * which merges it onto a fresh server read. This replaces the old blind
 * full-document overwrite that caused silent data loss under concurrent edits.
 */

/**
 * Top-level array-of-object fields of apps/{orgId} the admin/manager save path
 * may write. MUST stay in sync with ORG_ARRAY_FIELDS in functions/src/orgWrites.ts.
 * NOT included: users / authorizedAdmins (owned by setUserRole / registerCurrentUser),
 * activityLogs (append-only, sent separately), currentUser (client-only).
 */
export const ORG_ARRAY_FIELDS = [
  'teachers', 'subjects', 'gradeLevels', 'physicalRooms', 'departments',
  'resourceTypes', 'teacherSubjectAssignments', 'periodSettings', 'scheduleEntries',
] as const;

/**
 * Order-INSENSITIVE canonical serialization for change-detection.
 *
 * `JSON.stringify` is sensitive to object key insertion order. Entities that
 * round-trip through two Firestore deserialisations (e.g. the diff baseline came
 * from an earlier snapshot than `appData`) or through divergent client-side
 * normalisation can be semantically identical yet stringify differently — which
 * made the diff flag EVERY entity as "changed" on every save, firing dozens of
 * spurious update calls (and burning read/write quota).
 *
 * This sorts OBJECT keys recursively but preserves ARRAY order (array order is
 * semantic — e.g. `teacherIds`, `operatingDays`). `undefined`-valued keys are
 * dropped, matching JSON semantics. Output is valid JSON.
 */
export const canonicalKey = (x: any): string => {
  if (x === undefined || x === null) return 'null';
  if (typeof x !== 'object') {
    try { return JSON.stringify(x); } catch { return String(x); }
  }
  if (Array.isArray(x)) return '[' + x.map(canonicalKey).join(',') + ']';
  const keys = Object.keys(x).filter((k) => x[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalKey(x[k])).join(',') + '}';
};

/** @deprecated use canonicalKey — kept for any external importer. */
export const stableKey = canonicalKey;

/** Semantic (order-insensitive) equality of two values. */
export const sameEntity = (a: any, b: any): boolean => canonicalKey(a) === canonicalKey(b);

/** Recursively convert `undefined`/`null` to `null` (Firestore rejects undefined). */
export const cleanUndefined = (obj: any): any => {
  if (obj === undefined || obj === null) return null;
  if (Array.isArray(obj)) return obj.map(cleanUndefined);
  if (typeof obj === 'object') {
    const out: any = {};
    for (const k of Object.keys(obj)) {
      if (obj[k] !== undefined) out[k] = cleanUndefined(obj[k]);
    }
    return out;
  }
  return obj;
};

/** Diff two id-keyed arrays into { upsert, deleteIds }. */
export const diffById = <T extends { id?: string }>(
  baseline: T[] = [],
  current: T[] = [],
): { upsert: T[]; deleteIds: string[] } => {
  const b = new Map<string, T>();
  for (const x of baseline || []) if (x && typeof x.id === 'string') b.set(x.id, x);
  const c = new Map<string, T>();
  for (const x of current || []) if (x && typeof x.id === 'string') c.set(x.id, x);

  const upsert: T[] = [];
  for (const [id, item] of c) {
    const prev = b.get(id);
    if (!prev || !sameEntity(prev, item)) upsert.push(item);
  }
  const deleteIds: string[] = [];
  for (const id of b.keys()) if (!c.has(id)) deleteIds.push(id);
  return { upsert, deleteIds };
};

export type OrgChangeset = {
  changes: Record<string, any>;
  newActivityLogs: any[];
  hasChanges: boolean;
};

/**
 * Compute the change-set THIS client actually made, by diffing `current` against
 * the last-synced `baseline`. When `baseline` is null (unknown) NO deletes are
 * emitted — we never delete without proof of intent.
 */
export const computeOrgChanges = (
  baseline: Record<string, any> | null,
  current: Record<string, any>,
): OrgChangeset => {
  const changes: Record<string, any> = {};
  let hasChanges = false;

  for (const field of ORG_ARRAY_FIELDS) {
    const b: any[] = Array.isArray(baseline?.[field]) ? baseline![field] : [];
    const c: any[] = Array.isArray(current?.[field]) ? current[field] : [];
    const d = diffById(b, c);
    const deleteIds = baseline ? d.deleteIds : [];
    if (d.upsert.length || deleteIds.length) {
      changes[field] = { upsert: d.upsert, deleteIds };
      hasChanges = true;
    }
  }

  // organizationSettings: shallow key-level diff.
  const bs = (baseline?.organizationSettings || {}) as Record<string, any>;
  const cs = (current.organizationSettings || {}) as Record<string, any>;
  const set: Record<string, any> = {};
  for (const k of Object.keys(cs)) {
    if (!sameEntity(bs[k], cs[k])) set[k] = cs[k];
  }
  if (Object.keys(set).length) {
    changes.organizationSettings = { set };
    hasChanges = true;
  }

  // New activity-log entries only (append-only; never a blob).
  const baseLogIds = new Set((baseline?.activityLogs || []).map((l: any) => l?.id).filter(Boolean));
  const newActivityLogs = (current.activityLogs || [])
    .filter((l: any) => l && l.id && !baseLogIds.has(l.id))
    .slice(0, 25)
    .map(cleanUndefined);

  return { changes, newActivityLogs, hasChanges: hasChanges || newActivityLogs.length > 0 };
};

// ---------------------------------------------------------------------------
// Assistant write path — same order-insensitive comparison as the admin path.
// (Both paths MUST use the same equality check; a divergence here is a bug.)
// ---------------------------------------------------------------------------

export type AssistantEntityOp = { op: 'create' | 'update' | 'delete'; id: string; entity: any };

/**
 * Diff one department-scoped entity array (teachers / subjects /
 * teacherSubjectAssignments / scheduleEntries) between the last-synced baseline
 * and the current state, into per-entity create/update/delete ops.
 *
 * Deletes have defensive guards: if the whole array vanished, or the delete
 * count is an implausible fraction of the baseline, deletes are skipped as a
 * likely transient/partial-load state rather than an intentional removal.
 */
/**
 * @param knownFailed  optional `${keyPrefix}:${id}` -> canonicalKey(entity) map of
 *   operations that already failed PERMANENTLY (permission-denied, duplicate code,
 *   …). An op is suppressed while the entity's content still hashes to the same
 *   value — so a doomed write is attempted once, not on every autosave cycle.
 * @param keyPrefix    entity-type prefix for the knownFailed keys.
 */
export const diffAssistantEntities = (
  before: any[] = [],
  after: any[] = [],
  knownFailed?: Map<string, string>,
  keyPrefix = '',
): { ops: AssistantEntityOp[]; skippedDeletes: string[]; suppressed: number } => {
  const beforeById = new Map<string, any>();
  for (const e of before || []) if (e && typeof e.id === 'string') beforeById.set(e.id, e);
  const afterById = new Map<string, any>();
  for (const e of after || []) if (e && typeof e.id === 'string') afterById.set(e.id, e);

  const rawOps: AssistantEntityOp[] = [];

  for (const [id, entity] of afterById) {
    const prior = beforeById.get(id);
    if (!prior) rawOps.push({ op: 'create', id, entity });
    else if (!sameEntity(prior, entity)) rawOps.push({ op: 'update', id, entity });
  }

  const removedIds: string[] = [];
  for (const id of beforeById.keys()) if (!afterById.has(id)) removedIds.push(id);

  let skippedDeletes: string[] = [];
  if (removedIds.length > 0) {
    const wholeArrayVanished = (after?.length ?? 0) === 0 && (before?.length ?? 0) > 0;
    const implausibleMassDelete = removedIds.length > Math.max(3, Math.floor((before?.length ?? 0) * 0.34));
    if (wholeArrayVanished || implausibleMassDelete) {
      skippedDeletes = removedIds;
    } else {
      for (const id of removedIds) rawOps.push({ op: 'delete', id, entity: { id } });
    }
  }

  let suppressed = 0;
  const ops = rawOps.filter((o) => {
    if (!knownFailed) return true;
    const fk = `${keyPrefix}:${o.id}`;
    if (knownFailed.get(fk) === canonicalKey({ op: o.op, entity: o.entity })) {
      suppressed++;
      return false;
    }
    return true;
  });

  return { ops, skippedDeletes, suppressed };
};

/** Stable hash of an op for the knownFailed map. */
export const failureKey = (op: string, entity: any): string => canonicalKey({ op, entity });

/**
 * Classify a save error. PERMANENT = the same write will keep failing until the
 * user changes the data (don't auto-retry it every autosave cycle); RETRYABLE =
 * transient (network, quota, another user's concurrent edit) — retry next cycle.
 */
export type SaveErrorClass = 'permanent' | 'retryable';
export const classifySaveError = (err: any): SaveErrorClass => {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  const PERMANENT = [
    'functions/permission-denied', 'permission-denied',
    'functions/already-exists', 'already-exists',
    'functions/failed-precondition', 'failed-precondition',
    'functions/invalid-argument', 'invalid-argument',
    'functions/not-found', 'not-found',
  ];
  if (PERMANENT.includes(code)) return 'permanent';
  if (/409_CONFLICT_ASSIGNMENT_IN_USE|subjectCode|รหัสวิชา|department outside your assignment|No departments assigned|Organization mismatch|Requires (manager|assistant)/i.test(msg)) {
    return 'permanent';
  }
  // aborted (too many concurrent edits), resource-exhausted, deadline-exceeded,
  // internal, network — all worth another try on the next cycle.
  return 'retryable';
};

/** Short human-readable reason for a save failure (for a toast). */
export const describeSaveError = (label: string, err: any): string => {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  if (/subjectCode|รหัสวิชา/i.test(msg)) return `บันทึก "${label}" ไม่ได้: รหัสวิชาซ้ำกับที่มีอยู่แล้ว`;
  if (/409_CONFLICT_ASSIGNMENT_IN_USE/i.test(msg)) return `ลบ "${label}" ไม่ได้: รายการนี้ถูกใช้อยู่ในตารางสอนแล้ว`;
  if (/department outside your assignment|No departments assigned/i.test(msg)) return `บันทึก "${label}" ไม่ได้: อยู่นอกกลุ่มสาระฯ ที่คุณรับผิดชอบ`;
  if (code.includes('permission-denied') || /permission/i.test(msg)) return `บันทึก "${label}" ไม่ได้: คุณไม่มีสิทธิ์แก้ไขส่วนนี้`;
  if (/lock or unlock|ล็อก\/ปลดล็อก/i.test(msg)) return `เฉพาะแอดมินเท่านั้นที่ล็อก/ปลดล็อกตารางเรียนได้`;
  return `บันทึก "${label}" ไม่สำเร็จ: ${msg.slice(0, 120)}`;
};

// ---------------------------------------------------------------------------
// Reconcile a fresh server snapshot with THIS client's not-yet-persisted edits.
// ---------------------------------------------------------------------------

/**
 * Merge one id-keyed array: start from the authoritative server array, then
 * re-apply the local client's changes that are not yet on the server (adds and
 * edits), and honour the local client's not-yet-synced deletes.
 *
 * 3-way against `baseline` (the last state this client knows is persisted):
 *  - id in local, not in baseline, not in server  -> local ADD not synced   -> keep
 *  - id in baseline & local, local != baseline, still on server -> local EDIT -> keep local
 *  - id in baseline, not in local, still on server -> local DELETE not synced -> remove
 *  - everything else -> server wins (incl. other users' concurrent changes)
 */
const reconcileArray = (server: any[], local: any[], baseline: any[]): any[] => {
  const s = new Map<string, any>();
  for (const e of server || []) if (e && typeof e.id === 'string') s.set(e.id, e);
  const b = new Map<string, any>();
  for (const e of baseline || []) if (e && typeof e.id === 'string') b.set(e.id, e);
  const l = new Map<string, any>();
  for (const e of local || []) if (e && typeof e.id === 'string') l.set(e.id, e);

  const result: any[] = [...(server || [])];
  const idxOf = (id: string) => result.findIndex((e) => e && e.id === id);

  for (const [id, ent] of l) {
    if (!b.has(id) && !s.has(id)) {
      result.push(ent); // local add, not yet synced
    } else if (b.has(id) && s.has(id) && !sameEntity(b.get(id), ent)) {
      const i = idxOf(id);
      if (i >= 0) result[i] = ent; // local edit in progress
    }
  }
  for (const [id] of b) {
    if (!l.has(id) && s.has(id)) {
      const i = idxOf(id);
      if (i >= 0) result.splice(i, 1); // local delete, not yet synced
    }
  }
  return result;
};

const reconcileSettings = (server: any, local: any, baseline: any): any => {
  if (!local || typeof local !== 'object') return server ?? null;
  const bs = (baseline && typeof baseline === 'object') ? baseline : {};
  const out: Record<string, any> = { ...(server && typeof server === 'object' ? server : {}) };
  for (const k of Object.keys(local)) {
    if (!sameEntity(bs[k], local[k])) out[k] = local[k]; // local's un-synced key change
  }
  return out;
};

/**
 * Given the freshly-rebuilt server view (`server`), the current in-memory state
 * (`local`) and the last-persisted baseline (`baseline`), return a view that
 * keeps this client's not-yet-saved work instead of discarding it.
 *
 * Fixes the silent-data-loss race: a Firestore snapshot arriving during the
 * autosave debounce used to replace `appData` wholesale, dropping an entity the
 * user had just added locally before it was persisted.
 */
export const reconcileServerWithLocal = <T extends Record<string, any>>(
  server: T,
  local: T | null | undefined,
  baseline: Record<string, any> | null | undefined,
): T => {
  // No baseline -> we have no proof of what is "local unsaved" vs "server truth".
  if (!local || !baseline) return server;

  const out: Record<string, any> = { ...server };
  for (const field of ORG_ARRAY_FIELDS) {
    out[field] = reconcileArray(
      Array.isArray(server[field]) ? server[field] : [],
      Array.isArray(local[field]) ? local[field] : [],
      Array.isArray(baseline[field]) ? baseline[field] : [],
    );
  }
  out.organizationSettings = reconcileSettings(
    server.organizationSettings,
    local.organizationSettings,
    baseline.organizationSettings,
  );
  return out as T;
};
