import { describe, it, expect } from 'vitest';
import { maxTeacherOnlyPeriods } from '../components/scheduleUtils';

const E = (id: string, teacherIds: string[], subjectId = 's') => ({ id, subjectId, teacherIds });

describe('maxTeacherOnlyPeriods (teacher-only quota is per teacher)', () => {
  const entries = [E('1', ['a', 'b']), E('2', ['a', 'b']), E('x', ['z'], 'other')];
  it('a teacher not yet placed has 0 periods, so can be added after the first group', () => {
    expect(maxTeacherOnlyPeriods(entries, 's', ['c'])).toBe(0);
  });
  it('an already-full teacher is still counted', () => {
    expect(maxTeacherOnlyPeriods(entries, 's', ['a'])).toBe(2);
    expect(maxTeacherOnlyPeriods(entries, 's', ['c', 'a'])).toBe(2);
  });
  it('ignores skipped (currently edited) entries and other subjects', () => {
    expect(maxTeacherOnlyPeriods(entries, 's', ['a'], e => e.id === '1')).toBe(1);
    expect(maxTeacherOnlyPeriods(entries, 'other', ['a'])).toBe(0);
  });
});
