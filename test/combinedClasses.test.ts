import { describe, it, expect } from 'vitest';
import { combinableGradeIds, buildCombinedMirrors, dedupeCombinedEntries, coGradeIdsOf, combinedGradeLabel } from '../utils/combinedClasses';
import { computeWorkload } from '../utils/teacherWorkload';

const grades: any[] = [
  { id: 'm6', name: 'M.6' }, { id: 'm61', name: 'M.6/1' }, { id: 'm62', name: 'M.6/2' }, { id: 'm63', name: 'M.6/3' }, { id: 'm5', name: 'M.5' }, { id: 'm51', name: 'M.5/1' },
];
let n = 0;
const id = () => `id${++n}`;
const base = (over: any = {}): any => ({ id: id(), gradeLevelId: 'm61', day: 'Thursday', period: 3, subjectId: 's1', teacherIds: ['t1'], physicalRoomId: 'r1', ...over });

describe('combined classes', () => {
  it('offers only sibling classrooms', () => {
    expect(combinableGradeIds('m61', grades).sort()).toEqual(['m62', 'm63']);
    expect(combinableGradeIds('m6', grades)).toEqual([]);
    expect(combinableGradeIds('Non-Student', grades)).toEqual([]);
  });

  it('builds a copy per class with its own blockId and a shared group', () => {
    const prim = [base({ period: 3, blockId: 'b', blockIndex: 0, totalInBlock: 2, combinedGroupId: 'g' }), base({ period: 4, blockId: 'b', blockIndex: 1, totalInBlock: 2, combinedGroupId: 'g' })];
    const mirrors = buildCombinedMirrors(prim, ['m62'], 'g', id);
    expect(mirrors).toHaveLength(2);
    expect(mirrors.every(m => m.gradeLevelId === 'm62' && m.combinedGroupId === 'g' && m.teacherIds[0] === 't1' && m.physicalRoomId === 'r1')).toBe(true);
    expect(mirrors[0].blockId).toBeDefined();
    expect(mirrors[0].blockId).not.toBe('b');
    expect(mirrors[0].blockId).toBe(mirrors[1].blockId);
    expect(new Set([...prim, ...mirrors].map(e => e.id)).size).toBe(4);
  });

  it('counts a combined lesson once for teachers/rooms', () => {
    const a = base({ combinedGroupId: 'g' });
    const b = base({ gradeLevelId: 'm62', combinedGroupId: 'g' });
    const other = base({ period: 5 });
    expect(dedupeCombinedEntries([a, b, other])).toHaveLength(2);
    expect(coGradeIdsOf(a, [a, b, other])).toEqual(['m62']);
    expect(combinedGradeLabel(b, [a, b, other], grades)).toBe('M.6/1, M.6/2');
    expect(combinedGradeLabel(other, [a, b, other], grades)).toBeUndefined();
  });

  it('teacher workload counts a combined period once', () => {
    const subjects: any[] = [{ id: 's1', name: 'Physics', subjectCode: 'ว33203', periodsPerWeek: 2 }];
    const teachers: any[] = [{ id: 't1', name: 'T', department: 'วิทย์' }];
    const entries = [base({ combinedGroupId: 'g' }), base({ gradeLevelId: 'm62', combinedGroupId: 'g' })];
    const r: any = computeWorkload({ teachers, subjects, gradeLevels: grades, scheduleEntries: entries, assignments: [], source: 'schedule' } as any);
    expect(JSON.stringify(r.perTeacher[0].metrics)).toContain('1');
    const withoutGroup = entries.map(e => ({ ...e, combinedGroupId: undefined }));
    const r2: any = computeWorkload({ teachers, subjects, gradeLevels: grades, scheduleEntries: withoutGroup, assignments: [], source: 'schedule' } as any);
    expect(r.perTeacher[0].metrics.total).toBe(1);
    expect(r2.perTeacher[0].metrics.total).toBe(2);
  });
});
