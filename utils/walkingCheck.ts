/**
 * Walking / travel checker (pure, advisory only).
 *
 * Looks at the paper timetable and flags days where a teacher or a class has to move between
 * buildings (or up and down stairs) in back-to-back periods, or goes A -> B -> A.
 * Distances come from the campus grid (utils/buildings.ts); the unit is "grid cells".
 * Nothing here blocks scheduling.
 */
import type { GradeLevel, PeriodSetting, PhysicalRoom, ScheduleEntry, Subject, Teacher } from '../types';
import { isLunchPeriodForGrade } from '../components/scheduleUtils';
import {
  BuildingGrid, GridPos, buildingPositions, buildingDistance, resolveBuildingKey, roomBuilding, roomFloor,
} from './buildings';

export type Severity = 'ok' | 'watch' | 'risk';
const RANK: Record<Severity, number> = { ok: 0, watch: 1, risk: 2 };
const maxSev = (a: Severity, b: Severity): Severity => (RANK[a] >= RANK[b] ? a : b);

export interface WalkOptions {
  /** cost of one floor of stairs, in grid cells (ground floor = floor 1 costs nothing) */
  floorWeight: number;
  /** a move at least this costly between consecutive periods is "ควรดู" */
  watch: number;
  /** ... and at least this costly is "เสี่ยง" */
  risk: number;
  /** number of building changes in one day that is "ควรดู" / "เสี่ยง" */
  switchWatch: number;
  switchRisk: number;
}
export const DEFAULT_WALK_OPTIONS: WalkOptions = { floorWeight: 0.5, watch: 2, risk: 3.5, switchWatch: 3, switchRisk: 5 };

export interface Loc { building: string; floor: number }

/** Cost of walking from a to b: horizontal grid distance plus stairs. null if either is not on the grid. */
export function legCost(a: Loc, b: Loc, positions: Map<string, GridPos[]>, opts: WalkOptions = DEFAULT_WALK_OPTIONS): number | null {
  const ka = resolveBuildingKey(a.building, positions);
  const kb = resolveBuildingKey(b.building, positions);
  if (!ka || !kb) return null;
  if (ka === kb) return +(Math.abs(a.floor - b.floor) * opts.floorWeight).toFixed(2);
  const d = buildingDistance(a.building, b.building, positions);
  if (d === null) return null;
  return +(d + opts.floorWeight * (Math.max(a.floor, 1) - 1 + Math.max(b.floor, 1) - 1)).toFixed(2);
}

export interface Stop { period: number; loc: Loc; label: string; /** period name as shown in the timetable (e.g. "P1") */ pl?: string }
export interface Leg { fromPeriod: number; toPeriod: number; from: string; to: string; cost: number; severity: Severity }
export interface DayResult {
  day: string;
  stops: Stop[];
  /** stops split at the lunch break: [before lunch, after lunch]; a single group when there is no lunch in between */
  segments: Stop[][];
  switches: number;       // building changes over the whole day (information only)
  maxSegmentSwitches: number; // back-to-back building changes in the worst stretch between breaks (this is what the thresholds judge)
  legs: Leg[];            // back-to-back moves that actually go somewhere else
  pingPong: { periods: [number, number, number]; labels: [string, string, string] }[];
  severity: Severity;
  reasons: string[];
  maxCost: number;
}

/** Period shown exactly as the timetable header, in Thai: "P0" -> "คาบ0" (0-based like the header). */
export function periodName(index: number, label?: string): string {
  const m = /^\s*P\s*(\d+)\s*$/i.exec(label || '');
  return `คาบ${m ? m[1] : index}`;
}

const sameLoc = (a: Loc, b: Loc) => a.building === b.building && a.floor === b.floor;

