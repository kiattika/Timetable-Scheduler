import { OrganizationSettings, Teacher, PhysicalRoom, GradeLevel, DayOfWeek } from '../types';

export interface CalendarSyncOptions {
  teacher: Teacher;
  physicalRoom?: PhysicalRoom;
  gradeLevel?: GradeLevel;
  orgSettings: OrganizationSettings;
  timetableData: {
    subjectName: string;
    dayOfWeek: DayOfWeek;
    startTime: string; // e.g. '08:30'
    endTime: string;   // e.g. '09:20'
  };
}

const JS_DAY_MAP: Record<DayOfWeek, number> = {
  [DayOfWeek.Sunday]: 0,
  [DayOfWeek.Monday]: 1,
  [DayOfWeek.Tuesday]: 2,
  [DayOfWeek.Wednesday]: 3,
  [DayOfWeek.Thursday]: 4,
  [DayOfWeek.Friday]: 5,
  [DayOfWeek.Saturday]: 6,
};
  
const getNextDayOfWeek = (startDateStr: string, dayOfWeek: DayOfWeek) => {
  const date = new Date(`${startDateStr}T00:00:00`);
  const targetJSDate = JS_DAY_MAP[dayOfWeek];
  while (date.getDay() !== targetJSDate) {
    date.setDate(date.getDate() + 1);
  }
  return date;
};

export const generateCalendarSyncData = (options: CalendarSyncOptions) => {
  const { teacher, physicalRoom, gradeLevel, orgSettings, timetableData } = options;

  let semesterStart = orgSettings.semesterStartDate;
  let semesterEnd = orgSettings.semesterEndDate;
  const holidays = orgSettings.schoolHolidays?.split('\n').map(h => h.trim()).filter(h => h !== '') || [];

  if (!semesterStart || !semesterEnd) {
    throw new Error('กรุณาตั้งค่า วันเปิดภาคเรียน และ วันปิดภาคเรียน ในหน้าตั้งค่าองค์กรก่อนทำการซิงค์ (Please set semester start and end dates in org settings first)');
  }
  
  const endLimit = new Date(`${semesterEnd}T23:59:59`);
  const untilDate = endLimit.toISOString().replace(/[-:]/g, "").split('.')[0] + "Z";
  
  const firstOccurrence = getNextDayOfWeek(semesterStart, timetableData.dayOfWeek);
  
  if (firstOccurrence > endLimit) {
      throw new Error('First occurrence of class is after the semester ends.');
  }

  const startTimeSplit = timetableData.startTime.split(':');
  const endTimeSplit = timetableData.endTime.split(':');

  const startEventStr = `${firstOccurrence.toISOString().split('T')[0]}T${startTimeSplit[0].padStart(2, '0')}:${startTimeSplit[1].padStart(2, '0')}:00`;
  const endEventStr = `${firstOccurrence.toISOString().split('T')[0]}T${endTimeSplit[0].padStart(2, '0')}:${endTimeSplit[1].padStart(2, '0')}:00`;

  const attendees = [];
  if (teacher.email) {
    attendees.push({ email: teacher.email });
  }
  if (gradeLevel?.groupEmail) {
    attendees.push({ email: gradeLevel.groupEmail });
  }

  const rrule = `FREQ=WEEKLY;UNTIL=${untilDate}`;
  
  const recurrenceRules = [`RRULE:${rrule}`];
  
  // Calculate EXDATEs for holidays that fall on the dayOfWeek
  if (holidays.length > 0) {
      const exdates = holidays.map(holiday => {
          const hDate = new Date(`${holiday}T00:00:00`);
          if (hDate.getDay() === JS_DAY_MAP[timetableData.dayOfWeek]) {
             return `${hDate.toISOString().split('T')[0].replace(/-/g, '')}T${startTimeSplit[0].padStart(2, '0')}${startTimeSplit[1].padStart(2, '0')}00`;
          }
          return null;
      }).filter(Boolean);
      
      if (exdates.length > 0) {
          recurrenceRules.push(`EXDATE;TZID=Asia/Bangkok:${exdates.join(',')}`);
      }
  }

  const payload = {
    summary: `ตารางสอน: ${timetableData.subjectName}`,
    location: physicalRoom?.name || '',
    description: `ตารางสอนที่ถูกสร้างอัตโนมัติจากระบบ`,
    start: {
      dateTime: startEventStr,
      timeZone: 'Asia/Bangkok'
    },
    end: {
      dateTime: endEventStr,
      timeZone: 'Asia/Bangkok'
    },
    recurrence: recurrenceRules,
    attendees
  };

  return payload;
};
