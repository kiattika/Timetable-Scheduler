/**
 * Turns "fixed activities" reserved on a period (e.g. clubs on Thursday P7-8, scouts, cleaning zone) into
 * timetable entries. Pure: takes data, returns the entries to add and what was skipped (with reasons).
 *
 * Mirrors how the schedule modal places each kind of subject:
 *  - level-wide (isBroadAssignment): ONE entry on the parent grade, teachers = linked teachers, no room
 *  - teacher-only: ONE 'Non-Student' entry per day, teachers = linked teachers (it shows in each teacher's timetable),
 *    plus a read-only "reserved" cell on the class timetables (reservedActivityLabelsForCell)
 *  - everything else: one entry per class room, teachers = that class's linked teachers
 *    (homeroom/advisory subjects: the class's homeroom teachers), room = the class's homeroom room if any
 */
import type { DayOfWeek, FixedActivity, GradeLevel, PeriodSetting, ScheduleEntry, Subject, Teacher, TeacherSubjectAssignment } from '../types';
import { getChildGradeLevelIds, isSharable } from '../components/scheduleUtils';

export interface FixedActivitySkip {
  activityId: string;
  subjectId: string;
  gradeLevelId: string;
  day: DayOfWeek;
  period: number;
  reason: 'no_teacher' | 'slot_taken' | 'teachers_busy' | 'subject_missing';
  /** teachers_busy: who is busy and with which timetable entry */
  busy?: { teacherId: string; subjectId: string; gradeLevelId: string }[];
  /** slot_taken: the entry already in that class's slot */
  blocker?: { subjectId: string; gradeLevelId: string };
  /** teachers_busy: how many linked teachers were still free (0 = whole entry skipped) */
  freeCount?: number;
}

export interface FixedActivityPlan {
  entries: ScheduleEntry[];
  skipped: FixedActivitySkip[];
  /** ids of earlier generated entries that this run replaces */
  replacedIds: string[];
}

