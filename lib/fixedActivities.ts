/**
 * Turns "fixed activities" reserved on a period (e.g. clubs on Thursday P7-8, scouts, cleaning zone) into
 * timetable entries. Pure: takes data, returns the entries to add and what was skipped (with reasons).
 *
 * Mirrors how the schedule modal places each kind of subject:
 *  - level-wide (isBroadAssignment): ONE entry on the parent grade, teachers = linked teachers, no room
 *  - teacher-only: ONE 'Non-Student' entry, teachers = linked teachers, no room
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
  detail?: string;
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
    return all().some(e => e.day === day && e.period === period && ids.has(e.gradeLevelId));
  };

  periodSettings.forEach((ps, period) => {
    (ps.fixedActivities || []).forEach((act: FixedActivity) => {
      const subject = subjects.find(s => s.id === act.subjectId);
      for (const day of act.days) {
        for (const parentId of act.gradeLevelIds) {
          const skip = (reason: FixedActivitySkip['reason'], gradeLevelId: string, detail?: string) =>
            skipped.push({ activityId: act.id, subjectId: act.subjectId, gradeLevelId, day, period, reason, detail });
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
            const t = linkedTeachers(['Non-Student', ...act.gradeLevelIds.flatMap(g => [g, ...getChildGradeLevelIds(g, gradeLevels)])]);
            const ok = usable(t);
            if (t.length === 0) { skip('no_teacher', 'Non-Student'); }
            else if (ok.length === 0) { skip('teachers_busy', 'Non-Student'); }
            else {
              if (ok.length < t.length) skip('teachers_busy', 'Non-Student', `${t.length - ok.length}`);
              // one entry per activity/day is enough no matter how many grades were ticked
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
            if (gradeTaken(parentId, day, period, true)) skip('slot_taken', parentId);
            else if (t.length === 0) skip('no_teacher', parentId);
            else if (ok.length === 0) skip('teachers_busy', parentId);
            else entries.push(mk(parentId, ok, ''));
            continue;
          }

          for (const classId of children.length > 0 ? children : [parentId]) {
            const grade = gradeById.get(classId);
            const t = subject.isHomeroomAdvisorySubject
              ? teachers.filter(x => (x.homeroomGradeLevelIds || []).includes(classId)).map(x => x.id)
              : linkedTeachers([classId]);
            const ok = usable(t);
            if (gradeTaken(classId, day, period, false)) { skip('slot_taken', classId); continue; }
            if (t.length === 0) { skip('no_teacher', classId); continue; }
            if (ok.length === 0) { skip('teachers_busy', classId); continue; }
            const room = !isSharable(subject) && grade?.homeroomPhysicalRoomId ? grade.homeroomPhysicalRoomId : '';
            entries.push(mk(classId, ok, room));
          }
        }
      }
    });
  });

  return { entries, skipped, replacedIds };
};
