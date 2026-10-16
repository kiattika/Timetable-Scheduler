import { describe, it, expect } from 'vitest';
import { analyzeWalking, analyzeDay, legCost, effectiveSeverity, DEFAULT_WALK_OPTIONS } from '../utils/walkingCheck';
import { parseGridText, buildingPositions } from '../utils/buildings';

// school layout: 9 on top, 1 below it, 5 | 2 | 6 ... (rotated as on the real map)
const grid = parseGridText(',9,\n,1,\n5,2,6\n,3,7\n,4,8');
const { positions } = buildingPositions(grid);
const room = (id: string, code: string, extra: any = {}) => ({ id, code, name: code, type: 'x', ...extra });
const rooms: any[] = [room('r931', '931'), room('r111', '111'), room('r411', '411'), room('r211', '211'), room('r921', '921'), room('r911', '911'), room('r311', '311')];
const teachers: any[] = [{ id: 't1', name: 'ครูหนึ่ง', department: 'คณิต' }, { id: 't2', name: 'ครูสอง', department: 'ไทย' }];
const grades: any[] = [{ id: 'm1', name: 'M.1' }, { id: 'm11', name: 'M.1/1', homeroomPhysicalRoomId: 'r111' }, { id: 'm12', name: 'M.1/2', homeroomPhysicalRoomId: 'r211' }];
const subjects: any[] = [{ id: 's', name: 'วิชา', periodsPerWeek: 1 }, { id: 'lunch', name: 'พักกลางวัน' }];
let n = 0;
const e = (teacher: string, day: string, period: number, roomId: string | undefined, gradeLevelId = 'm11', extra: any = {}) =>
  ({ id: `e${n++}`, gradeLevelId, day, period, subjectId: 's', teacherIds: [teacher], physicalRoomId: roomId, ...extra });
const periods: any[] = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, startTime: '', endTime: '', lunchGradeLevelIds: i === 5 ? ['m1'] : undefined }));
const run = (entries: any[], options?: any, withPeriods = true) => analyzeWalking({ entries, rooms, teachers, gradeLevels: grades, subjects, periods: withPeriods ? periods : undefined, grid, options });

describe('legCost', () => {
  const L = (building: string, floor = 1) => ({ building, floor });
  it('horizontal distance + stairs', () => {
    expect(legCost(L('2'), L('1'), positions)).toBe(1);
    expect(legCost(L('9', 6), L('1', 1), positions)).toBe(1 + 2.5); // 5 floors down * 0.5
    expect(legCost(L('9', 3), L('9', 1), positions)).toBe(1); // same building: stairs only
    expect(legCost(L('9'), L('99'), positions)).toBeNull();
  });
});

