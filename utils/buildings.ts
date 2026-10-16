/**
 * Building / room-location helpers (pure, unit-tested).
 *
 * Room code convention of the school: 931 = building 9, floor 3, room 1.
 * Building numbers follow construction order, NOT position, so the campus layout
 * is entered by hand as a grid (rows x columns) of building numbers.
 */
import type { PhysicalRoom } from '../types';

export type BuildingGrid = string[][];
export interface GridPos { row: number; col: number }

/** "อาคาร 9", " 9 " -> "9". Empty -> ''. */
export function normalizeBuildingId(raw: unknown): string {
  return String(raw ?? '').replace(/อาคาร/g, '').replace(/\s+/g, '').trim().toUpperCase();
}

/**
 * 931 -> { building:'9', floor:3, room:'1' }.
 * Only exact 3-digit numeric codes are decoded. 4-digit codes (e.g. 1031: building 10?) are
 * ambiguous and letter codes (F001) carry no building, so they return null and must be filled in by hand.
 */
export function parseRoomCode(code: unknown): { building: string; floor: number; room: string } | null {
  const c = String(code ?? '').trim().toUpperCase();
  if (/^\d{3}$/.test(c)) return { building: c[0], floor: Number(c[1]), room: c[2] };
  // F001 = สนาม (Field) หมายเลข 1 -> โซน "F1" (ต้องวาง F1 ลงในผังอาคาร)
  const f = c.match(/^F0*(\d+)$/);
  if (f && Number(f[1]) > 0) return { building: `F${Number(f[1])}`, floor: 1, room: c };
  // P900 = ลานกิจกรรมหน้าอาคาร 9 ลำดับที่ 00 -> โซน "P9" (ถ้าไม่มี P9 ในผัง ใช้ P แล้วค่อยใช้อาคาร 9)
  const p = c.match(/^P([1-9])(\d{2})$/);
  if (p) return { building: `P${p[1]}`, floor: 1, room: p[2] };
  return null;
}

/** Explicit field first, otherwise decoded from the code. */
export function roomBuilding(room: Pick<PhysicalRoom, 'code'> & { building?: string }): string | null {
  const explicit = normalizeBuildingId(room.building);
  if (explicit) return explicit;
  return parseRoomCode(room.code)?.building ?? null;
}

export function roomFloor(room: Pick<PhysicalRoom, 'code'> & { floor?: number | string }): number | null {
  const f = room.floor;
  if (f !== undefined && f !== null && String(f).trim() !== '' && Number.isFinite(Number(f))) return Number(f);
  return parseRoomCode(room.code)?.floor ?? null;
}

/* ---------------- grid (storage + parsing) ---------------- */

/** Firestore cannot store an array of arrays, so the grid is persisted as [{cells:[...]}]. */
export type StoredGrid = { cells: string[] }[];

export function gridToStored(grid: BuildingGrid): StoredGrid {
  return grid.map((row) => ({ cells: row.map((c) => normalizeBuildingId(c)) }));
}

/** Accepts the stored shape (or a plain string[][]) and returns a clean rectangular grid. */
export function gridFromStored(stored: unknown): BuildingGrid {
  if (!Array.isArray(stored)) return [];
  const rows: string[][] = stored.map((r: any) => {
    const cells = Array.isArray(r) ? r : Array.isArray(r?.cells) ? r.cells : [];
    return cells.map((c: any) => normalizeBuildingId(c));
  });
  return squareGrid(rows);
}

/** Pad every row to the widest one; drop fully empty trailing rows / columns. */
export function squareGrid(rows: string[][]): BuildingGrid {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const padded = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
  while (padded.length && padded[padded.length - 1].every((c) => c === '')) padded.pop();
  let lastCol = -1;
  for (const r of padded) r.forEach((c, i) => { if (c !== '' && i > lastCol) lastCol = i; });
  return padded.map((r) => r.slice(0, lastCol + 1));
}

/**
 * Parse text pasted from Excel / Google Sheets (tab separated) or typed as CSV (comma separated).
 * Empty cells are kept so positions are preserved.
 */
