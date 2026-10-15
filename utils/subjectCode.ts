// Thai Ministry-of-Education style subject codes, e.g. ค33102
//   ค   = learning area / group letter
//   3   = level            (1 primary, 2 lower secondary, 3 upper secondary)
//   3   = year in level    (upper: 1,2,3 = ม.4,5,6 ; lower: 1,2,3 = ม.1,2,3)
//   1   = type             (1 basic, 2 additional; 9 = activity)
//   02  = running number

export type SubjectLevel = 'primary' | 'lower' | 'upper' | 'unknown';
export type SubjectKind = 'basic' | 'extra' | 'activity' | 'unknown';

export interface ParsedSubjectCode {
  group: string;
  level: SubjectLevel;
  year?: number;      // 1-6 (ม.)
  kind: SubjectKind;
  seq?: string;
}

export const SUBJECT_GROUP_LABELS: Record<string, string> = {
  'ท': 'ภาษาไทย',
  'ค': 'คณิตศาสตร์',
  'ว': 'วิทยาศาสตร์และเทคโนโลยี',
  'ส': 'สังคมศึกษา ศาสนา และวัฒนธรรม',
  'พ': 'สุขศึกษาและพลศึกษา',
  'ศ': 'ศิลปะ',
  'ง': 'การงานอาชีพ',
  'อ': 'ภาษาอังกฤษ',
  'จ': 'ภาษาจีน',
  'ญ': 'ภาษาญี่ปุ่น',
  'ก': 'กิจกรรมพัฒนาผู้เรียน',
};

export const UNKNOWN_GROUP = '?';

const thaiDigitsToAscii = (s: string) => s.replace(/[๐-๙]/g, d => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)));

export const parseSubjectCode = (code?: string): ParsedSubjectCode | null => {
  const c = thaiDigitsToAscii((code || '').trim());
  if (!c) return null;
  const m = /^([ก-ฮ])\s*([0-9])([0-9])([0-9])([0-9]{0,2})/.exec(c);
  if (!m) {
    // Not a standard code, but a leading ก still means activity (e.g. กก-ชน-2)
    if (c.startsWith('ก')) return { group: 'ก', level: 'unknown', kind: 'activity' };
    return null;
  }
  const [, group, d1, d2, d3, seq] = m;
  const level: SubjectLevel = d1 === '1' ? 'primary' : d1 === '2' ? 'lower' : d1 === '3' ? 'upper' : 'unknown';
  const yearInLevel = Number(d2);
  let year: number | undefined;
  if (level === 'lower' && yearInLevel >= 1 && yearInLevel <= 3) year = yearInLevel;
  else if (level === 'upper' && yearInLevel >= 1 && yearInLevel <= 3) year = yearInLevel + 3;
  else if (level === 'primary' && yearInLevel >= 1 && yearInLevel <= 6) year = yearInLevel;
  let kind: SubjectKind = d3 === '1' ? 'basic' : d3 === '2' ? 'extra' : d3 === '9' ? 'activity' : 'unknown';
  if (group === 'ก') kind = 'activity';
  return { group, level, year, kind, seq };
};

/** "M.4/1" -> "ม.4/1", "P.2" -> "ป.2" (display only) */
export const thaiGradeName = (name?: string): string =>
  (name || '').replace(/^\s*M\./i, 'ม.').replace(/^\s*P\./i, 'ป.');

/** Level from a grade-level name like "M.4/1" / "ม.2" */
export const levelFromGradeName = (name?: string): SubjectLevel => {
  const m = /^\s*([MmPpมป])\.?\s*(\d)/.exec(name || '');
  if (!m) return 'unknown';
  const n = Number(m[2]);
  if (/[Pปp]/.test(m[1])) return 'primary';
  return n <= 3 ? 'lower' : 'upper';
};
