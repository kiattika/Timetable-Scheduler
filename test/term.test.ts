import { describe, it, expect } from 'vitest';
import { suggestNextTerm } from '../lib/term';
import { mergeOrgChanges } from '../functions/src/orgWrites';

describe('suggestNextTerm', () => {
  it('1/Y -> 2/Y, 2/Y -> 1/(Y+1), other -> 1/(Y+1)', () => {
    expect(suggestNextTerm('1', '2569')).toEqual({ semester: '2', academicYear: '2569' });
    expect(suggestNextTerm('2', '2569')).toEqual({ semester: '1', academicYear: '2570' });
    expect(suggestNextTerm('Summer', '2569')).toEqual({ semester: '1', academicYear: '2570' });
  });
  it('leaves the year blank when the current one is not a 4-digit number', () => {
    expect(suggestNextTerm('1', '')).toEqual({ semester: '2', academicYear: '' });
    expect(suggestNextTerm(undefined, 'abc')).toEqual({ semester: '1', academicYear: '' });
  });
});

describe('mergeOrgChanges — retired term-date settings', () => {
  it('drops semesterStartDate / semesterEndDate / schoolHolidays from the main doc on the next commit', () => {
    const server = { organizationSettings: { name: 'UTD', semester: '2', semesterStartDate: '2026-05-16', schoolHolidays: 'x' } };
    const { updates } = mergeOrgChanges(server, { teachers: { upsert: [{ id: 't1' }] } }, 'manager');
    expect(updates.organizationSettings).toEqual({ name: 'UTD', semester: '2' });
  });
  it('ignores the retired keys if an old client still sends them, and sets the new term with the reset', () => {
    const server = { organizationSettings: { name: 'UTD', semester: '2', academicYear: '2569', isLocked: true } };
    const { updates } = mergeOrgChanges(
      server,
      { organizationSettings: { set: { isLocked: false, semester: '1', academicYear: '2570', semesterEndDate: '2027-03-31' } } },
      'admin',
    );
    expect(updates.organizationSettings).toEqual({ name: 'UTD', semester: '1', academicYear: '2570', isLocked: false });
  });
});
