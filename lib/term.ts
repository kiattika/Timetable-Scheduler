/** Suggested next term: 1/Y -> 2/Y, 2/Y -> 1/(Y+1), anything else -> 1/(Y+1). Year left blank if not numeric. */
export const suggestNextTerm = (semester?: string, academicYear?: string): { semester: string; academicYear: string } => {
  const sem = (semester || '').trim();
  const year = (academicYear || '').trim();
  const y = /^\d{4}$/.test(year) ? Number(year) : null;
  if (sem === '1') return { semester: '2', academicYear: y !== null ? String(y) : '' };
  return { semester: '1', academicYear: y !== null ? String(y + 1) : '' };
};
