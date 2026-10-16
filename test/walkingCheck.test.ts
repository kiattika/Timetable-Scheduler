import { describe, it, expect } from 'vitest';
import { analyzeWalking, analyzeDay, legCost, DEFAULT_WALK_OPTIONS } from '../utils/walkingCheck';
import { parseGridText, buildingPositions } from '../utils/buildings';

// school layout: 9 on top, 1 below it, 5 | 2 | 6 ... (rotated as on the real map)
const grid = parseGridText(',9,\n,1,\n5,2,6\n,3,7\n,4,8');
const { positions } = buildingPositions(grid);
const room = (id: string, code: string, extra: any = {}) => ({ id, code, name: code, type: 'x', ...extra });
const rooms: any[] = [room('r931', '931'), room('r111', '111'), room('r411', '411'), room('r211', '211'), room('r921', '921'), room('r911', '911')];
const teachers: any[] = [{ id: 't1', name: 'ครูหนึ่ง', department: 'คณิต' }, { id: 't2', name: 'ครูสอง', department: 'ไทย' }];
const grades: any[] = [{ id: 'm1', name: 'M.1' }, { id: 'm11', name: 'M.1/1', homeroomPhysicalRoomId: 'r111' }, { id: 'm12', name: 'M.1/2', homeroomPhysicalRoomId: 'r211' }];
const subjects: any[] = [{ id: 's', name: 'วิชา', periodsPerWeek: 1 }, { id: 'lunch', name: 'พักกลางวัน' }];
let n = 0;
const e = (teacher: string, day: string, period: number, roomId: string | undefined, gradeLevelId = 'm11', extra: any = {}) =>
  ({ id: `e${n++}`, gradeLevelId, day, period, subjectId: 's', teacherIds: [teacher], physicalRoomId: roomId, ...extra });
const run = (entries: any[], options?: any) => analyzeWalking({ entries, rooms, teachers, gradeLevels: grades, subjects, grid, options });

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
    expect(d.reasons[0]).toContain('คาบ 1→2');
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
  it('many building switches in a day', () => {
    const d = run([
      e('t1', 'Friday', 0, 'r111'), e('t1', 'Friday', 2, 'r211'), e('t1', 'Friday', 4, 'r111'),
      e('t1', 'Friday', 6, 'r211'),
    ]).teacherDays[0];
    expect(d.switches).toBe(3);
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
