import { getAccessToken } from './firebase';
import { AppData } from '../types';
import { generateCalendarSyncData } from '../utils/googleCalendarSync';

export const exportToGoogleCalendar = async (
  appData: AppData,
  teacherIdsToExport: string[],
  startDate: string,
  endDate: string,
  onProgress?: (msg: string) => void
) => {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated to Google Calendar");

  const teachers = appData.teachers.filter(t => teacherIdsToExport.length === 0 || teacherIdsToExport.includes(t.id));

  for (let i = 0; i < teachers.length; i++) {
    const teacher = teachers[i];
    if (onProgress) onProgress(`Syncing teacher ${i + 1} of ${teachers.length}: ${teacher.name}...`);

    const teacherEntries = appData.scheduleEntries.filter(entry => entry.teacherIds.includes(teacher.id));
    const events = [];

    for (const entry of teacherEntries) {
      const subject = appData.subjects.find(s => s.id === entry.subjectId);
      const grade = appData.gradeLevels.find(g => g.id === entry.gradeLevelId);
      const room = appData.physicalRooms.find(c => c.id === entry.physicalRoomId);
      const period = appData.periodSettings[entry.period];
      
      if (!subject || !grade || !appData.organizationSettings || !period) continue;

      const eventBody = generateCalendarSyncData({
        teacher,
        physicalRoom: room,
        orgSettings: appData.organizationSettings,
        timetableData: {
          subjectName: `${subject.name} (${grade.name})`,
          dayOfWeek: entry.day,
          startTime: period.startTime,
          endTime: period.endTime,
        }
      });
      events.push(eventBody);
    }

    if (events.length > 0) {
      const response = await fetch('/api/workspace/calendar/sync-teachers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-User-Email': appData.currentUser?.email || '',
          'X-User-Role': appData.currentUser?.role || ''
        },
        body: JSON.stringify({
          teacherEmail: teacher.email,
          events: events,
          academicYear: appData.organizationSettings?.academicYear,
          semesterEndDate: endDate
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to sync teacher ${teacher.name}`);
      }
    }
  }
};
