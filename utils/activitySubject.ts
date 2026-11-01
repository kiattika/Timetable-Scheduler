/**
 * Teacher-load report: is a subject an "activity" (กิจกรรม) rather than a main subject?
 * Subjects whose code starts with ส (Social Studies: สxxxxx, e.g. ส30224 การป้องกันการทุจริต) are always main
 * subjects, whatever their name says. Otherwise it is decided by the homeroom flag or keywords in the name.
 */
const ACTIVITY_KEYWORDS = ['กิจกรรม', 'ลูกเสือ', 'เนตรนารี', 'ยุวกาชาด', 'แนะแนว', 'ชุมนุม', 'สาธารณประโยชน์', 'บำเพ็ญประโยชน์', 'โฮมรูม', 'homeroom', 'plc', 'ป้องกันการทุจริต', 'ทุจริต', 'จริยธรรม'];

export const isActivitySubject = (subject?: { name?: string; subjectCode?: string; isHomeroomAdvisorySubject?: boolean } | null): boolean => {
  if (!subject || !subject.name) return false;
  if ((subject.subjectCode || '').trim().startsWith('ส')) return false;
  if (subject.isHomeroomAdvisorySubject) return true;
  const lowerName = subject.name.toLowerCase();
  return ACTIVITY_KEYWORDS.some(kw => lowerName.includes(kw));
};
