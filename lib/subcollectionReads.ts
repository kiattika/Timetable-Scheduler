/**
 * Phase 2 (read flip) helpers — pure, no imports, unit-testable in plain Node.
 *
 * When VITE_READ_FROM_SUBCOLLECTIONS=true the client builds the entity arrays from
 * the Phase-1 mirror subcollections instead of the arrays inside `apps/{orgId}`.
 * Writes are unchanged (commitOrgChanges still writes the doc first, then mirrors).
 */

/** Entity fields read from one-doc-per-entity subcollections. Keep in sync with
 *  MIRRORED_ENTITY_FIELDS in functions/src/orgWrites.ts minus `scheduleEntries`
 *  (already read from its subcollection before Phase 2) — a test enforces this. */
export const READ_FLIP_ENTITY_FIELDS = [
  'teachers',
  'subjects',
  'gradeLevels',
  'physicalRooms',
  'teacherSubjectAssignments',
] as const;
export type ReadFlipEntityField = typeof READ_FLIP_ENTITY_FIELDS[number];

/** Well-known id of the single doc mirroring the ordered periodSettings array
 *  (PERIOD_SETTINGS_MIRROR_DOC_ID in functions/src/orgWrites.ts). */
export const PERIOD_SETTINGS_DOC_ID = 'current';

const isItem = (x: any): x is { id: string } => !!x && typeof x === 'object' && typeof x.id === 'string';

const asItems = (v: any): { id: string }[] => (Array.isArray(v) ? v.filter(isItem) : []);

export interface ResolveReport {
  source: 'mirror' | 'doc';
  /** ids only in the mirror / only in the doc array — non-empty means they diverge. */
  onlyInMirror: string[];
  onlyInDoc: string[];
}

/**
 * Pick the entity list for one field.
 *  - mirror === null  (listener has not reported / failed)  -> use the doc array
 *  - mirror is empty but the doc array is not (never backfilled / lagging) -> doc array
 *  - otherwise the mirror is the source of truth for content AND membership;
 *    the doc array is used only as an ORDER hint (subcollections have no order),
 *    items unknown to the doc follow, sorted by id for determinism.
 */
export function resolveEntityList<T extends { id: string }>(
  mirror: T[] | null,
  docArray: any,
): { items: T[]; report: ResolveReport } {
  const doc = asItems(docArray) as T[];
  const mir = mirror ? (asItems(mirror) as T[]) : null;

  if (!mir || (mir.length === 0 && doc.length > 0)) {
    return { items: doc, report: { source: 'doc', onlyInMirror: [], onlyInDoc: [] } };
  }

  const byId = new Map(mir.map((m) => [m.id, m] as const));
  const docIds = new Set(doc.map((d) => d.id));

  const ordered: T[] = [];
  for (const d of doc) {
    const m = byId.get(d.id);
    if (m) ordered.push(m);
  }
  const extras = mir.filter((m) => !docIds.has(m.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ordered.push(...extras);

  return {
    items: ordered,
    report: {
      source: 'mirror',
      onlyInMirror: extras.map((e) => e.id),
      onlyInDoc: doc.filter((d) => !byId.has(d.id)).map((d) => d.id),
    },
  };
}

/** periodSettings mirrors to one doc `{ items: [...] }` (order-significant). */
export function resolvePeriodSettings<T extends { id: string }>(
  mirrorDocData: any | null,
  docArray: any,
): { items: T[]; source: 'mirror' | 'doc' } {
  const fromMirror = mirrorDocData ? (asItems(mirrorDocData.items) as T[]) : [];
  if (fromMirror.length > 0) return { items: fromMirror, source: 'mirror' };
  return { items: asItems(docArray) as T[], source: 'doc' };
}


/* ------------------------------------------------------------------ *
 * Runtime switch (button in System Health) — who decides the read source
 * ------------------------------------------------------------------ */

export type ReadSourceOrigin = 'local' | 'global' | 'build' | 'default';

/**
 * Precedence: this browser's override  >  system-wide setting (organizationSettings)  >  build env  >  off.
 * The local override can be forced OFF so an admin can always get out if the global switch is on and misbehaving.
 */
export function resolveReadFlip(input: {
  local: 'on' | 'off' | null;
  global: boolean | undefined | null;
  build: boolean;
}): { enabled: boolean; origin: ReadSourceOrigin } {
  if (input.local === 'on') return { enabled: true, origin: 'local' };
  if (input.local === 'off') return { enabled: false, origin: 'local' };
  if (typeof input.global === 'boolean') return { enabled: input.global, origin: 'global' };
  if (input.build) return { enabled: true, origin: 'build' };
  return { enabled: false, origin: 'default' };
}

export const READ_FLIP_LOCAL_KEY = 'tt.readFromSubcollections';

export function readLocalReadFlip(): 'on' | 'off' | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(READ_FLIP_LOCAL_KEY) : null;
    return v === 'on' || v === 'off' ? v : null;
  } catch { return null; }
}

export function writeLocalReadFlip(v: 'on' | 'off' | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (v) localStorage.setItem(READ_FLIP_LOCAL_KEY, v); else localStorage.removeItem(READ_FLIP_LOCAL_KEY);
  } catch { /* storage unavailable — switch simply has no local effect */ }
}

// What THIS page load is actually using (decided once, at the first main-doc snapshot).
let activeReadFlip: { enabled: boolean; origin: ReadSourceOrigin } | null = null;
export const setActiveReadFlip = (v: { enabled: boolean; origin: ReadSourceOrigin }) => { activeReadFlip = v; };
export const getActiveReadFlip = () => activeReadFlip;

/* ------------------------------------------------------------------ *
 * Consistency check (same rules as verifyOrgConsistency in functions)
 * ------------------------------------------------------------------ */

export const canon = (x: any): string => {
  if (x === undefined || x === null) return 'null';
  if (typeof x !== 'object') { try { return JSON.stringify(x); } catch { return String(x); } }
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  return '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
};

export interface FieldCheck {
  field: string;
  docCount: number;
  mirrorCount: number;
  missingInMirror: string[];
  extraInMirror: string[];
  contentMismatch: string[];
  ok: boolean;
}

export function compareField(field: string, docArr: any, mirrorArr: any): FieldCheck {
  const d = new Map(asItems(docArr).map((e) => [e.id, e] as const));
  const m = new Map(asItems(mirrorArr).map((e) => [e.id, e] as const));
  const missingInMirror: string[] = [];
  const contentMismatch: string[] = [];
  for (const [id, e] of d) {
    if (!m.has(id)) missingInMirror.push(id);
    else if (canon(e) !== canon(m.get(id))) contentMismatch.push(id);
  }
  const extraInMirror = [...m.keys()].filter((id) => !d.has(id));
  return {
    field,
    docCount: d.size,
    mirrorCount: m.size,
    missingInMirror: missingInMirror.sort(),
    extraInMirror: extraInMirror.sort(),
    contentMismatch: contentMismatch.sort(),
    ok: !missingInMirror.length && !extraInMirror.length && !contentMismatch.length,
  };
}

/** periodSettings is order-significant: a pure re-order counts as a mismatch. */
export function comparePeriodSettings(docArr: any, mirrorItems: any): FieldCheck {
  const base = compareField('periodSettings', docArr, mirrorItems);
  const orderOk = canon(asItems(docArr).map((x) => x.id)) === canon(asItems(mirrorItems).map((x) => x.id));
  return orderOk ? base : { ...base, ok: false, contentMismatch: [...new Set([...base.contentMismatch, '__order__'])] };
}
