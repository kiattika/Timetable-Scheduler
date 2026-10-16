import { describe, it, expect } from 'vitest';
import { isSubjectFlagLocked, normalizeSubjectFlags } from '../utils/subjectFlags';

describe('subject flag rules', () => {
  it('teacher-only locks all four special flags', () => {
    const it0 = { type: 'TEACHER_ONLY', isBroadAssignment: true, isHomeroomAdvisorySubject: true, allowPhysicalRoomSharing: true, autoLinkToHomeroomTeachers: true };
    expect(normalizeSubjectFlags(it0)).toMatchObject({ isBroadAssignment: false, isHomeroomAdvisorySubject: false, allowPhysicalRoomSharing: false, autoLinkToHomeroomTeachers: false });
  });
  it('student-only locks homeroom and auto-link but keeps Broad and room sharing', () => {
    const n = normalizeSubjectFlags({ type: 'STUDENT_ONLY', isBroadAssignment: true, isHomeroomAdvisorySubject: true, allowPhysicalRoomSharing: true, autoLinkToHomeroomTeachers: true });
    expect(n).toMatchObject({ isBroadAssignment: true, isHomeroomAdvisorySubject: false, allowPhysicalRoomSharing: true, autoLinkToHomeroomTeachers: false });
  });
  it('auto-link needs Homeroom or Broad', () => {
    expect(isSubjectFlagLocked({ type: 'STANDARD' }, 'autoLinkToHomeroomTeachers')).toBe(true);
    expect(isSubjectFlagLocked({ type: 'STANDARD', isBroadAssignment: true }, 'autoLinkToHomeroomTeachers')).toBe(false);
    expect(normalizeSubjectFlags({ type: 'STANDARD', autoLinkToHomeroomTeachers: true }).autoLinkToHomeroomTeachers).toBe(false);
  });
  it('standard subjects are untouched', () => {
    const s = { type: 'STANDARD', isBroadAssignment: true, autoLinkToHomeroomTeachers: true, allowPhysicalRoomSharing: true, isHomeroomAdvisorySubject: true };
    expect(normalizeSubjectFlags(s)).toEqual(s);
  });
});

import { parseSubjectType } from '../utils/subjectFlags';

describe('parseSubjectType', () => {
  it('accepts enum, Thai and loose English wording', () => {
    expect(parseSubjectType('STANDARD')).toBe('STANDARD');
    expect(parseSubjectType('ปกติ')).toBe('STANDARD');
    expect(parseSubjectType('เฉพาะครู')).toBe('TEACHER_ONLY');
    expect(parseSubjectType('teacher-only')).toBe('TEACHER_ONLY');
    expect(parseSubjectType('เฉพาะนักเรียน')).toBe('STUDENT_ONLY');
    expect(parseSubjectType('STUDENT_ONLY')).toBe('STUDENT_ONLY');
  });
  it('returns undefined for blank or unknown', () => {
    expect(parseSubjectType('')).toBeUndefined();
    expect(parseSubjectType('อะไรก็ไม่รู้')).toBeUndefined();
  });
});
