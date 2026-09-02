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

export const stableKey = (x: any): string => {
  try { return JSON.stringify(x); } catch { return String(x); }
};

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
    if (!prev || stableKey(prev) !== stableKey(item)) upsert.push(item);
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
    if (stableKey(bs[k]) !== stableKey(cs[k])) set[k] = cs[k];
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