export const planFixedActivityEntries = (args: {
  periodSettings: PeriodSetting[];
  subjects: Subject[];
  teachers: Teacher[];
  gradeLevels: GradeLevel[];
  links: TeacherSubjectAssignment[];
  existing: ScheduleEntry[];
  newId?: () => string;
}): FixedActivityPlan => {
  const { periodSettings, subjects, teachers, gradeLevels, links, existing } = args;
  const newId = args.newId || (() => crypto.randomUUID());

  const activityIds = new Set<string>();
  periodSettings.forEach(p => (p.fixedActivities || []).forEach(a => activityIds.add(a.id)));
  // Re-running replaces what an earlier run generated for these activities (manual entries are never touched).
  const replacedIds = existing.filter(e => e.fixedActivityId && activityIds.has(e.fixedActivityId)).map(e => e.id);
  const replaced = new Set(replacedIds);
  const base = existing.filter(e => !replaced.has(e.id));

  const entries: ScheduleEntry[] = [];
  const skipped: FixedActivitySkip[] = [];
  const all = () => [...base, ...entries];
  const gradeById = new Map(gradeLevels.map(g => [g.id, g]));

  const teacherBusy = (tid: string, day: DayOfWeek, period: number) =>
    all().some(e => e.day === day && e.period === period && (e.teacherIds || []).includes(tid));
  const gradeTaken = (gid: string, day: DayOfWeek, period: number, withChildren: boolean) => {
    const ids = new Set([gid, ...(withChildren ? getChildGradeLevelIds(gid, gradeLevels) : [])]);
    return all().find(e => e.day === day && e.period === period && ids.has(e.gradeLevelId));
  };
  const busyList = (tids: string[], day: DayOfWeek, period: number) => {
    const out: NonNullable<FixedActivitySkip['busy']> = [];
    for (const tid of tids) {
      const e = all().find(x => x.day === day && x.period === period && (x.teacherIds || []).includes(tid));
      if (e) out.push({ teacherId: tid, subjectId: e.subjectId, gradeLevelId: e.gradeLevelId });
    }
    return out;
  };
  const handledTeacherOnly = new Set<string>();

  periodSettings.forEach((ps, period) => {
    (ps.fixedActivities || []).forEach((act: FixedActivity) => {
      const subject = subjects.find(s => s.id === act.subjectId);
      for (const day of act.days) {
        for (const parentId of act.gradeLevelIds) {
          const skip = (reason: FixedActivitySkip['reason'], gradeLevelId: string, extra: Partial<FixedActivitySkip> = {}) =>
            skipped.push({ activityId: act.id, subjectId: act.subjectId, gradeLevelId, day, period, reason, ...extra });
          if (!subject) { skip('subject_missing', parentId); continue; }

          const linkedTeachers = (gradeIds: string[]) => {
            const set = new Set<string>();
            links.forEach(l => { if (l.subjectId === subject.id && gradeIds.includes(l.gradeLevelId)) set.add(l.teacherId); });
            return [...set];
          };
          const usable = (ids: string[]) => ids.filter(t => !teacherBusy(t, day, period));
          const mk = (gradeLevelId: string, teacherIds: string[], room: string): ScheduleEntry => ({
            id: newId(), gradeLevelId, day, period, subjectId: subject.id, teacherIds,
            physicalRoomId: room, fixedActivityId: act.id,
          });

          if (subject.type === 'TEACHER_ONLY') {
            // New links use 'Non-Student'; older ones were made per classroom, so accept those of the ticked levels too.
            // The entry is per activity/day, so it is planned (and reported) once however many levels were ticked.
            const doneKey = `${act.id}|${day}`;
            if (handledTeacherOnly.has(doneKey)) continue;
            handledTeacherOnly.add(doneKey);
            const t = linkedTeachers(['Non-Student', ...act.gradeLevelIds.flatMap(g => [g, ...getChildGradeLevelIds(g, gradeLevels)])]);
            const ok = usable(t);
            const busy = busyList(t.filter(x => !ok.includes(x)), day, period);
            if (t.length === 0) { skip('no_teacher', 'Non-Student'); }
            else if (ok.length === 0) { skip('teachers_busy', 'Non-Student', { busy, freeCount: 0 }); }
            else {
              if (ok.length < t.length) skip('teachers_busy', 'Non-Student', { busy, freeCount: ok.length });
              // one entry per activity/day is enough no matter how many levels were ticked; it shows in every linked teacher's timetable
              if (!entries.some(e => e.fixedActivityId === act.id && e.day === day && e.gradeLevelId === 'Non-Student')) {
                entries.push(mk('Non-Student', ok, ''));
              }
            }
            continue;
          }

          const children = getChildGradeLevelIds(parentId, gradeLevels);
          if (subject.isBroadAssignment) {
            const t = linkedTeachers([parentId, ...children]);
            const ok = usable(t);
            const taken = gradeTaken(parentId, day, period, true);
            if (taken) skip('slot_taken', parentId, { blocker: { subjectId: taken.subjectId, gradeLevelId: taken.gradeLevelId } });
            else if (t.length === 0) skip('no_teacher', parentId);
            else if (ok.length === 0) skip('teachers_busy', parentId, { busy: busyList(t, day, period), freeCount: 0 });
            else entries.push(mk(parentId, ok, ''));
            continue;
          }

          for (const classId of children.length > 0 ? children : [parentId]) {
            const grade = gradeById.get(classId);
            const t = subject.isHomeroomAdvisorySubject
              ? teachers.filter(x => (x.homeroomGradeLevelIds || []).includes(classId)).map(x => x.id)
              : linkedTeachers([classId]);
            const ok = usable(t);
            const taken = gradeTaken(classId, day, period, false);
            if (taken) { skip('slot_taken', classId, { blocker: { subjectId: taken.subjectId, gradeLevelId: taken.gradeLevelId } }); continue; }
            if (t.length === 0) { skip('no_teacher', classId); continue; }
            if (ok.length === 0) { skip('teachers_busy', classId, { busy: busyList(t, day, period), freeCount: 0 }); continue; }
            const room = !isSharable(subject) && grade?.homeroomPhysicalRoomId ? grade.homeroomPhysicalRoomId : '';
            entries.push(mk(classId, ok, room));
          }
        }
      }
    });
  });

  return { entries, skipped, replacedIds };
};

/**
 * Teacher-only fixed activities covering a class on a day. They have no class entry (they live in the teachers'
 * timetables), so the class timetable shows a read-only "reserved" cell built from these names.
 */
export const reservedActivityLabelsForCell = (
  period: PeriodSetting | undefined | null,
  day: DayOfWeek,
  gradeLevelId: string,
  gradeLevels: GradeLevel[],
  subjects: Subject[],
): string[] => {
  const out: string[] = [];
  for (const a of period?.fixedActivities || []) {
    if (!a.days.includes(day)) continue;
    const subject = subjects.find(s => s.id === a.subjectId);
    if (!subject || subject.type !== 'TEACHER_ONLY') continue;
    const covered = a.gradeLevelIds.some(pid => pid === gradeLevelId || getChildGradeLevelIds(pid, gradeLevels).includes(gradeLevelId));
    if (covered) out.push(subject.name);
  }
  return out;
};
