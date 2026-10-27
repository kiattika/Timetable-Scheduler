import { describe, it, expect } from 'vitest';
import { assistantMayArrange, slotDepartments, ASSISTANT_CROSS_DEPT_MESSAGE } from '../../lib/assistantScope';
import { resolveEntityDepartments } from '../../functions/src/departmentAuth';

const SCI = 'วิทยาศาสตร์และเทคโนโลยี';
const ACT = 'กิจกรรมพัฒนาผู้เรียน';
const teachers = [
  { id: 't-sci-1', department: SCI },
  { id: 't-sci-2', department: SCI },
  { id: 't-math', department: 'คณิตศาสตร์' }, // e.g. M.1/6 homeroom teacher from another department
  { id: 't-nodept' },
];
const subjects = [
  { id: 's-hr', department: ACT },
  { id: 's-sci', department: SCI },
  { id: 's-nodept' },
];

// Mirrors authorize()'s `covers` in assistantUpdateEntity.
const serverAllows = (entry: any, assigned: string[]) => {
  const depts = resolveEntityDepartments('scheduleEntries', entry, { teachers, subjects });
  return depts.length > 0 && depts.every((d) => assigned.includes(d));
};

describe('assistantMayArrange — the M.1/6 homeroom case', () => {
  it('HR slot whose homeroom teacher is from another department is blocked client-side', () => {
    expect(assistantMayArrange({ subjectId: 's-hr', teacherIds: ['t-math'] }, teachers, subjects, [SCI])).toBe(false);
  });
  it('HR slot whose homeroom teachers are all in the assistant’s department is allowed', () => {
    expect(assistantMayArrange({ subjectId: 's-hr', teacherIds: ['t-sci-1'] }, teachers, subjects, [SCI])).toBe(true);
    expect(assistantMayArrange({ subjectId: 's-hr', teacherIds: ['t-sci-1', 't-sci-2'] }, teachers, subjects, [SCI])).toBe(true);
  });
  it('mixed own + other-department teachers is blocked', () => {
    expect(assistantMayArrange({ subjectId: 's-hr', teacherIds: ['t-sci-1', 't-math'] }, teachers, subjects, [SCI])).toBe(false);
  });
  it('message tells the assistant to ask a manager/admin', () => {
    expect(ASSISTANT_CROSS_DEPT_MESSAGE).toContain('ผู้จัดการหรือผู้ดูแลระบบ');
  });
});

describe('client check agrees with the server rule (parity)', () => {
  const teacherSets: string[][] = [[], ['t-sci-1'], ['t-sci-1', 't-sci-2'], ['t-math'], ['t-sci-1', 't-math'], ['t-nodept'], ['t-sci-1', 't-nodept'], ['t-unknown'], ['No Teacher Assigned']];
  const subjectIds = ['s-hr', 's-sci', 's-nodept', 's-unknown', undefined];
  const assignedSets: string[][] = [[], [SCI], [ACT], [SCI, ACT], ['คณิตศาสตร์']];

  it('same answer for every combination', () => {
    let n = 0;
    for (const teacherIds of teacherSets) {
      for (const subjectId of subjectIds) {
        for (const assigned of assignedSets) {
          const entry = { subjectId, teacherIds };
          expect(assistantMayArrange(entry, teachers, subjects, assigned), JSON.stringify({ entry, assigned })).toBe(serverAllows(entry, assigned));
          expect(slotDepartments(entry, teachers, subjects)).toEqual(resolveEntityDepartments('scheduleEntries', entry, { teachers, subjects }));
          n++;
        }
      }
    }
    expect(n).toBe(teacherSets.length * subjectIds.length * assignedSets.length);
  });
});
