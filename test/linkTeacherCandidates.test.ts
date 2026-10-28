import { describe, it, expect } from 'vitest';
import { rankTeachersForSubject } from '../utils/linkTeacherCandidates';

const grades: any[] = [{ id: 'm5', name: 'M.5' }, { id: 'm5-1', name: 'M.5/1' }, { id: 'm5-2', name: 'M.5/2' }, { id: 'm4', name: 'M.4' }, { id: 'm4-1', name: 'M.4/1' }];
const teachers: any[] = [
  { id: 'a', homeroomGradeLevelIds: ['m5-1'] }, { id: 'b', homeroomGradeLevelIds: ['m5-2', 'm5-1'] },
  { id: 'c', homeroomGradeLevelIds: ['m4-1'] }, { id: 'd' },
];
describe('rankTeachersForSubject', () => {
  it('lists only advisors of the levels the subject is open to', () => {
    const r = rankTeachersForSubject(teachers, { applicableParentGradeLevelIds: ['m5'] }, grades);
    expect([...r.advisorLabels.keys()]).toEqual(['a', 'b']);
    expect(r.advisorLabels.get('b')).toBe('M.5/1, M.5/2');
    expect(r.levelNames).toEqual(['M.5']);
  });
  it('is empty when the subject has no level restriction', () => {
    expect(rankTeachersForSubject(teachers, {}, grades).advisorLabels.size).toBe(0);
    expect(rankTeachersForSubject(teachers, undefined, grades).advisorLabels.size).toBe(0);
  });
});
