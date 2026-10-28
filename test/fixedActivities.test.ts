import { describe, it, expect } from 'vitest';
import { planFixedActivityEntries, reservedActivityLabelsForCell } from '../lib/fixedActivities';

const grades: any[] = [
  { id: 'm1', name: 'M.1' }, { id: 'm1-1', name: 'M.1/1', parentId: 'm1', homeroomPhysicalRoomId: 'r11' },
  { id: 'm1-2', name: 'M.1/2', parentId: 'm1' },
];
const teachers: any[] = [{ id: 'a', homeroomGradeLevelIds: ['m1-1'] }, { id: 'b', homeroomGradeLevelIds: ['m1-2'] }, { id: 'c' }];
const link = (teacherId: string, subjectId: string, gradeLevelId: string): any => ({ id: `${teacherId}${subjectId}${gradeLevelId}`, teacherId, subjectId, gradeLevelId });
const ids = () => { let i = 0; return () => `n${++i}`; };
const periods = (acts: any[]): any[] => [{ id: 'p0' }, { id: 'p1', fixedActivities: acts }];
const run = (subjects: any[], acts: any[], links: any[], existing: any[] = []) =>
  planFixedActivityEntries({ periodSettings: periods(acts), subjects, teachers, gradeLevels: grades, links, existing, newId: ids() });

describe('planFixedActivityEntries', () => {
  it('level-wide subject -> one entry on the parent grade per day, linked teachers, no room', () => {
    const r = run([{ id: 'scout', isBroadAssignment: true }], [{ id: 'f', subjectId: 'scout', gradeLevelIds: ['m1'], days: ['Thursday', 'Friday'] }],
      [link('a', 'scout', 'm1-1'), link('b', 'scout', 'm1-2')]);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({ gradeLevelId: 'm1', period: 1, teacherIds: ['a', 'b'], physicalRoomId: '', fixedActivityId: 'f' });
  });
  it('standard subject -> one entry per classroom, teachers of that class, homeroom room', () => {
    const r = run([{ id: 'cz', isHomeroomAdvisorySubject: true }], [{ id: 'f', subjectId: 'cz', gradeLevelIds: ['m1'], days: ['Monday'] }], []);
    expect(r.entries.map(e => [e.gradeLevelId, e.teacherIds, e.physicalRoomId])).toEqual([['m1-1', ['a'], 'r11'], ['m1-2', ['b'], '']]);
  });
  it('teacher-only subject -> ONE Non-Student entry per day with every linked teacher (old per-class links of the levels too)', () => {
    const r = run([{ id: 'club', type: 'TEACHER_ONLY' }], [{ id: 'f', subjectId: 'club', gradeLevelIds: ['m1', 'm1'], days: ['Thursday'] }],
      [link('a', 'club', 'Non-Student'), link('b', 'club', 'm1-2'), link('c', 'club', 'm9-1')]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ gradeLevelId: 'Non-Student', day: 'Thursday', period: 1, teacherIds: ['a', 'b'], physicalRoomId: '' });
  });
  it('teacher-only: busy teachers are left out and reported', () => {
    const existing = [{ id: 'x', gradeLevelId: 'm1-1', day: 'Thursday', period: 1, subjectId: 'math', teacherIds: ['a'] }];
    const r = run([{ id: 'club', type: 'TEACHER_ONLY' }], [{ id: 'f', subjectId: 'club', gradeLevelIds: ['m1'], days: ['Thursday'] }],
      [link('a', 'club', 'Non-Student'), link('b', 'club', 'Non-Student')], existing);
    expect(r.entries[0].teacherIds).toEqual(['b']);
    expect(r.skipped[0].reason).toBe('teachers_busy');
    expect(r.skipped[0].busy).toEqual([{ teacherId: 'a', subjectId: 'math', gradeLevelId: 'm1-1' }]);
    expect(r.skipped[0].freeCount).toBe(1);
  });
  it('teacher-only: reported once per activity/day even when several levels are ticked', () => {
    const existing = [{ id: 'x', gradeLevelId: 'm1-1', day: 'Thursday', period: 1, subjectId: 'math', teacherIds: ['a'] }];
    const r = run([{ id: 'club', type: 'TEACHER_ONLY' }], [{ id: 'f', subjectId: 'club', gradeLevelIds: ['m1', 'm1', 'm1'], days: ['Thursday'] }],
      [link('a', 'club', 'Non-Student')], existing);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({ reason: 'teachers_busy', freeCount: 0 });
  });
  it('slot_taken names the entry that blocks it', () => {
    const existing = [{ id: 'y', gradeLevelId: 'm1-2', day: 'Monday', period: 1, subjectId: 'math', teacherIds: ['z'] }];
    const r = run([{ id: 'cz', isHomeroomAdvisorySubject: true }], [{ id: 'f', subjectId: 'cz', gradeLevelIds: ['m1'], days: ['Monday'] }], [], existing);
    expect(r.skipped.find(k => k.gradeLevelId === 'm1-2')?.blocker).toEqual({ subjectId: 'math', gradeLevelId: 'm1-2' });
  });
  it('reservedActivityLabelsForCell shows teacher-only reservations on covered classes and days', () => {
    const period: any = { fixedActivities: [{ id: 'f', subjectId: 'club', gradeLevelIds: ['m1'], days: ['Thursday'] }] };
    const subs: any[] = [{ id: 'club', name: 'ชุมนุม', type: 'TEACHER_ONLY' }, { id: 'x', name: 'X' }];
    expect(reservedActivityLabelsForCell(period, 'Thursday' as any, 'm1-2', grades, subs)).toEqual(['ชุมนุม']);
    expect(reservedActivityLabelsForCell(period, 'Monday' as any, 'm1-2', grades, subs)).toEqual([]);
    expect(reservedActivityLabelsForCell(period, 'Thursday' as any, 'm2-1', grades, subs)).toEqual([]);
    period.fixedActivities[0].subjectId = 'x';
    expect(reservedActivityLabelsForCell(period, 'Thursday' as any, 'm1-2', grades, subs)).toEqual([]);
  });
  it('skips slots already taken and busy teachers, reporting why', () => {
    const existing = [{ id: 'x', gradeLevelId: 'm1-1', day: 'Monday', period: 1, subjectId: 'math', teacherIds: ['z'] },
                      { id: 'y', gradeLevelId: 'm1-2', day: 'Monday', period: 1, subjectId: 'math', teacherIds: ['b'] }];
    const r = run([{ id: 'cz', isHomeroomAdvisorySubject: true }], [{ id: 'f', subjectId: 'cz', gradeLevelIds: ['m1'], days: ['Monday'] }], [], existing);
    expect(r.entries).toHaveLength(0);
    expect(r.skipped.map(s => s.reason)).toEqual(['slot_taken', 'slot_taken']);
  });
  it('reports a class with no teacher and replaces earlier generated entries on re-run', () => {
    const old = { id: 'old', gradeLevelId: 'm1-1', day: 'Monday', period: 1, subjectId: 'cz', teacherIds: ['a'], fixedActivityId: 'f' };
    const r = run([{ id: 'cz' }], [{ id: 'f', subjectId: 'cz', gradeLevelIds: ['m1'], days: ['Monday'] }], [link('a', 'cz', 'm1-1')], [old]);
    expect(r.replacedIds).toEqual(['old']);
    expect(r.entries.map(e => e.gradeLevelId)).toEqual(['m1-1']);
    expect(r.skipped).toMatchObject([{ gradeLevelId: 'm1-2', reason: 'no_teacher' }]);
  });
});