/** Analyse one person/class on one day. `stops` must be sorted by period, one per period. */
export function analyzeDay(day: string, stops: Stop[], positions: Map<string, GridPos[]>, opts: WalkOptions = DEFAULT_WALK_OPTIONS, breaks: number[] = []): DayResult {
  const legs: Leg[] = [];
  let switches = 0;
  // Stops on either side of a lunch break are separate stretches: people get a rest and can move freely.
  const segments: Stop[][] = [];
  for (const st of stops) {
    const last = segments[segments.length - 1];
    const prev = last?.[last.length - 1];
    if (!prev || breaks.some((b) => prev.period < b && b < st.period)) segments.push([st]); else last.push(st);
  }
  // Only moves between back-to-back periods count towards the "too many moves" limit: a free period in between is time to walk.
  const segSwitches = segments.map((seg) => seg.reduce((n, st, i) => n + (i > 0 && st.period - seg[i - 1].period === 1 && seg[i - 1].loc.building !== st.loc.building ? 1 : 0), 0));
  const maxSegmentSwitches = segSwitches.reduce((m, n) => Math.max(m, n), 0);
  const segName = (i: number) => (segments.length === 1 ? '' : segments.length === 2 ? (i === 0 ? ' ก่อนพักกลางวัน' : ' หลังพักกลางวัน') : ` ช่วงที่ ${i + 1}`);
  let severity: Severity = 'ok';
  const reasons: string[] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (a.loc.building !== b.loc.building) switches++;
    if (b.period - a.period !== 1 || sameLoc(a.loc, b.loc)) continue;
    const cost = legCost(a.loc, b.loc, positions, opts);
    if (cost === null || cost === 0) continue;
    const pa = a.pl ?? periodName(a.period), pb = b.pl ?? periodName(b.period);
    const sev: Severity = cost >= opts.risk ? 'risk' : cost >= opts.watch ? 'watch' : 'ok';
    legs.push({ fromPeriod: a.period, toPeriod: b.period, from: a.label, to: b.label, cost, severity: sev });
    severity = maxSev(severity, sev);
    if (sev !== 'ok') reasons.push(`${pa}→${pb} เดิน ${a.label} → ${b.label} (ระยะ ${cost})`);
  }
  // A -> B -> A on consecutive periods, B in another building
  const pingPong: DayResult['pingPong'] = [];
  for (let i = 2; i < stops.length; i++) {
    const a = stops[i - 2], b = stops[i - 1], c = stops[i];
    if (b.period - a.period !== 1 || c.period - b.period !== 1) continue;
    if (a.loc.building === c.loc.building && a.loc.building !== b.loc.building) {
      pingPong.push({ periods: [a.period, b.period, c.period], labels: [a.label, b.label, c.label] });
      const cost = legCost(a.loc, b.loc, positions, opts) ?? 0;
      severity = maxSev(severity, cost >= opts.watch ? 'risk' : 'watch');
      reasons.push(`${a.pl ?? periodName(a.period)}-${c.pl ?? periodName(c.period)} เดินไปกลับ ${a.label} → ${b.label} → ${c.label}`);
    }
  }
  segSwitches.forEach((n, i) => {
    if (n >= opts.switchRisk) { severity = maxSev(severity, 'risk'); reasons.push(`ย้ายอาคาร ${n} ครั้ง${segName(i) || 'ในวันเดียว'}`); }
    else if (n >= opts.switchWatch) { severity = maxSev(severity, 'watch'); reasons.push(`ย้ายอาคาร ${n} ครั้ง${segName(i) || 'ในวันเดียว'}`); }
  });
  return { day, stops, segments, maxSegmentSwitches, switches, legs, pingPong, severity, reasons, maxCost: legs.reduce((m, l) => Math.max(m, l.cost), 0) };
}

/* ---------------- whole timetable ---------------- */

export interface WalkInput {
  entries: ScheduleEntry[];
  rooms: (PhysicalRoom & { building?: string; floor?: number })[];
  teachers: Teacher[];
  gradeLevels: GradeLevel[];
  subjects: Subject[];
  /** period definitions; lunch periods (lunchGradeLevelIds) split a day into before/after lunch */
  periods?: PeriodSetting[];
  grid: BuildingGrid;
  options?: Partial<WalkOptions>;
}

