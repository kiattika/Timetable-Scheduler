import { describe, it, expect } from 'vitest';
import { computeWorkload } from '../utils/teacherWorkload';

const grades: any[] = [{ id: 'g58', name: 'M.5/8' }];
const teachers: any[] = [{ id: 't', name: 'ครู', department: 'คณิตศาสตร์' }];
const sub = (id: string, subjectCode: string, extra: any = {}): any => ({ id, subjectCode, name: id, periodsPerWeek: 1, ...extra });
const entries = (...ids: string[]): any[] => ids.map((subjectId, i) => ({ id: `e${i}`, subjectId, gradeLevelId: 'g58', day: 'Monday', period: i, teacherIds: ['t'] }));

describe('computeWorkload activity rule', () => {
  const subjects = [
    sub('ส30224', 'ส30224', { name: 'ป้องกันการทุจริต', isBroadAssignment: true }), // ส… is never an activity
    sub('cz', 'CZ', { name: 'Cleaning Zone' }),                                     // CZ is always an activity
    sub('ค32202', 'ค32202'),
    sub('ก32908', 'ก32908', { type: 'TEACHER_ONLY' }),
  ];
  const m = computeWorkload({ teachers, subjects, gradeLevels: grades, scheduleEntries: entries('ส30224', 'cz', 'ค32202', 'ก32908'), assignments: [], source: 'schedule' }).overall.metrics;
  it('counts ส30224 as a main subject and CZ + ก as activities', () => {
    expect(m.upperExtra).toBe(2);   // ส30224 (digit 3 = 2 -> extra) + ค32202
    expect(m.activity).toBe(2);     // CZ + ก32908
    expect(m.total).toBe(4);
  });
});
