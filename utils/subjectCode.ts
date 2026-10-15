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

/**
 * Sub-group inside a learning area. The code letter is the same for e.g. ฟิสิกส์/เคมี/ชีววิทยา,
 * so the sub-group is recognised from the subject NAME. First matching rule wins.
 */
const SUBGROUP_RULES: Record<string, { label: string; re: RegExp }[]> = {
  'ว': [
    { label: 'ฟิสิกส์', re: /ฟิสิกส์/ },
    { label: 'เคมี', re: /เคมี/ },
    { label: 'ชีววิทยา', re: /ชีววิทยา|ชีวะ/ },
    { label: 'โลก ดาราศาสตร์ และอวกาศ', re: /ดาราศาสตร์|อวกาศ|โลก/ },
    { label: 'เทคโนโลยี (คอมพิวเตอร์/วิทยาการคำนวณ/การออกแบบ)', re: /เทคโนโลยี|คอมพิวเตอร์|วิทยาการคำนวณ|การออกแบบ|โปรแกรม|หุ่นยนต์|ดิจิทัล/ },
    { label: 'วิทยาศาสตร์กายภาพ', re: /กายภาพ/ },
    { label: 'วิทยาศาสตร์ชีวภาพ', re: /ชีวภาพ/ },
  ],
  'ศ': [
    { label: 'ดนตรีไทย', re: /ดนตรีไทย/ },
    { label: 'ดนตรีสากล', re: /ดนตรีสากล|ดนตรี/ },
    { label: 'นาฏศิลป์', re: /นาฏศิลป/ },
    { label: 'ทัศนศิลป์', re: /ทัศนศิลป|ศิลปะ|วาด|ปั้น/ },
  ],
  'พ': [
    { label: 'สุขศึกษาและพลศึกษา', re: /สุขศึกษาและพลศึกษา|สุขศึกษา.*พลศึกษา/ },
    { label: 'พลศึกษา', re: /พลศึกษา|กีฬา|ฟุตบอล|บาสเกตบอล|วอลเลย์บอล|แบดมินตัน|ว่ายน้ำ/ },
    { label: 'สุขศึกษา', re: /สุขศึกษา/ },
  ],
  'ง': [
    { label: 'คหกรรม', re: /คหกรรม|อาหาร|ตัดเย็บ|เสื้อผ้า/ },
    { label: 'เกษตรกรรม', re: /เกษตร|พืช|สัตว์|ปลูก/ },
    { label: 'อุตสาหกรรม', re: /อุตสาหกรรม|ช่าง|ไฟฟ้า|อิเล็กทรอนิกส์|ยนต์|เครื่องกล/ },
  ],
  'ก': [
    { label: 'ลูกเสือ-เนตรนารี-ยุวกาชาด', re: /ลูกเสือ|เนตรนารี|ยุวกาชาด|ผู้บำเพ็ญ/ },
    { label: 'ชุมนุม', re: /ชุมนุม/ },
    { label: 'แนะแนว', re: /แนะแนว/ },
    { label: 'โฮมรูม', re: /โฮมรูม|homeroom/i },
    { label: 'กิจกรรมเพื่อสังคมและสาธารณประโยชน์', re: /สาธารณประโยชน์|บำเพ็ญประโยชน์|เพื่อสังคม/ },
  ],
};

export const subGroupOf = (group: string, subjectName?: string): string => {
  const name = subjectName || '';
  const hit = (SUBGROUP_RULES[group] || []).find(r => r.re.test(name));
  if (hit) return hit.label;
  return group === 'ว' ? 'วิทยาศาสตร์ทั่วไป' : 'ทั่วไป/อื่นๆ';
};
