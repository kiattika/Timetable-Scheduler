import { describe, it, expect } from 'vitest';
import { planFixedActivityEntries } from '../lib/fixedActivities';

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
  it('teacher-only subject -> a single Non-Student entry with all linked teachers', () => {
    const r = run([{ id: 'club', type: 'TEACHER_ONLY' }], [{ id: 'f', subjectId: 'club', gradeLevelIds: ['m1', 'm1'], days: ['Thursday'] }],
      [link('a', 'club', 'Non-Student'), link('c', 'club', 'Non-Student')]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ gradeLevelId: 'Non-Student', teacherIds: ['a', 'c'] });
  });
  it('teacher-only subject also uses older per-classroom links of the ticked levels', () => {
    const r = run([{ id: 'club', type: 'TEACHER_ONLY' }], [{ id: 'f', subjectId: 'club', gradeLevelIds: ['m1'], days: ['Thursday'] }],
      [link('a', 'club', 'm1-1'), link('b', 'club', 'm1-2'), link('c', 'club', 'm9-1')]);
    expect(r.entries[0].teacherIds).toEqual(['a', 'b']);
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
