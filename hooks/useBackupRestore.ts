import { ChangeEvent } from 'react';
import { AppData } from '../types';
import { pruneActivityLogs } from '../api';

export const useBackupRestore = (
  appData: AppData | null, 
  setAppData: (data: AppData) => void, 
  setRestoreFile: (file: File | null) => void, 
  setShowRestoreConfirm: (show: boolean) => void
) => {
  const handleBackupData = () => {
    if (appData?.currentUser?.role !== 'admin') {
      alert("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถสำรองข้อมูลได้");
      return;
    }
    if (!appData) {
      alert("ไม่มีข้อมูลสำหรับสำรอง");
      return;
    }

    try {
      const orgSettings = appData.organizationSettings || null;
      const schoolName = orgSettings?.name || "Uttaradit School";
      const termYear = orgSettings?.academicYear 
        ? `${orgSettings?.semester || '1'}_${orgSettings.academicYear}` 
        : "1_2569";

      const prunedLogs = pruneActivityLogs(appData.activityLogs || [], 7);

      const backupData = {
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
            allowClassroomSharing: !!s.allowClassroomSharing,
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

      const jsonString = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const now = new Date();
      const formattedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const safeSchoolName = schoolName.replace(/[^a-zA-Z0-9ก-๙]/g, '_').substring(0, 30);
      const safeTerm = termYear.replace(/[^a-zA-Z0-9_]/g, '');

      link.download = `timetable_backup_${safeSchoolName}_${safeTerm}_${formattedDate}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Backup failed:", error);
      alert("เกิดข้อผิดพลาดในการสำรองข้อมูล");
    }
  };

  const handleRestoreData = async (event: ChangeEvent<HTMLInputElement>) => {
    if (appData?.currentUser?.role !== 'admin') {
      alert("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถกู้คืนข้อมูลได้");
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsedData = JSON.parse(text);
      const raw = parsedData.data || parsedData;

      // Pre-validation of database structure
      if (!raw || typeof raw !== 'object') {
        alert("ข้อผิดพลาด: โครงสร้างไฟล์ข้อมูลไม่ถูกต้อง");
        event.target.value = "";
        return;
      }

      const hasValidData = 
        Array.isArray(raw.teachers) || 
        Array.isArray(raw.subjects) || 
        Array.isArray(raw.physicalRooms) || 
        Array.isArray(raw.gradeLevels) || 
        Array.isArray(raw.scheduleEntries) || 
        (raw.organizationSettings && typeof raw.organizationSettings === 'object');

      if (!hasValidData) {
        alert("ข้อผิดพลาด: ไฟล์สำรองข้อมูลไม่มีโครงสร้างตารางข้อมูลที่รองรับ (ไม่พบตารางครู, รายวิชา, ห้องเรียน, หรือตารางสอน)");
        event.target.value = "";
        return;
      }

      // Trigger confirmation modal
      setRestoreFile(file);
      setShowRestoreConfirm(true);
    } catch (e) {
      alert("ข้อผิดพลาด: รูปแบบไฟล์ JSON ไม่ถูกต้อง หรือไฟล์ได้รับความเสียหาย");
    } finally {
      event.target.value = "";
    }
  };

  return { handleBackupData, handleRestoreData };
};
