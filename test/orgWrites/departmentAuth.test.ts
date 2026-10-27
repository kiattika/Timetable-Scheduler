import { describe, it, expect } from 'vitest';
import { resolveEntityDepartments } from '../../functions/src/departmentAuth';

// Mirrors authorize()'s `covers` in assistantUpdateEntity.
const covers = (assigned: string[], depts: string[]) => depts.length > 0 && depts.every((d) => assigned.includes(d));

const appDoc = {
  teachers: [
    { id: 't-sci-1', department: 'วิทยาศาสตร์' },
    { id: 't-sci-2', department: 'วิทยาศาสตร์' },
    { id: 't-art-1', department: 'ศิลปะ' },
    { id: 't-nodept' }, // no department on record
  ],
  subjects: [
    { id: 's-hr', department: 'กิจกรรมพัฒนาผู้เรียน' }, // shared subject registered under another department
    { id: 's-sci', department: 'วิทยาศาสตร์' },
    { id: 's-nodept' },
  ],
  teacherSubjectAssignments: [{ id: 'a1', subjectId: 's-sci', teacherId: 't-sci-1' }],
};
const SCI = ['วิทยาศาสตร์'];

describe('resolveEntityDepartments — scheduleEntries is judged by who teaches it', () => {
  it('one own-department teacher: allowed even if the subject belongs to another department (HR case)', () => {
    const depts = resolveEntityDepartments('scheduleEntries', { subjectId: 's-hr', teacherIds: ['t-sci-1'] }, appDoc);
    expect(depts).toEqual(['วิทยาศาสตร์']);
    expect(covers(SCI, depts)).toBe(true);
  });

  it('several teachers, all own department: allowed', () => {
    const depts = resolveEntityDepartments('scheduleEntries', { subjectId: 's-hr', teacherIds: ['t-sci-1', 't-sci-2'] }, appDoc);
    expect(depts).toEqual(['วิทยาศาสตร์']);
    expect(covers(SCI, depts)).toBe(true);
  });

  it('own + other-department co-teacher: denied (manager/admin must arrange)', () => {
    const depts = resolveEntityDepartments('scheduleEntries', { subjectId: 's-sci', teacherIds: ['t-sci-1', 't-art-1'] }, appDoc);
    expect(covers(SCI, depts)).toBe(false);
  });

  it('only another department’s teacher: denied even if the subject is the assistant’s', () => {
    const depts = resolveEntityDepartments('scheduleEntries', { subjectId: 's-sci', teacherIds: ['t-art-1'] }, appDoc);
    expect(depts).toEqual(['ศิลปะ']);
    expect(covers(SCI, depts)).toBe(false);
  });

  it('no teachers: falls back to the subject department', () => {
    expect(resolveEntityDepartments('scheduleEntries', { subjectId: 's-sci', teacherIds: [] }, appDoc)).toEqual(['วิทยาศาสตร์']);
    expect(covers(SCI, resolveEntityDepartments('scheduleEntries', { subjectId: 's-hr' }, appDoc))).toBe(false);
  });

  it('teacher with no department on record: falls back to the subject department', () => {
    expect(resolveEntityDepartments('scheduleEntries', { subjectId: 's-sci', teacherIds: ['t-nodept'] }, appDoc)).toEqual(['วิทยาศาสตร์']);
  });

  it('nothing resolvable: [] so the caller denies', () => {
    expect(resolveEntityDepartments('scheduleEntries', { subjectId: 's-nodept', teacherIds: ['t-nodept'] }, appDoc)).toEqual([]);
    expect(covers(SCI, [])).toBe(false);
  });
});

describe('resolveEntityDepartments — other entity types unchanged', () => {
  it('teachers / subjects / teacherSubjectAssignments', () => {
    expect(resolveEntityDepartments('teachers', { department: 'ศิลปะ' }, appDoc)).toEqual(['ศิลปะ']);
    expect(resolveEntityDepartments('subjects', { id: 's-hr', department: 'กิจกรรมพัฒนาผู้เรียน' }, appDoc)).toEqual(['กิจกรรมพัฒนาผู้เรียน']);
    expect(resolveEntityDepartments('subjects', { id: 's-nodept' }, appDoc)).toEqual([]);
    expect(resolveEntityDepartments('subjects', { id: 's-sci' }, { ...appDoc, subjects: [] })).toEqual(['วิทยาศาสตร์']);
    expect(resolveEntityDepartments('teacherSubjectAssignments', { teacherId: 't-art-1' }, appDoc)).toEqual(['ศิลปะ']);
  });
});
