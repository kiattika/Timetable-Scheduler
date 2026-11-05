import { GradeLevel, ScheduleEntry } from '../types';
import { getChildGradeLevelIds, getParentGradeLevelId } from '../components/scheduleUtils';

/** Classes that can be combined with `gradeLevelId`: its sibling classrooms under the same parent level. */
export const combinableGradeIds = (gradeLevelId: string | undefined, gradeLevels: GradeLevel[]): string[] => {
  if (!gradeLevelId || gradeLevelId === 'Non-Student') return [];
  const parentId = getParentGradeLevelId(gradeLevelId, gradeLevels);
  if (!parentId) return [];
  return getChildGradeLevelIds(parentId, gradeLevels).filter(id => id !== gradeLevelId);
};

/** Other classes sharing this entry's lesson in the same slot. */
export const coGradeIdsOf = (entry: ScheduleEntry, entries: ScheduleEntry[]): string[] => {
  if (!entry.combinedGroupId) return [];
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.combinedGroupId === entry.combinedGroupId && e.day === entry.day && e.period === entry.period && e.gradeLevelId !== entry.gradeLevelId) {
      ids.add(e.gradeLevelId);
    }
  }
  return Array.from(ids);
};

/** Copies of `primaries` for every extra class. Blocks get their own blockId per class; all copies share `groupId`. */
export const buildCombinedMirrors = (
  primaries: ScheduleEntry[],
  extraGradeIds: string[],
  groupId: string,
  newId: () => string,
): ScheduleEntry[] => {
  const out: ScheduleEntry[] = [];
  for (const gid of extraGradeIds) {
    const blockMap = new Map<string, string>();
    for (const p of primaries) {
      let blockId = p.blockId;
      if (blockId) {
        if (!blockMap.has(blockId)) blockMap.set(blockId, newId());
        blockId = blockMap.get(blockId);
      }
      out.push({ ...p, id: newId(), gradeLevelId: gid, blockId, combinedGroupId: groupId });
    }
  }
  return out;
};

/** One entry per combined lesson (per slot); use for anything counted per teacher or per room. */
export const dedupeCombinedEntries = <T extends ScheduleEntry>(entries: T[]): T[] => {
  const seen = new Set<string>();
  return entries.filter(e => {
    if (!e.combinedGroupId) return true;
    const k = `${e.combinedGroupId}|${e.day}|${e.period}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** "ม.6/1, ม.6/2" for a combined lesson; undefined when the entry is not combined. */
export const combinedGradeLabel = (entry: ScheduleEntry, entries: ScheduleEntry[], gradeLevels: GradeLevel[]): string | undefined => {
  if (!entry.combinedGroupId) return undefined;
  const ids = new Set([entry.gradeLevelId, ...coGradeIdsOf(entry, entries)]);
  const names = gradeLevels.filter(g => ids.has(g.id)).map(g => g.name);
  return names.length > 1 ? names.join(', ') : undefined;
};

/** Display info whose class name lists every class of a combined lesson. */
export const withCombinedGrade = <D extends { gradeLevel?: GradeLevel }>(
  display: D, entry: ScheduleEntry, entries: ScheduleEntry[], gradeLevels: GradeLevel[],
): D => {
  const label = combinedGradeLabel(entry, entries, gradeLevels);
  if (!label || !display.gradeLevel) return display;
  return { ...display, gradeLevel: { ...display.gradeLevel, name: label } };
};