export function parseGridText(text: string): BuildingGrid {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const sep = text.includes('\t') ? '\t' : ',';
  const rows = lines.map((l) => l.split(sep).map((c) => normalizeBuildingId(c)));
  return squareGrid(rows);
}

export function gridToText(grid: BuildingGrid): string {
  return grid.map((r) => r.join(',')).join('\n');
}

/* ---------------- positions & distance ---------------- */

export interface GridCheck {
  /** every cell of each building/zone (a field can span several cells) */
  positions: Map<string, GridPos[]>;
  /** NUMERIC building ids placed in more than one cell (zones with letters, e.g. F1, may span cells) */
  duplicates: string[];
}

export function buildingPositions(grid: BuildingGrid): GridCheck {
  const positions = new Map<string, GridPos[]>();
  const dup = new Set<string>();
  grid.forEach((row, r) => row.forEach((cell, c) => {
    const id = normalizeBuildingId(cell);
    if (!id) return;
    const list = positions.get(id) ?? [];
    if (list.length && /^\d+$/.test(id)) dup.add(id);
    list.push({ row: r, col: c });
    positions.set(id, list);
  }));
  return { positions, duplicates: [...dup].sort() };
}

/** Straight-line distance in grid cells (1 = next-door cell). null when either building is not on the grid. */
/**
 * Find where a building/zone sits on the grid. F3 -> F3, else the plain letter "F" (one block for all fields);
 * P9 -> P9, else "P", else building 9 (the playground in front of it).
 */
export function resolveBuildingKey(id: string, positions: Map<string, GridPos[]>): string | null {
  const x = normalizeBuildingId(id);
  const cands = [x];
  const m = x.match(/^([A-Z])(\d+)$/);
  if (m) { cands.push(m[1]); if (m[1] === 'P' && m[2].length === 1) cands.push(m[2]); }
  return cands.find((k) => positions.has(k)) ?? null;
}

export function buildingDistance(a: string, b: string, positions: Map<string, GridPos[]>): number | null {
  const ka = resolveBuildingKey(a, positions);
  const kb = resolveBuildingKey(b, positions);
  const pa = ka ? positions.get(ka) : undefined;
  const pb = kb ? positions.get(kb) : undefined;
  if (!pa?.length || !pb?.length) return null;
  // zones that span several cells: use the closest pair of cells
  let best = Infinity;
  for (const x of pa) for (const y of pb) best = Math.min(best, Math.hypot(x.row - y.row, x.col - y.col));
  return +best.toFixed(2);
}

/* ---------------- preparation checklist ---------------- */

export interface RoomLocationSuggestion { id: string; code: string; building: string; floor: number }

/** Rooms with no explicit building whose 3-digit code can be decoded. */
export function suggestRoomLocations(rooms: (PhysicalRoom & { building?: string; floor?: number })[]): RoomLocationSuggestion[] {
  const out: RoomLocationSuggestion[] = [];
  for (const r of rooms) {
    if (normalizeBuildingId(r.building)) continue;
    const p = parseRoomCode(r.code);
    if (p) out.push({ id: r.id, code: r.code, building: p.building, floor: p.floor });
  }
  return out;
}

export interface LocationCoverage {
  total: number;
  withBuilding: number;
  /** rooms with no explicit building and a code that cannot be decoded -> must be filled in by hand */
  unresolved: { id: string; code: string; name: string }[];
  /** buildings used by rooms that are not on the grid */
  buildingsNotOnGrid: string[];
}

export function locationCoverage(rooms: (PhysicalRoom & { building?: string; floor?: number })[], grid: BuildingGrid): LocationCoverage {
  const { positions } = buildingPositions(grid);
  const unresolved: LocationCoverage['unresolved'] = [];
  const notOnGrid = new Set<string>();
  let withBuilding = 0;
  for (const r of rooms) {
    const b = roomBuilding(r);
    if (!b) { unresolved.push({ id: r.id, code: r.code, name: r.name }); continue; }
    withBuilding++;
    if (!resolveBuildingKey(b, positions)) notOnGrid.add(b);
  }
  return {
    total: rooms.length,
    withBuilding,
    unresolved,
    buildingsNotOnGrid: [...notOnGrid].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })),
  };
}
