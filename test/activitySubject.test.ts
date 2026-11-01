import { describe, it, expect } from 'vitest';
import { isActivitySubject } from '../utils/activitySubject';

describe('isActivitySubject', () => {
  it('ส-coded subjects are never activities, even with an activity keyword in the name', () => {
    expect(isActivitySubject({ name: 'การป้องกันการทุจริต', subjectCode: 'ส30224' })).toBe(false);
    expect(isActivitySubject({ name: 'หน้าที่พลเมือง จริยธรรม', subjectCode: 'ส31101' })).toBe(false);
    expect(isActivitySubject({ name: 'กิจกรรมสังคม', subjectCode: ' ส20201' })).toBe(false);
  });
  it('other subjects keep the old rule', () => {
    expect(isActivitySubject({ name: 'กิจกรรมชุมนุม/นศท', subjectCode: 'ก32908' })).toBe(true);
    expect(isActivitySubject({ name: 'PLC', subjectCode: 'PLC' })).toBe(true);
    expect(isActivitySubject({ name: 'HomeRoom', subjectCode: 'HR', isHomeroomAdvisorySubject: true })).toBe(true);
    expect(isActivitySubject({ name: 'คณิตศาสตร์เพิ่มเติม', subjectCode: 'ค32202' })).toBe(false);
    expect(isActivitySubject({ name: 'ป้องกันการทุจริต', subjectCode: 'ก30224' })).toBe(true);
  });
  it('handles missing subject or name', () => {
    expect(isActivitySubject(undefined)).toBe(false);
    expect(isActivitySubject({ subjectCode: 'ส30224' })).toBe(false);
  });
});
