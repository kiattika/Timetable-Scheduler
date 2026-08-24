import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  AppData, 
  ImportableEntityType, 
  Teacher, 
  Subject, 
  GradeLevel, 
  PhysicalRoom, 
  TeacherSubjectAssignment,
  ScheduleEntry,
  DayOfWeek
} from '../types';
import Modal from './Modal';
import { Icons, APP_TITLE } from '../constants';
import { formatRoomDisplay } from '../utils/stringUtils';

export type ExportTargetType = 
  | 'all' 
  | 'teachers' 
  | 'subjects' 
  | 'gradeLevels' 
  | 'classrooms' 
  | 'physicalRooms' 
  | 'teacherSubjectAssignments' 
  | 'scheduleEntries' 
  | 'teacherLoadReport';

interface ExportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  appData: AppData;
  initialExportType?: ExportTargetType;
  initialDepartment?: string;
}

export const ExportDataModal: React.FC<ExportDataModalProps> = ({
  isOpen,
  onClose,
  appData,
  initialExportType = 'all',
  initialDepartment = 'ALL'
}) => {
  const [exportMode, setExportMode] = useState<'all' | 'single' | 'departmentPackage'>('all');
  const [selectedEntity, setSelectedEntity] = useState<ExportTargetType>(initialExportType === 'all' ? 'teachers' : initialExportType);
  const [selectedDepartment, setSelectedDepartment] = useState<string>(initialDepartment);
  const [selectedGradeFilter, setSelectedGradeFilter] = useState<string>('ALL');
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [includeInstructionsSheet, setIncludeInstructionsSheet] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);

  // Sync initial props when opened
  React.useEffect(() => {
    if (isOpen) {
      if (initialExportType === 'all') {
        setExportMode('all');
      } else {
        setExportMode('single');
        setSelectedEntity(initialExportType);
      }
      if (initialDepartment) {
        setSelectedDepartment(initialDepartment);
      }
      setExportSuccessMessage(null);
    }
  }, [isOpen, initialExportType, initialDepartment]);

  // Extract distinct departments from system data
  const availableDepartments = useMemo(() => {
    const deptSet = new Set<string>();
    (appData.departments || []).forEach(d => {
      if (d.name && d.name.trim()) deptSet.add(d.name.trim());
    });
    (appData.teachers || []).forEach(t => {
      if (t.department && t.department.trim()) deptSet.add(t.department.trim());
    });
    (appData.subjects || []).forEach(s => {
      if (s.department && s.department.trim()) deptSet.add(s.department.trim());
    });
    return Array.from(deptSet).sort((a, b) => a.localeCompare(b, 'th', { sensitivity: 'base' }));
  }, [appData]);

  // Extract distinct grade levels
  const parentGradeLevels = useMemo(() => {
    return (appData.gradeLevels || [])
      .filter(g => !g.name.includes('/'))
      .sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true }));
  }, [appData.gradeLevels]);

  const schoolName = appData.organizationSettings?.name || "โรงเรียน";
  const academicTerm = appData.organizationSettings?.academicYear 
    ? `${appData.organizationSettings?.semester || '1'}_${appData.organizationSettings.academicYear}`
    : "ภาคเรียนปัจจุบัน";

  // Data helpers
  const getFilteredTeachers = (dept: string) => {
    const list = appData.teachers || [];
    if (dept === 'ALL') return list;
    return list.filter(t => t.department === dept);
  };

  const getFilteredSubjects = (dept: string) => {
    const list = appData.subjects || [];
    if (dept === 'ALL') return list;
    return list.filter(s => s.department === dept);
  };

  const getFilteredAssignments = (dept: string, gradeId: string) => {
    let list = appData.teacherSubjectAssignments || [];
    if (dept !== 'ALL') {
      const deptTeachers = new Set((appData.teachers || []).filter(t => t.department === dept).map(t => t.id));
      const deptSubjects = new Set((appData.subjects || []).filter(s => s.department === dept).map(s => s.id));
      list = list.filter(a => deptTeachers.has(a.teacherId) || deptSubjects.has(a.subjectId));
    }
    if (gradeId !== 'ALL') {
      list = list.filter(a => {
        if (a.gradeLevelId === gradeId) return true;
        const assignedGrade = (appData.gradeLevels || []).find(g => g.id === a.gradeLevelId);
        return assignedGrade && assignedGrade.name.startsWith(gradeId);
      });
    }
    return list;
  };

  // Build Sheet Data: Teachers
  const buildTeachersSheetData = (deptFilter: string) => {
    const headers = ["ชื่อ-สกุล", "รหัสครู", "อีเมล", "กลุ่มสาระการเรียนรู้", "ห้องประจำชั้น/ที่ปรึกษา"];
    const rows = getFilteredTeachers(deptFilter).map(teacher => {
      const homeroomNames = (teacher.homeroomGradeLevelIds || [])
        .map(id => (appData.gradeLevels || []).find(g => g.id === id)?.name || id)
        .join(', ');
      return [
        teacher.name || '',
        teacher.teacherCode || '',
        teacher.email || '',
        teacher.department || '',
        homeroomNames
      ];
    });
    return [headers, ...rows];
  };

  // Build Sheet Data: Subjects
  const buildSubjectsSheetData = (deptFilter: string) => {
    const headers = [
      "ชื่อวิชา", 
      "รหัสวิชา", 
      "จำนวนคาบ/สัปดาห์", 
      "กลุ่มสาระการเรียนรู้", 
      "สีประจำวิชา", 
      "รูปแบบการสอน", 
      "รูปแบบการจัดคาบ", 
      "อนุญาตให้ใช้ห้องร่วม", 
      "วิชาเรียนรวม", 
      "วิชาโฮมรูม/แนะแนว", 
      "ผูกกับครูประจำชั้นอัตโนมัติ", 
      "ระดับชั้นที่เปิดสอน"
    ];
    const rows = getFilteredSubjects(deptFilter).map(sub => {
      const applicableGrades = (sub.applicableParentGradeLevelIds || [])
        .map(id => (appData.gradeLevels || []).find(g => g.id === id)?.name || id)
        .join(', ');
      return [
        sub.name || '',
        sub.subjectCode || '',
        sub.periodsPerWeek ?? 1,
        sub.department || '',
        sub.color || '#3B82F6',
        sub.teachingMode || 'single',
        sub.schedulingPattern || '',
        sub.allowClassroomSharing ? 'ใช่' : 'ไม่ใช่',
        sub.isBroadAssignment ? 'ใช่' : 'ไม่ใช่',
        sub.isHomeroomAdvisorySubject ? 'ใช่' : 'ไม่ใช่',
        sub.autoLinkToHomeroomTeachers ? 'ใช่' : 'ไม่ใช่',
        applicableGrades
      ];
    });
    return [headers, ...rows];
  };

  // Build Sheet Data: Grade Levels & Classrooms
  const buildGradeLevelsSheetData = () => {
    const headers = ["ชื่อระดับชั้น", "ห้องประจำ/โฮมรูม", "คำอธิบาย"];
    const rows = (appData.gradeLevels || [])
      .filter(g => !g.name.includes('/'))
      .map(g => {
        const room = (appData.physicalRooms || []).find(r => r.id === g.homeroomPhysicalRoomId);
        return [
          g.name || '',
          room ? formatRoomDisplay(room) : '',
          g.description || ''
        ];
      });
    return [headers, ...rows];
  };

  const buildClassroomsSheetData = () => {
    const headers = ["ชื่อห้องเรียน", "ห้องประจำ/โฮมรูม", "คำอธิบาย"];
    const rows = (appData.gradeLevels || [])
      .filter(g => g.name.includes('/'))
      .map(g => {
        const room = (appData.physicalRooms || []).find(r => r.id === g.homeroomPhysicalRoomId);
        return [
          g.name || '',
          room ? formatRoomDisplay(room) : '',
          g.description || ''
        ];
      });
    return [headers, ...rows];
  };

  // Build Sheet Data: Physical Rooms
  const buildPhysicalRoomsSheetData = () => {
    const headers = ["รหัสห้อง", "ชื่อห้อง", "ประเภทห้อง", "ความจุ (คน)"];
    const rows = (appData.physicalRooms || []).map(r => [
      r.code || '',
      r.name || '',
      r.type || 'ห้องเรียนทั่วไป',
      r.capacity ?? 40
    ]);
    return [headers, ...rows];
  };

  // Build Sheet Data: Teacher Subject Assignments
  const buildAssignmentsSheetData = (deptFilter: string, gradeFilter: string) => {
    const headers = [
      "ครูผู้สอน", 
      "รหัสครู", 
      "รายวิชา", 
      "รหัสวิชา", 
      "ระดับชั้น/ห้องเรียน", 
      "กลุ่มสาระการเรียนรู้", 
      "จำนวนคาบ/สัปดาห์"
    ];
    const assignments = getFilteredAssignments(deptFilter, gradeFilter);
    const rows = assignments.map(a => {
      const teacher = (appData.teachers || []).find(t => t.id === a.teacherId);
      const subject = (appData.subjects || []).find(s => s.id === a.subjectId);
      const grade = (appData.gradeLevels || []).find(g => g.id === a.gradeLevelId);
      return [
        teacher?.name || a.teacherId,
        teacher?.teacherCode || '',
        subject?.name || a.subjectId,
        subject?.subjectCode || '',
        grade?.name || a.gradeLevelId,
        subject?.department || teacher?.department || '',
        subject?.periodsPerWeek ?? 1
      ];
    });
    return [headers, ...rows];
  };

  // Build Sheet Data: Current Timetable Schedule
  const buildScheduleEntriesSheetData = (deptFilter: string, gradeFilter: string) => {
    const headers = [
      "วัน", 
      "คาบเรียน", 
      "เวลา", 
      "ระดับชั้น/ห้องเรียน", 
      "รหัสวิชา", 
      "ชื่อวิชา", 
      "ครูผู้สอน", 
      "รหัสครู", 
      "ห้องเรียน/สถานที่", 
      "กลุ่มสาระการเรียนรู้"
    ];
    
    const dayMap: Record<DayOfWeek, string> = {
      [DayOfWeek.Monday]: 'วันจันทร์',
      [DayOfWeek.Tuesday]: 'วันอังคาร',
      [DayOfWeek.Wednesday]: 'วันพุธ',
      [DayOfWeek.Thursday]: 'วันพฤหัสบดี',
      [DayOfWeek.Friday]: 'วันศุกร์',
      [DayOfWeek.Saturday]: 'วันเสาร์',
      [DayOfWeek.Sunday]: 'วันอาทิตย์',
    };

    let entries = appData.scheduleEntries || [];
    if (gradeFilter !== 'ALL') {
      entries = entries.filter(e => {
        if (e.gradeLevelId === gradeFilter) return true;
        const g = (appData.gradeLevels || []).find(gl => gl.id === e.gradeLevelId);
        return g && g.name.startsWith(gradeFilter);
      });
    }

    if (deptFilter !== 'ALL') {
      entries = entries.filter(e => {
        const sub = (appData.subjects || []).find(s => s.id === e.subjectId);
        if (sub && sub.department === deptFilter) return true;
        const hasDeptTeacher = (e.teacherIds || []).some(tid => {
          const t = (appData.teachers || []).find(tch => tch.id === tid);
          return t && t.department === deptFilter;
        });
        return hasDeptTeacher;
      });
    }

    // Sort entries by day, period, grade
    const dayOrder: Record<DayOfWeek, number> = {
      [DayOfWeek.Monday]: 1,
      [DayOfWeek.Tuesday]: 2,
      [DayOfWeek.Wednesday]: 3,
      [DayOfWeek.Thursday]: 4,
      [DayOfWeek.Friday]: 5,
      [DayOfWeek.Saturday]: 6,
      [DayOfWeek.Sunday]: 7,
    };

    const sortedEntries = [...entries].sort((a, b) => {
      const dA = dayOrder[a.dayOfWeek] || 99;
      const dB = dayOrder[b.dayOfWeek] || 99;
      if (dA !== dB) return dA - dB;
      if (a.period !== b.period) return a.period - b.period;
      const gA = (appData.gradeLevels || []).find(g => g.id === a.gradeLevelId)?.name || '';
      const gB = (appData.gradeLevels || []).find(g => g.id === b.gradeLevelId)?.name || '';
      return gA.localeCompare(gB, 'th', { numeric: true });
    });

    const rows = sortedEntries.map(e => {
      const grade = (appData.gradeLevels || []).find(g => g.id === e.gradeLevelId);
      const subject = (appData.subjects || []).find(s => s.id === e.subjectId);
      const periodSetting = (appData.periodSettings || []).find(p => p.id === `p${e.period}`);
      const periodTime = periodSetting ? `${periodSetting.startTime} - ${periodSetting.endTime}` : `คาบ ${e.period}`;
      const teacherNames = (e.teacherIds || [])
        .map(tid => (appData.teachers || []).find(t => t.id === tid)?.name || tid)
        .join(', ');
      const teacherCodes = (e.teacherIds || [])
        .map(tid => (appData.teachers || []).find(t => t.id === tid)?.teacherCode || '')
        .filter(Boolean)
        .join(', ');
      const room = (appData.physicalRooms || []).find(r => r.id === e.physicalRoomId);

      return [
        dayMap[e.dayOfWeek] || e.dayOfWeek,
        `คาบ ${e.period}`,
        periodTime,
        grade?.name || e.gradeLevelId,
        subject?.subjectCode || '',
        subject?.name || e.subjectId,
        teacherNames,
        teacherCodes,
        room ? formatRoomDisplay(room) : (e.physicalRoomId || '-'),
        subject?.department || ''
      ];
    });

    return [headers, ...rows];
  };

  // Build Sheet Data: Teacher Teaching Load Summary
  const buildTeacherLoadSheetData = (deptFilter: string) => {
    const headers = [
      "ลำดับ", 
      "รหัสครู", 
      "ชื่อ-สกุล", 
      "กลุ่มสาระการเรียนรู้", 
      "จำนวนวิชาที่สอน", 
      "คาบวิชาหลัก/สัปดาห์", 
      "คาบกิจกรรม/สัปดาห์", 
      "รวมคาบสอนจริง/สัปดาห์"
    ];

    const teachersList = getFilteredTeachers(deptFilter);
    const rows = teachersList.map((teacher, index) => {
      const entries = (appData.scheduleEntries || []).filter(e => (e.teacherIds || []).includes(teacher.id));
      
      const isActivity = (sub?: Subject) => {
        if (!sub || !sub.name) return false;
        if (sub.isHomeroomAdvisorySubject) return true;
        const lower = sub.name.toLowerCase();
        return ['กิจกรรม', 'ลูกเสือ', 'เนตรนารี', 'ยุวกาชาด', 'แนะแนว', 'ชุมนุม', 'สาธารณประโยชน์', 'โฮมรูม'].some(k => lower.includes(k));
      };

      let mainPeriods = 0;
      let activityPeriods = 0;
      const subjectSet = new Set<string>();

      entries.forEach(e => {
        subjectSet.add(e.subjectId);
        const sub = (appData.subjects || []).find(s => s.id === e.subjectId);
        if (isActivity(sub)) {
          activityPeriods++;
        } else {
          mainPeriods++;
        }
      });

      return [
        index + 1,
        teacher.teacherCode || '',
        teacher.name || '',
        teacher.department || '',
        subjectSet.size,
        mainPeriods,
        activityPeriods,
        mainPeriods + activityPeriods
      ];
    });

    return [headers, ...rows];
  };

  // Build Sheet Data: Instructions & Code Guide
  const buildInstructionsSheetData = () => {
    return [
      ["คู่มือและคำแนะนำการแก้ไขข้อมูลเพื่อส่งคืนระบบจัดตารางสอน"],
      ["โรงเรียน/หน่วยงาน:", schoolName],
      ["ภาคเรียน/ปีการศึกษา:", academicTerm],
      ["วันที่ส่งออกข้อมูล:", new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })],
      [],
      ["ข้อแนะนำสำหรับผู้รับผิดชอบ/หัวหน้ากลุ่มสาระฯ/ครูผู้สอน:"],
      ["1. ท่านสามารถแก้ไขข้อมูลในแต่ละแผ่นงาน (Sheet) หรือบันทึกเป็นไฟล์ Excel เพื่อส่งคืนผู้ดูแลระบบได้ทันที"],
      ["2. สามารถเพิ่มแถวใหม่ (Add Row) เพื่อเพิ่มครูผู้สอน, รายวิชา, หรือการมอบหมายคาบสอนใหม่"],
      ["3. กรุณาอย่าเปลี่ยนชื่อหัวตาราง (Headers ในแถวแรก) เพื่อให้ระบบสามารถนำเข้า (Import) กลับคืนได้อย่างแม่นยำ"],
      ["4. ในแผ่นงาน 'การมอบหมายการสอน' สามารถระบุเป็น 'ชื่อครู' หรือ 'รหัสครู' และ 'ชื่อวิชา' หรือ 'รหัสวิชา' ได้"],
      ["5. ในแผ่นงาน 'รายวิชา' คอลัมน์ 'รูปแบบการสอน' ให้ระบุเป็น 'single' (สอนเดี่ยว) หรือ 'multiple' (สอนร่วม)"],
      ["6. คอลัมน์ประเภท ใช่/ไม่ใช่ สามารถพิมพ์ 'ใช่'/'ไม่ใช่' หรือ 'true'/'false' ได้ตามสะดวก"],
      [],
      ["รายการกลุ่มสาระการเรียนรู้ในระบบ:", availableDepartments.join(', ')]
    ];
  };

  // Export execution function
  const handlePerformExport = () => {
    setIsExporting(true);
    setExportSuccessMessage(null);

    try {
      const wb = XLSX.utils.book_new();
      const sanitizedSchoolName = schoolName.replace(/[/\\?%*:|"<>]/g, '_');
      const deptSuffix = selectedDepartment !== 'ALL' ? `_${selectedDepartment}` : '';
      let filename = `ข้อมูลตารางสอน_${sanitizedSchoolName}_${academicTerm}${deptSuffix}.${exportFormat}`;

      if (exportMode === 'all') {
        // Multi-sheet workbook with all master datasets
        if (includeInstructionsSheet) {
          const wsInstructions = XLSX.utils.aoa_to_sheet(buildInstructionsSheetData());
          wsInstructions['!cols'] = [{ wch: 45 }, { wch: 35 }, { wch: 25 }];
          XLSX.utils.book_append_sheet(wb, wsInstructions, "คำแนะนำการแก้ไข");
        }

        const wsTeachers = XLSX.utils.aoa_to_sheet(buildTeachersSheetData(selectedDepartment));
        wsTeachers['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 28 }, { wch: 26 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, wsTeachers, "ครูผู้สอน");

        const wsSubjects = XLSX.utils.aoa_to_sheet(buildSubjectsSheetData(selectedDepartment));
        wsSubjects['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, wsSubjects, "รายวิชา");

        const wsClassrooms = XLSX.utils.aoa_to_sheet(buildClassroomsSheetData());
        wsClassrooms['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, wsClassrooms, "ห้องเรียน");

        const wsGradeLevels = XLSX.utils.aoa_to_sheet(buildGradeLevelsSheetData());
        wsGradeLevels['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, wsGradeLevels, "ระดับชั้น");

        const wsRooms = XLSX.utils.aoa_to_sheet(buildPhysicalRoomsSheetData());
        wsRooms['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 20 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, wsRooms, "อาคารและห้อง");

        const wsAssignments = XLSX.utils.aoa_to_sheet(buildAssignmentsSheetData(selectedDepartment, selectedGradeFilter));
        wsAssignments['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 16 }];
        XLSX.utils.book_append_sheet(wb, wsAssignments, "การมอบหมายสอน");

        const wsSchedule = XLSX.utils.aoa_to_sheet(buildScheduleEntriesSheetData(selectedDepartment, selectedGradeFilter));
        wsSchedule['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 26 }, { wch: 24 }, { wch: 14 }, { wch: 20 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, wsSchedule, "ตารางสอนปัจจุบัน");

        const wsLoad = XLSX.utils.aoa_to_sheet(buildTeacherLoadSheetData(selectedDepartment));
        wsLoad['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 26 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, wsLoad, "สรุปภาระงานสอนครู");

        filename = `ชุดข้อมูลตารางสอน_${sanitizedSchoolName}_${academicTerm}${deptSuffix}.xlsx`;
      } else if (exportMode === 'departmentPackage') {
        // Targeted Department Package (Teachers + Subjects + Assignments + Load Summary)
        const targetDept = selectedDepartment === 'ALL' ? (availableDepartments[0] || 'กลุ่มสาระการเรียนรู้') : selectedDepartment;
        
        if (includeInstructionsSheet) {
          const wsInstructions = XLSX.utils.aoa_to_sheet(buildInstructionsSheetData());
          XLSX.utils.book_append_sheet(wb, wsInstructions, "คำแนะนำการแก้ไข");
        }

        const wsTeachers = XLSX.utils.aoa_to_sheet(buildTeachersSheetData(targetDept));
        XLSX.utils.book_append_sheet(wb, wsTeachers, "ครูผู้สอน");

        const wsSubjects = XLSX.utils.aoa_to_sheet(buildSubjectsSheetData(targetDept));
        XLSX.utils.book_append_sheet(wb, wsSubjects, "รายวิชา");

        const wsAssignments = XLSX.utils.aoa_to_sheet(buildAssignmentsSheetData(targetDept, selectedGradeFilter));
        XLSX.utils.book_append_sheet(wb, wsAssignments, "การมอบหมายสอน");

        const wsLoad = XLSX.utils.aoa_to_sheet(buildTeacherLoadSheetData(targetDept));
        XLSX.utils.book_append_sheet(wb, wsLoad, "สรุปภาระงานสอนครู");

        const sanitizedDept = targetDept.replace(/[/\\?%*:|"<>]/g, '_');
        filename = `ข้อมูลกลุ่มสาระ_${sanitizedDept}_${sanitizedSchoolName}_${academicTerm}.xlsx`;
      } else {
        // Single entity export
        let dataAOA: any[][] = [];
        let sheetName = "Data";

        switch (selectedEntity) {
          case 'teachers':
            dataAOA = buildTeachersSheetData(selectedDepartment);
            sheetName = "ครูผู้สอน";
            filename = `รายชื่อครูผู้สอน_${sanitizedSchoolName}${deptSuffix}.${exportFormat}`;
            break;
          case 'subjects':
            dataAOA = buildSubjectsSheetData(selectedDepartment);
            sheetName = "รายวิชา";
            filename = `รายวิชา_${sanitizedSchoolName}${deptSuffix}.${exportFormat}`;
            break;
          case 'gradeLevels':
            dataAOA = buildGradeLevelsSheetData();
            sheetName = "ระดับชั้น";
            filename = `ระดับชั้น_${sanitizedSchoolName}.${exportFormat}`;
            break;
          case 'classrooms':
            dataAOA = buildClassroomsSheetData();
            sheetName = "ห้องเรียน";
            filename = `ห้องเรียน_${sanitizedSchoolName}.${exportFormat}`;
            break;
          case 'physicalRooms':
            dataAOA = buildPhysicalRoomsSheetData();
            sheetName = "อาคารและห้อง";
            filename = `อาคารและห้องสถานที่_${sanitizedSchoolName}.${exportFormat}`;
            break;
          case 'teacherSubjectAssignments':
            dataAOA = buildAssignmentsSheetData(selectedDepartment, selectedGradeFilter);
            sheetName = "การมอบหมายสอน";
            filename = `การมอบหมายสอน_${sanitizedSchoolName}${deptSuffix}.${exportFormat}`;
            break;
          case 'scheduleEntries':
            dataAOA = buildScheduleEntriesSheetData(selectedDepartment, selectedGradeFilter);
            sheetName = "ตารางสอน";
            filename = `ตารางสอน_${sanitizedSchoolName}${deptSuffix}.${exportFormat}`;
            break;
          case 'teacherLoadReport':
            dataAOA = buildTeacherLoadSheetData(selectedDepartment);
            sheetName = "สรุปภาระงานสอน";
            filename = `รายงานภาระงานสอนครู_${sanitizedSchoolName}${deptSuffix}.${exportFormat}`;
            break;
        }

        const ws = XLSX.utils.aoa_to_sheet(dataAOA);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }

      if (exportFormat === 'csv' && exportMode === 'single') {
        XLSX.writeFile(wb, filename, { bookType: 'csv' });
      } else {
        XLSX.writeFile(wb, filename, { bookType: 'xlsx' });
      }

      setExportSuccessMessage(`ส่งออกไฟล์ "${filename}" เรียบร้อยแล้ว! สามารถนำไฟล์นี้ส่งให้ผู้รับผิดชอบตรวจสอบ ปรับปรุง หรือแก้ไข แล้วนำกลับเข้ามาในระบบผ่านฟังก์ชัน 'นำเข้าข้อมูล (Import Data)' ได้ทันที`);
    } catch (err: any) {
      console.error("Export error:", err);
      alert(`เกิดข้อผิดพลาดในการส่งออกข้อมูล: ${err?.message || 'โปรดลองใหม่อีกครั้ง'}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Quick statistics for display
  const stats = useMemo(() => {
    const teachers = getFilteredTeachers(selectedDepartment).length;
    const subjects = getFilteredSubjects(selectedDepartment).length;
    const classrooms = (appData.gradeLevels || []).filter(g => g.name.includes('/')).length;
    const gradeLevels = (appData.gradeLevels || []).filter(g => !g.name.includes('/')).length;
    const rooms = (appData.physicalRooms || []).length;
    const assignments = getFilteredAssignments(selectedDepartment, selectedGradeFilter).length;
    const scheduleEntries = (appData.scheduleEntries || []).length;
    return { teachers, subjects, classrooms, gradeLevels, rooms, assignments, scheduleEntries };
  }, [appData, selectedDepartment, selectedGradeFilter]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="ส่งออกข้อมูลระบบ (Export Data to Excel / CSV)" size="xl">
      <div className="space-y-6">
        
        {/* Top Notification / Banner */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <div className="p-2 bg-blue-600 text-white rounded-lg shadow-sm shrink-0">
            <Icons.Download size={22} />
          </div>
          <div className="text-xs text-slate-700 leading-relaxed">
            <h4 className="text-sm font-bold text-blue-900 mb-0.5">
              ส่งออกข้อมูลเพื่อให้ผู้รับผิดชอบนำไปตรวจสอบและแก้ไข (Round-Trip Export & Import)
            </h4>
            <p className="text-slate-600">
              ไฟล์ Excel ที่ส่งออกจะมีโครงสร้างหัวตาราง (Headers) ที่ตรงกับฟอร์มนำเข้าของระบบ 
              หัวหน้ากลุ่มสาระฯ หรือครูผู้สอนสามารถเปิดแก้ไขใน Microsoft Excel หรือ Google Sheets แล้วส่งกลับมานำเข้า (Import) คืนสู่ระบบได้ทันทีโดยไม่ต้องจัดรูปแบบใหม่
            </p>
          </div>
        </div>

        {/* Export Mode Selection Tabs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setExportMode('all')}
            className={`p-3.5 rounded-xl border text-left transition-all relative ${
              exportMode === 'all'
                ? 'border-blue-600 bg-blue-50/70 text-blue-900 ring-2 ring-blue-500/20 shadow-sm font-semibold'
                : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icons.Layers size={18} className={exportMode === 'all' ? 'text-blue-600' : 'text-slate-500'} />
              <span className="text-sm font-bold">1. ชุดข้อมูลรวมทั้งระบบ</span>
            </div>
            <p className="text-xs text-slate-500 font-normal">
              รวมทุกตาราง (ครู, วิชา, ห้อง, มอบหมายสอน, ตารางสอน) ในไฟล์เดียวแยกตาม Sheet
            </p>
          </button>

          <button
            type="button"
            onClick={() => setExportMode('departmentPackage')}
            className={`p-3.5 rounded-xl border text-left transition-all relative ${
              exportMode === 'departmentPackage'
                ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-2 ring-indigo-500/20 shadow-sm font-semibold'
                : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icons.UsersRound size={18} className={exportMode === 'departmentPackage' ? 'text-indigo-600' : 'text-slate-500'} />
              <span className="text-sm font-bold">2. ชุดข้อมูลแยกรายกลุ่มสาระฯ</span>
            </div>
            <p className="text-xs text-slate-500 font-normal">
              เหมาะสำหรับส่งให้หัวหน้ากลุ่มสาระฯ นำไปแจกจ่ายและปรับปรุงภาระงานสอน
            </p>
          </button>

          <button
            type="button"
            onClick={() => setExportMode('single')}
            className={`p-3.5 rounded-xl border text-left transition-all relative ${
              exportMode === 'single'
                ? 'border-emerald-600 bg-emerald-50/70 text-emerald-900 ring-2 ring-emerald-500/20 shadow-sm font-semibold'
                : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icons.FileText size={18} className={exportMode === 'single' ? 'text-emerald-600' : 'text-slate-500'} />
              <span className="text-sm font-bold">3. ส่งออกเฉพาะตารางที่เลือก</span>
            </div>
            <p className="text-xs text-slate-500 font-normal">
              เลือกส่งออกเฉพาะรายชื่อครู, รายวิชา, ห้องเรียน, หรือตารางสอนเป็นรายตาราง
            </p>
          </button>
        </div>

        {/* Filter Configuration Panel */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4.5 space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Icons.Settings size={14} /> ตั้งค่าตัวกรองและเงื่อนไขการส่งออก (Filters & Options)
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            
            {/* Department Filter */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                กลุ่มสาระการเรียนรู้:
              </label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              >
                <option value="ALL">-- ทุกกลุ่มสาระการเรียนรู้ (ทั้งหมด) --</option>
                {availableDepartments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>

            {/* Target Entity (Visible if mode === 'single') */}
            {exportMode === 'single' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  เลือกตารางข้อมูลที่ต้องการส่งออก:
                </label>
                <select
                  value={selectedEntity}
                  onChange={(e) => setSelectedEntity(e.target.value as ExportTargetType)}
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm font-medium text-slate-800"
                >
                  <option value="teachers">ครูผู้สอน ({stats.teachers} ท่าน)</option>
                  <option value="subjects">รายวิชา ({stats.subjects} วิชา)</option>
                  <option value="teacherSubjectAssignments">การมอบหมายการสอน ({stats.assignments} รายการ)</option>
                  <option value="classrooms">ห้องเรียน ({stats.classrooms} ห้อง)</option>
                  <option value="gradeLevels">ระดับชั้น ({stats.gradeLevels} ชั้น)</option>
                  <option value="physicalRooms">อาคารและห้องสถานที่ ({stats.rooms} ห้อง)</option>
                  <option value="scheduleEntries">รายการตารางสอน ({stats.scheduleEntries} คาบ)</option>
                  <option value="teacherLoadReport">สรุปภาระงานสอนครู</option>
                </select>
              </div>
            )}

            {/* Grade Level Filter (For assignments / schedule) */}
            {(exportMode === 'all' || selectedEntity === 'teacherSubjectAssignments' || selectedEntity === 'scheduleEntries') && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  ระดับชั้น (สำหรับตารางสอน/การมอบหมาย):
                </label>
                <select
                  value={selectedGradeFilter}
                  onChange={(e) => setSelectedGradeFilter(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                >
                  <option value="ALL">-- ทุกระดับชั้น --</option>
                  {parentGradeLevels.map(g => (
                    <option key={g.id} value={g.name}>{g.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Format Selection */}
            {exportMode === 'single' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  รูปแบบไฟล์ (Format):
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setExportFormat('xlsx')}
                    className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border flex items-center justify-center gap-1.5 transition-colors ${
                      exportFormat === 'xlsx'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <Icons.FileSpreadsheet size={14} /> Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportFormat('csv')}
                    className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border flex items-center justify-center gap-1.5 transition-colors ${
                      exportFormat === 'csv'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <Icons.FileText size={14} /> CSV (.csv)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Option: Include Instructions Tab */}
          <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 select-none">
              <input
                type="checkbox"
                checked={includeInstructionsSheet}
                onChange={(e) => setIncludeInstructionsSheet(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
              />
              <span>แนบแผ่นงาน <strong>"คำแนะนำการแก้ไขข้อมูล"</strong> (Instructions Guide) ในไฟล์ Excel</span>
            </label>
            <span className="text-[11px] text-slate-500">
              สถานศึกษา: <strong className="text-slate-700">{schoolName}</strong> ({academicTerm})
            </span>
          </div>
        </div>

        {/* Live Data Summary / Badges */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-bold text-slate-700 mb-2.5 flex items-center justify-between">
            <span>สรุปจำนวนข้อมูลที่จะส่งออก (ตามตัวกรองที่เลือก):</span>
            {selectedDepartment !== 'ALL' && (
              <span className="bg-indigo-100 text-indigo-800 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                กลุ่มสาระฯ: {selectedDepartment}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs text-slate-600">
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex justify-between items-center">
              <span>ครูผู้สอน:</span>
              <strong className="text-slate-900 font-bold text-sm">{stats.teachers} ท่าน</strong>
            </div>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex justify-between items-center">
              <span>รายวิชา:</span>
              <strong className="text-slate-900 font-bold text-sm">{stats.subjects} วิชา</strong>
            </div>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex justify-between items-center">
              <span>การมอบหมายสอน:</span>
              <strong className="text-slate-900 font-bold text-sm">{stats.assignments} รายการ</strong>
            </div>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex justify-between items-center">
              <span>ห้องเรียน / สถานที่:</span>
              <strong className="text-slate-900 font-bold text-sm">{stats.classrooms + stats.rooms} รายการ</strong>
            </div>
          </div>
        </div>

        {/* Success Confirmation Alert */}
        {exportSuccessMessage && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2.5 animate-in fade-in duration-200">
            <Icons.CheckCircle size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-900 mb-0.5">การส่งออกสำเร็จเรียบร้อย!</p>
              <p>{exportSuccessMessage}</p>
            </div>
          </div>
        )}

        {/* Action Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
          >
            ปิดหน้าต่าง
          </button>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={handlePerformExport}
              disabled={isExporting}
              className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-md shadow-blue-500/20 hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังประมวลผลและส่งออกไฟล์...
                </>
              ) : (
                <>
                  <Icons.Download size={18} />
                  <span>ดาวน์โหลดไฟล์ {exportFormat.toUpperCase()}</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </Modal>
  );
};

export default ExportDataModal;
