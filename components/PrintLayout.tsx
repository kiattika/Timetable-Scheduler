import React, { useEffect } from 'react';
import { AppData, Identifiable, PrintOptions, Teacher, GradeLevel, PhysicalRoom, ScheduleEntry, ScreenAccessProps, SingleScheduleTableProps } from '../types';
import { GradeLevelScheduleTable } from './GradeLevelPlannerView';
import { TeacherScheduleTable } from './TeacherScheduleView';
import { RoomUsageScheduleTable } from './RoomUsageView';
import { isParentGrade as checkIsParentGradeUtil, getParentGradeLevelId, isChildOf } from './scheduleUtils';

interface PrintLayoutProps {
  appData: AppData;
  printOptions: PrintOptions;
  onPrintComplete: () => void;
  getEntryDisplay: (entry: ScheduleEntry) => any;
  permissions: ScreenAccessProps['permissions'];
}

export const PrintLayout: React.FC<PrintLayoutProps> = ({ appData, printOptions, onPrintComplete, getEntryDisplay, permissions }) => {
  const { itemType, selectedItemIds, layout, orientation } = printOptions;

  const itemsToRender = selectedItemIds.map(id => {
    switch(itemType) {
        case 'teacher': return appData.teachers.find(t => t.id === id);
        case 'gradeLevel': return appData.gradeLevels.find(gl => gl.id === id);
        case 'physicalRoom': return appData.physicalRooms.find(c => c.id === id);
        default: return null;
    }
  }).filter(Boolean) as Identifiable[];

  useEffect(() => {
    // Small timeout to allow DOM to render
    const timeout = setTimeout(() => {
      window.print();
      onPrintComplete();
    }, 500);
    return () => clearTimeout(timeout);
  }, [onPrintComplete]);

  const commonTableProps: Omit<SingleScheduleTableProps, 'itemId'> & { 
    handleSlotContextMenu: () => void, onSlotSelect: () => void, openAssignmentModal: () => void, 
    handleLocalDragStart: () => void, handleLocalDragOver: () => void, handleLocalDragLeave: () => void, 
    handleLocalDrop: () => void, handleDragEnd: () => void, draggedEntryId: null, 
    permissions: ScreenAccessProps['permissions'] 
  } = {
    appData: appData,
    periodSettings: appData.periodSettings,
    getEntryDisplay: getEntryDisplay,
    tableView: 'daysAsCols' as const,
    isPrint: true,
    handleSlotContextMenu: () => {},
    onSlotSelect: () => {},
    openAssignmentModal: () => {},
    handleLocalDragStart: () => {},
    handleLocalDragOver: () => {},
    handleLocalDragLeave: () => {},
    handleLocalDrop: () => {},
    handleDragEnd: () => {},
    draggedEntryId: null,
    permissions: permissions,
  };

  const orgName = appData.organizationSettings?.name || 'Timetable';
  const semester = appData.organizationSettings?.semester || 'N/A';
  const academicYear = appData.organizationSettings?.academicYear || 'N/A';
  const logoUrl = appData.organizationSettings?.logoUrl || null;
  const academicDirectorName = appData.organizationSettings?.deputyDirectorName || '';
  const academicDirectorTitle = appData.organizationSettings?.deputyDirectorPosition || 'รองผู้อำนวยการฝ่ายบริหารวิชาการ';
  const schoolDirectorName = appData.organizationSettings?.directorName || '';
  const schoolDirectorTitle = appData.organizationSettings?.directorPosition || `ผู้อำนวยการโรงเรียน${orgName}`;

  return (
    <div id="batchPrintArea" className={`printable-area printable-area-batch layout-${layout} orientation-${orientation} print:block bg-white fixed inset-0 z-[9999] overflow-visible w-full`}>
      <style>{`
        @media screen {
          #batchPrintArea { display: none !important; }
        }
        @media print { 
          body { visibility: hidden; }
          #batchPrintArea { visibility: visible; display: block !important; position: absolute; left: 0; top: 0; }
          @page { size: A4 ${orientation}; margin: 0.75cm; } 
        }
      `}</style>
      
      {itemsToRender.map(item => {
        let scheduleTypeTitle = 'ตารางสอน';
        let line2Text = '';
        if (itemType === 'teacher') {
            const teacher = item as Teacher;
            scheduleTypeTitle = 'ตารางสอนรายบุคคล';
            const codePrefix = teacher.teacherCode ? `${teacher.teacherCode} ` : '';
            const deptSuffix = teacher.department ? ` (กลุ่มสาระฯ${teacher.department})` : '';
            line2Text = `ครูผู้สอน: ${codePrefix}${teacher.name || 'N/A'}${deptSuffix}`;
        } else if (itemType === 'gradeLevel') {
            const grade = item as GradeLevel;
            scheduleTypeTitle = 'ตารางเรียนประจำชั้น';
            let classInfo = grade.name || 'N/A';
            if (grade.homeroomPhysicalRoomId && !checkIsParentGradeUtil(grade.id, appData.gradeLevels)) {
                const cl = appData.physicalRooms.find(c => c.id === grade.homeroomPhysicalRoomId);
                if (cl?.name) {
                    classInfo += ` (ห้อง ${cl.name})`;
                }
            }
            line2Text = `ระดับชั้น/ห้อง: ${classInfo}`;
        } else if (itemType === 'physicalRoom') {
            const room = item as PhysicalRoom;
            scheduleTypeTitle = 'ตารางการใช้ห้องเรียน';
            const roomCodeSuffix = room.code ? ` (${room.code})` : '';
            line2Text = `ห้องเรียน: ${room.name || 'N/A'}${roomCodeSuffix}`;
        }

        return (
          <div key={item.id} className="printed-item-container mb-8 pb-4" style={{ pageBreakInside: layout === '1x2_per_page' ? 'avoid' : 'auto', pageBreakAfter: layout === '1_per_page' ? 'always' : 'auto' }}>
            <div className={`schedule-print-header-base ${itemType}-schedule-print-header border-b-2 border-slate-900 pb-2 mb-2.5 flex items-center gap-3`}>
              {logoUrl && (
                <img src={logoUrl} alt="School Logo" className="h-14 w-14 object-contain shrink-0" />
              )}
              <div className="flex flex-col justify-center flex-1 min-w-0">
                <div className="text-base font-bold text-slate-900 leading-tight">
                  {orgName} <span className="font-normal mx-1">|</span> {scheduleTypeTitle} <span className="font-normal mx-1">|</span> ภาคเรียนที่ {semester} ปีการศึกษา {academicYear}
                </div>
                <div className="text-sm font-semibold text-slate-800 leading-tight mt-0.5">
                  {line2Text}
                </div>
              </div>
            </div>
            
            <div className="actual-schedule-table-container">
              {itemType === 'teacher' && <TeacherScheduleTable {...commonTableProps} itemId={item.id} />}
              {itemType === 'gradeLevel' && <GradeLevelScheduleTable {...commonTableProps} itemId={item.id} gradeHierarchyHelpers={{ getParentGradeLevelId, isChildOf }} />}
              {itemType === 'physicalRoom' && <RoomUsageScheduleTable {...commonTableProps} itemId={item.id} />}
            </div>

            <div className="teacher-schedule-print-footer mt-6 mb-2 border-t border-dashed border-slate-300 pt-3 flex justify-between text-center text-xs" style={{ pageBreakInside: 'avoid' }}>
                <div className="w-[45%] text-center px-4">
                    <div className="mb-1 leading-snug">ลงชื่อ ........................................................ ผู้เสนออนุมัติ</div>
                    <div className="mb-1 leading-snug">({academicDirectorName || '........................................................'})</div>
                    <div className="leading-snug text-slate-700">{academicDirectorTitle}</div>
                </div>
                <div className="w-[45%] text-center px-4">
                    <div className="mb-1 leading-snug">ลงชื่อ ........................................................ ผู้อนุมัติ</div>
                    <div className="mb-1 leading-snug">({schoolDirectorName || '........................................................'})</div>
                    <div className="leading-snug text-slate-700">{schoolDirectorTitle}</div>
                </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