export interface SubjectResult extends DayResult { key: string; name: string; group: string }
export interface WalkReport {
  teacherDays: (DayResult & { teacherId: string; name: string; group: string })[];
  classDays: (DayResult & { gradeLevelId: string; name: string; group: string })[];
  stats: { entries: number; noLocation: number; notOnGrid: number; splitSkipped: number };
  options: WalkOptions;
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const isLunchLike = (s?: Subject) =>
  !!s && ((s.name || '').includes('พักกลางวัน') || (s.subjectCode || '').toUpperCase() === 'LUNCH');

export function analyzeWalking(input: WalkInput): WalkReport {
  const opts: WalkOptions = { ...DEFAULT_WALK_OPTIONS, ...(input.options || {}) };
  const { positions } = buildingPositions(input.grid);
  const roomById = new Map(input.rooms.map((r) => [r.id, r]));
  const gradeById = new Map(input.gradeLevels.map((g) => [g.id, g]));
  const subjectById = new Map(input.subjects.map((s) => [s.id, s]));
  const stats = { entries: 0, noLocation: 0, notOnGrid: 0, splitSkipped: 0 };

  const parentOf = (g: GradeLevel): GradeLevel | undefined => {
    if (!g.name.includes('/')) return undefined;
    const pn = g.name.split('/')[0];
    return input.gradeLevels.find((x) => x.name === pn);
  };
  const isLeaf = (g: GradeLevel) => !input.gradeLevels.some((o) => o.id !== g.id && o.name.startsWith(g.name + '/'));

  const labelOf = (room: PhysicalRoom & { building?: string; floor?: number }): Stop | null => {
    const b = roomBuilding(room);
    if (!b) return null;
    const f = roomFloor(room) ?? 1;
    const name = /^\d+$/.test(b) ? `อาคาร ${b}` : b; // numbered buildings: "อาคาร 9"; zones (F1, P9) keep their name
    return { period: 0, loc: { building: b, floor: f }, label: `${name}${f > 1 ? ` ชั้น ${f}` : ''}` };
  };
  const homeroomOf = (g: GradeLevel | undefined) => {
    if (!g) return undefined;
    const id = g.homeroomPhysicalRoomId || (parentOf(g)?.homeroomPhysicalRoomId);
    return id ? roomById.get(id) : undefined;
  };
  /** where an entry takes place: its room, otherwise the class homeroom */
  const cache = new Map<string, Stop | null>();
  const locate = (e: ScheduleEntry): Stop | null => {
    if (cache.has(e.id)) return cache.get(e.id)!;
    const s = locateOnce(e);
    cache.set(e.id, s);
    return s;
  };
  const locateOnce = (e: ScheduleEntry): Stop | null => {
    const room = (e.physicalRoomId && roomById.get(e.physicalRoomId)) || homeroomOf(gradeById.get(e.gradeLevelId));
    const s = room ? labelOf(room) : null;
    if (!s) { stats.noLocation++; return null; }
    if (!resolveBuildingKey(s.loc.building, positions)) { stats.notOnGrid++; return null; }
    return { ...s, period: e.period, pl: periodName(e.period, input.periods?.[e.period]?.label) };
  };

  const lunchEntries = input.entries.filter((e) => isLunchLike(subjectById.get(e.subjectId)));
  const entries = input.entries.filter((e) => !isLunchLike(subjectById.get(e.subjectId)));
  /** lunch period indexes for a grade (from period settings, plus any lunch entries placed for it on that day) */
  const lunchFor = (gradeId: string, day: string): number[] => {
    const set = new Set<number>();
    (input.periods || []).forEach((p, i) => { if (isLunchPeriodForGrade(p, gradeId, input.gradeLevels)) set.add(i); });
    const g = gradeById.get(gradeId);
    const par = g ? parentOf(g) : undefined;
    lunchEntries.forEach((e) => { if (e.day === day && (e.gradeLevelId === gradeId || e.gradeLevelId === par?.id)) set.add(e.period); });
    return [...set];
  };
  stats.entries = entries.length;

  /* teachers */
  const byTeacherDay = new Map<string, Map<string, Map<number, Stop>>>();
  const teacherGrades = new Map<string, Set<string>>(); // `${tid}|${day}` -> grade ids taught
  for (const e of entries) {
    if (subjectById.get(e.subjectId)?.type === 'STUDENT_ONLY') continue;
    const s = locate(e);
    if (!s) continue;
    for (const tid of e.teacherIds || []) {
      const days = byTeacherDay.get(tid) ?? new Map();
      const periods = days.get(e.day) ?? new Map();
      if (!periods.has(e.period)) periods.set(e.period, s);
      const gk = `${tid}|${e.day}`;
      teacherGrades.set(gk, (teacherGrades.get(gk) ?? new Set()).add(e.gradeLevelId));
      days.set(e.day, periods); byTeacherDay.set(tid, days);
    }
  }
  const teacherDays: WalkReport['teacherDays'] = [];
  for (const [tid, days] of byTeacherDay) {
    const t = input.teachers.find((x) => x.id === tid);
    for (const [day, periods] of days) {
      const stops = [...periods.values()].sort((a, b) => a.period - b.period);
      const breaks = [...new Set([...(teacherGrades.get(`${tid}|${day}`) ?? [])].flatMap((gid) => lunchFor(gid, day)))];
      const r = analyzeDay(day, stops, positions, opts, breaks);
      teacherDays.push({ ...r, teacherId: tid, name: t?.name || tid, group: t?.department || '(ไม่ระบุกลุ่มสาระฯ)' });
    }
  }

  /* classes: a leaf class takes its own entries plus those of its parent level */
  const classDays: WalkReport['classDays'] = [];
  const leaves = input.gradeLevels.filter(isLeaf);
  for (const g of leaves) {
    const parent = parentOf(g);
    const mine = entries.filter((e) => (e.gradeLevelId === g.id || (parent && e.gradeLevelId === parent.id)) && subjectById.get(e.subjectId)?.type !== 'TEACHER_ONLY');
    const byDay = new Map<string, Map<number, Stop[]>>();
    for (const e of mine) {
      const s = locate(e);
      if (!s) continue;
      const periods = byDay.get(e.day) ?? new Map();
      periods.set(e.period, [...(periods.get(e.period) || []), s]);
      byDay.set(e.day, periods);
    }
    for (const [day, periods] of byDay) {
      const stops: Stop[] = [];
      for (const [p, list] of [...periods.entries()].sort((a, b) => a[0] - b[0])) {
        // split cohorts in different places in the same period: we cannot tell where a given student is
        if (new Set(list.map((s) => `${s.loc.building}|${s.loc.floor}`)).size > 1) { stats.splitSkipped++; continue; }
        stops.push({ ...list[0], period: p });
      }
      const r = analyzeDay(day, stops, positions, opts, lunchFor(g.id, day));
      classDays.push({ ...r, gradeLevelId: g.id, name: g.name, group: (parent || g).name });
    }
  }

  const order = (a: DayResult, b: DayResult) =>
    RANK[b.severity] - RANK[a.severity] || b.maxCost - a.maxCost || b.switches - a.switches ||
    DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
  teacherDays.sort(order);
  classDays.sort(order);
  return { teacherDays, classDays, stats, options: opts };
}
