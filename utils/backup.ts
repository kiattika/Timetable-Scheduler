import { AppData, ActivityLog } from '../types';
import { pruneActivityLogs } from '../api';

export interface BackupEnvelope {
  backupVersion: number;
  timestamp: string;
  schoolName: string;
  academicTerm: string;
  summary: {
    teachersCount: number;
    subjectsCount: number;
    gradeLevelsCount: number;
    physicalRoomsCount: number;
    departmentsCount: number;
    resourceTypesCount: number;
    periodSettingsCount: number;
    teacherSubjectAssignmentsCount: number;
    scheduleEntriesCount: number;
    usersCount: number;
  };
  organizationSettings: AppData['organizationSettings'];
  data: {
    teachers: AppData['teachers'];
    subjects: AppData['subjects'];
    gradeLevels: AppData['gradeLevels'];
    physicalRooms: AppData['physicalRooms'];
    departments: AppData['departments'];
    resourceTypes: AppData['resourceTypes'];
    periodSettings: AppData['periodSettings'];
    teacherSubjectAssignments: AppData['teacherSubjectAssignments'];
    scheduleEntries: AppData['scheduleEntries'];
    organizationSettings: AppData['organizationSettings'];
    users: Array<{
      id: string;
      name: string;
      email: string;
      role: any;
      assignedDepartments: string[];
      organizationId: string;
    }>;
    authorizedAdmins: string[];
    activityLogs: ActivityLog[];
  };
}

/**
 * Builds a standardized backup envelope payload and generated filename for timetable data.
 */
export const buildTimetableBackupPayload = (appData: AppData): { backupData: BackupEnvelope; filename: string } => {
  const orgSettings = appData.organizationSettings || null;
  const schoolName = orgSettings?.name || "Uttaradit School";
  const termYear = orgSettings?.academicYear 
    ? `${orgSettings?.semester || '1'}_${orgSettings.academicYear}` 
    : "1_2569";

  const prunedLogs = pruneActivityLogs(appData.activityLogs || [], 7);

  const backupData: BackupEnvelope = {
    backupVersion: 2,
    timestamp: new Date().toISOString(),
    schoolName: schoolName,
    academicTerm: orgSettings?.academicYear ? `${orgSettings?.semester || '1'}/${orgSettings.academicYear}` : "1/2569",
    summary: {
      teachersCount: appData.teachers?.length || 0,
      subjectsCount: appData.subjects?.length || 0,
      gradeLevelsCount: appData.gradeLevels?.length || 0,
      physicalRoomsCount: appData.physicalRooms?.length || 0,
      departmentsCount: appData.departments?.length || 0,
      resourceTypesCount: appData.resourceTypes?.length || 0,
      periodSettingsCount: appData.periodSettings?.length || 0,
      teacherSubjectAssignmentsCount: appData.teacherSubjectAssignments?.length || 0,
      scheduleEntriesCount: appData.scheduleEntries?.length || 0,
      usersCount: appData.users?.length || 0,
    },
    organizationSettings: orgSettings,
    data: {
      teachers: appData.teachers || [],
      subjects: (appData.subjects || []).map(s => ({
        ...s,
        teachingMode: s.teachingMode || 'single',
        allowPhysicalRoomSharing: !!(s.allowPhysicalRoomSharing ?? s.allowClassroomSharing),
        allowClassroomSharing: !!(s.allowPhysicalRoomSharing ?? s.allowClassroomSharing),
        isBroadAssignment: !!s.isBroadAssignment,
        isHomeroomAdvisorySubject: !!s.isHomeroomAdvisorySubject,
        autoLinkToHomeroomTeachers: !!s.autoLinkToHomeroomTeachers,
        applicableParentGradeLevelIds: s.applicableParentGradeLevelIds || []
      })),
      gradeLevels: appData.gradeLevels || [],
      physicalRooms: appData.physicalRooms || [],
      departments: appData.departments || [],
      resourceTypes: appData.resourceTypes || [],
      periodSettings: appData.periodSettings || [],
      teacherSubjectAssignments: appData.teacherSubjectAssignments || [],
      scheduleEntries: appData.scheduleEntries || [],
      organizationSettings: orgSettings,
      users: (appData.users || []).map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        assignedDepartments: u.assignedDepartments || [],
        organizationId: u.organizationId || 'default'
      })),
      authorizedAdmins: appData.authorizedAdmins || [],
      activityLogs: prunedLogs
    }
  };

  const now = new Date();
  const formattedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const safeSchoolName = schoolName.replace(/[^a-zA-Z0-9ก-๙]/g, '_').substring(0, 30);
  const safeTerm = termYear.replace(/[^a-zA-Z0-9_]/g, '');

  const filename = `timetable_backup_${safeSchoolName}_${safeTerm}_${formattedDate}.json`;

  return { backupData, filename };
};

/**
 * Triggers browser download of JSON data as a downloadable file.
 */
export const triggerJsonDownload = (data: any, filename: string): void => {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
