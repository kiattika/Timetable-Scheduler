import { describe, it, expect } from 'vitest';
import { planBulkDelete } from '../utils/bulkDeleteLinks';

const A = (id: string, t: string, s: string, g: string) => ({ id, teacherId: t, subjectId: s, gradeLevelId: g } as any);

describe('planBulkDelete', () => {
  const links = [A('1', 't1', 's1', 'g1'), A('2', 't2', 's1', 'g1'), A('3', 't1', 's2', 'g2')];
  it('deletes all selected when none are placed', () => {
    const p = planBulkDelete(['1', '2'], links, []);
    expect(p.deletableIds).toEqual(['1', '2']);
    expect(p.blocked).toEqual([]);
  });
  it('skips links whose subject is placed for that teacher and class', () => {
    const p = planBulkDelete(['1', '2', '3'], links, [{ subjectId: 's1', gradeLevelId: 'g1', teacherIds: ['t1'] }]);
    expect(p.deletableIds).toEqual(['2', '3']);
    expect(p.blocked.map((b) => b.id)).toEqual(['1']);
  });
  it('ignores ids not selected and tolerates missing entries', () => {
    expect(planBulkDelete(['3'], links, undefined).deletableIds).toEqual(['3']);
    expect(planBulkDelete([], links, []).deletableIds).toEqual([]);
  });
});
