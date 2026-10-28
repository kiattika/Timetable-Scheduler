/**
 * Teacher-Subject Links: when a subject is chosen first, the teachers who are homeroom advisors of the
 * levels the subject is open to (e.g. a club for M.5 -> advisors of M.5/1 … M.5/n) are listed first.
 */
import type { GradeLevel, Subject, Teacher } from '../types';
import { getChildGradeLevelIds } from '../components/scheduleUtils';

export interface TeacherRanking {
  /** advisor teachers of the subject's levels -> short class label(s), e.g. "M.5/3" */
  advisorLabels: Map<string, string>;
  /** level names, for the group heading (e.g. "M.5") */
  levelNames: string[];
}

export const rankTeachersForSubject = (
  teachers: Teacher[],
  subject: Pick<Subject, 'applicableParentGradeLevelIds'> | undefined | null,
  gradeLevels: GradeLevel[],
): TeacherRanking => {
  const advisorLabels = new Map<string, string>();
  const parents = subject?.applicableParentGradeLevelIds || [];
  if (parents.length === 0) return { advisorLabels, levelNames: [] };
  const classIds = new Set<string>();
  parents.forEach(pid => { classIds.add(pid); getChildGradeLevelIds(pid, gradeLevels).forEach(c => classIds.add(c)); });
  const nameOf = (id: string) => gradeLevels.find(g => g.id === id)?.name || id;
  for (const t of teachers) {
    const mine = (t.homeroomGradeLevelIds || []).filter(id => classIds.has(id));
    if (mine.length > 0) advisorLabels.set(t.id, mine.map(nameOf).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', '));
  }
  return { advisorLabels, levelNames: parents.map(nameOf) };
};