describe('teacher checks', () => {
  it('far building in back-to-back periods is risk; reasons name the periods', () => {
    const r = run([e('t1', 'Monday', 0, 'r931'), e('t1', 'Monday', 1, 'r411')]);
    const d = r.teacherDays.find((x) => x.teacherId === 't1')!;
    expect(d.severity).toBe('risk');
    expect(d.legs[0].cost).toBe(5); // 4 cells + 2 floors of stairs
    expect(d.reasons[0]).toContain('คาบ0→คาบ1');
  });
  it('uses the timetable period names (P0, P1 ...) in stops', () => {
    const d = run([e('t1', 'Monday', 0, 'r111'), e('t1', 'Monday', 3, 'r211')]).teacherDays[0];
    expect(d.stops.map((s) => s.pl)).toEqual(['คาบ0', 'คาบ3']);
  });
  it('a gap period means no tight leg', () => {
    const d = run([e('t1', 'Monday', 0, 'r931'), e('t1', 'Monday', 2, 'r411')]).teacherDays[0];
    expect(d.legs).toHaveLength(0);
    expect(d.severity).toBe('ok');
  });
  it('neighbouring buildings on the ground floor are fine', () => {
    const d = run([e('t1', 'Monday', 0, 'r111'), e('t1', 'Monday', 1, 'r211')]).teacherDays[0];
    expect(d.severity).toBe('ok');
  });
  it('A -> B -> A is flagged', () => {
    const d = run([e('t1', 'Tuesday', 0, 'r111'), e('t1', 'Tuesday', 1, 'r211'), e('t1', 'Tuesday', 2, 'r111')]).teacherDays[0];
    expect(d.pingPong).toHaveLength(1);
    expect(d.severity).not.toBe('ok');
  });
  it('many back-to-back building changes in a stretch', () => {
    const d = run([0, 1, 2, 3].map((p, i) => e('t1', 'Friday', p, i % 2 === 0 ? 'r111' : 'r211')), { switchWatch: 3, switchRisk: 9 }).teacherDays[0];
    expect(d.maxSegmentSwitches).toBe(3);
    expect(d.reasons.join()).toContain('ย้ายอาคาร 3 ครั้ง');
  });
  it('changes separated by a free period do not count as moves (time to walk)', () => {
    const d = run([0, 2, 4, 6].map((p, i) => e('t1', 'Friday', p, i % 2 === 0 ? 'r111' : 'r211')), undefined, false).teacherDays[0];
    expect(d.maxSegmentSwitches).toBe(0);
    expect(d.severity).toBe('ok');
  });
  it('free period between buildings is normal: P1 building 4, P2 free, P3-P4 building 9', () => {
    const d = run([e('t1', 'Monday', 1, 'r411'), e('t1', 'Monday', 3, 'r911'), e('t1', 'Monday', 4, 'r911')]).teacherDays[0];
    expect(d.legs).toHaveLength(0);
    expect(d.severity).toBe('ok');
  });
  it('building 3 -> 9 back to back, free period, back to 3 is "ควรดู" (not ok, not risk)', () => {
    const d = run([e('t1', 'Monday', 1, 'r311'), e('t1', 'Monday', 2, 'r911'), e('t1', 'Monday', 4, 'r311')]).teacherDays[0];
    expect(d.legs).toHaveLength(1);
    expect(d.severity).toBe('watch');
  });
  it('entry without a room uses the class homeroom', () => {
    const d = run([e('t1', 'Monday', 0, 'r931'), e('t1', 'Monday', 1, undefined, 'm11')]).teacherDays[0];
    expect(d.stops[1].loc.building).toBe('1');
  });
  it('entries with no location at all are counted, not crashed on', () => {
    const r = run([e('t1', 'Monday', 0, undefined, 'm1')]);
    expect(r.teacherDays).toHaveLength(0);
    expect(r.stats.noLocation).toBe(1);
  });
  it('lunch entries are ignored', () => {
    const r = run([e('t1', 'Monday', 0, 'r931', 'm11', { subjectId: 'lunch' })]);
    expect(r.stats.entries).toBe(0);
  });
});

describe('class checks', () => {
  it('homeroom -> lab -> homeroom is a round trip', () => {
    const r = run([e('t1', 'Monday', 0, undefined, 'm11'), e('t2', 'Monday', 1, 'r411', 'm11'), e('t1', 'Monday', 2, undefined, 'm11')]);
    const d = r.classDays.find((x) => x.name === 'M.1/1')!;
    expect(d.pingPong).toHaveLength(1);
    expect(d.group).toBe('M.1');
  });
  it('parent-level entries apply to every child class', () => {
    const r = run([e('t1', 'Monday', 0, 'r931', 'm1'), e('t1', 'Monday', 1, undefined, 'm11')]);
    expect(r.classDays.filter((c) => c.day === 'Monday').map((c) => c.name).sort()).toEqual(['M.1/1', 'M.1/2']);
    const d = r.classDays.find((c) => c.name === 'M.1/1')!;
    expect(d.stops.map((s) => s.loc.building)).toEqual(['9', '1']);
  });
  it('split cohorts in different places in one period are skipped, not guessed', () => {
    const r = run([e('t1', 'Monday', 0, 'r931', 'm11', { cohort: 'a' }), e('t2', 'Monday', 0, 'r411', 'm11', { cohort: 'b' }), e('t1', 'Monday', 1, undefined, 'm11')]);
    expect(r.stats.splitSkipped).toBe(1);
  });
  it('is sorted worst first', () => {
    const r = run([
      e('t1', 'Monday', 0, 'r111'), e('t1', 'Monday', 1, 'r211'),
      e('t2', 'Monday', 0, 'r931'), e('t2', 'Monday', 1, 'r411'),
    ]);
    expect(r.teacherDays[0].teacherId).toBe('t2');
  });
});

