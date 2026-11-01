/**
 * Teacher-load report: is a subject an "activity" (กิจกรรม) rather than a main subject?
 * Subjects whose code starts with ส (Social Studies: สxxxxx, e.g. ส30224 การป้องกันการทุจริต) are always main
 * subjects, whatever their name says. Otherwise it is decided by the homeroom flag or keywords in the name.
 */
const ACTIVITY_KEYWORDS = ['กิจกรรม', 'ลูกเสือ', 'เนตรนารี', 'ยุวกาชาด', 'แนะแนว', 'ชุมนุม', 'สาธารณประโยชน์', 'บำเพ็ญประโยชน์', 'โฮมรูม', 'homeroom', 'plc', 'ป้องกันการทุจริต', 'ทุจริต', 'จริยธรรม', 'cleaning zone', 'cleaning'];
// Subject codes that are always activities (Cleaning Zone, Homeroom, PLC)
const ACTIVITY_CODES = new Set(['CZ', 'HR', 'PLC']);

/**
 * Rules decided by the subject CODE alone, shared by the load report and the Information screen:
 * ส… is never an activity, CZ / HR / PLC always are. undefined = decide by the other rules.
 */
export const activityByCode = (subject?: { subjectCode?: string } | null): boolean | undefined => {
  const code = (subject?.subjectCode || '').trim();
  if (code.startsWith('ส')) return false;
  if (ACTIVITY_CODES.has(code.toUpperCase())) return true;
  return undefined;
};

export const isActivitySubject = (subject?: { name?: string; subjectCode?: string; isHomeroomAdvisorySubject?: boolean } | null): boolean => {
  if (!subject || !subject.name) return false;
  const byCode = activityByCode(subject);
  if (byCode !== undefined) return byCode;
  if (subject.isHomeroomAdvisorySubject) return true;
  const lowerName = subject.name.toLowerCase();
  return ACTIVITY_KEYWORDS.some(kw => lowerName.includes(kw));
};