it('thresholds are adjustable', () => {
  const r = run([e('t1', 'Monday', 0, 'r111'), e('t1', 'Monday', 1, 'r211')], { watch: 0.5, risk: 0.9 });
  expect(r.teacherDays[0].severity).toBe('risk');
  expect(DEFAULT_WALK_OPTIONS.watch).toBe(2);
});

describe('lunch splits the day', () => {
  // morning P0-P4 alternate between buildings 1 and 2 back to back, afternoon P6-P9 too
  const day = [0, 1, 2, 3, 4, 6, 7, 8, 9].map((p, i) => e('t1', 'Monday', p, i % 2 === 0 ? 'r111' : 'r211'));
  it('without lunch info the break is just a 1-period gap and the stretch is the whole day', () => {
    const d = run(day, undefined, false).teacherDays[0];
    expect(d.segments).toHaveLength(1);
    expect(d.maxSegmentSwitches).toBe(7);
  });
  it('with lunch at P5 the two halves are judged separately', () => {
    const d = run(day).teacherDays[0];
    expect(d.segments.map((s) => s.length)).toEqual([5, 4]);
    expect(d.maxSegmentSwitches).toBe(4);
  });
  it('a stretch of switches before lunch is named in the reason', () => {
    const d = run([0, 1, 2].map((p, i) => e('t1', 'Monday', p, i % 2 === 0 ? 'r111' : 'r211')).concat([e('t1', 'Monday', 6, 'r111')]), { switchWatch: 2, switchRisk: 9 }).teacherDays[0];
    expect(d.reasons.join()).toContain('ก่อนพักกลางวัน');
  });
  it('a lunch entry placed for the class also counts as a break', () => {
    const entries = [...day, e('t1', 'Monday', 5, undefined, 'm11', { subjectId: 'lunch' })];
    expect(run(entries, undefined, false).teacherDays[0].segments).toHaveLength(2);
  });
});

describe('acceptance (ผู้สอนรับได้)', () => {
  const entries = () => [e('t1', 'Monday', 0, 'r931'), e('t1', 'Monday', 1, 'r411')];
  const keyOf = () => run(entries()).teacherDays[0].key;
  const withAck = (key: string, ents = entries()) => analyzeWalking({
    entries: ents, rooms, teachers: [{ ...teachers[0], walkAcks: [{ key, level: 'risk', by: 'x', at: '2026-01-01T00:00:00Z', note: 'ok' }] }, teachers[1]] as any,
    gradeLevels: grades, subjects, periods, grid,
  }).teacherDays[0];
  it('a matching acceptance turns the row green but keeps the original level', () => {
    const d = withAck(keyOf());
    expect(d.accepted).toBe(true);
    expect(d.severity).toBe('risk');
    expect(effectiveSeverity(d)).toBe('ok');
  });
  it('moving a period (the day changes) voids the acceptance', () => {
    const d = withAck(keyOf(), [e('t1', 'Monday', 0, 'r931'), e('t1', 'Monday', 2, 'r411')]);
    expect(d.accepted).toBe(false);
  });
  it('changing a room to another building voids it too', () => {
    const d = withAck(keyOf(), [e('t1', 'Monday', 0, 'r931'), e('t1', 'Monday', 1, 'r111')]);
    expect(d.accepted).toBe(false);
  });
  it('flagged cells are marked at the arrival period', () => {
    const d = run(entries()).teacherDays[0];
    expect(d.marks).toEqual([expect.objectContaining({ period: 1, severity: 'risk' })]);
  });
});
