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
        let rightSideText = '';
        if (itemType === 'teacher') {
            const teacher = item as Teacher;
            rightSideText = `ครูผู้สอน: ${teacher.name || 'N/A'}`;
        } else if (itemType === 'gradeLevel') {
            const grade = item as GradeLevel;
            let classInfo = grade.name || 'N/A';
            if (grade.homeroomPhysicalRoomId && !checkIsParentGradeUtil(grade.id, appData.gradeLevels)) {
                const cl = appData.physicalRooms.find(c => c.id === grade.homeroomPhysicalRoomId);
                if (cl?.name) {
                    classInfo += ` (${cl.name})`;
                }
            }
            rightSideText = `ระดับชั้น/ห้อง: ${classInfo}`;
        } else if (itemType === 'physicalRoom') {
            const room = item as PhysicalRoom;
            rightSideText = `ห้องเรียน: ${room.name || 'N/A'}`;
        }

        return (
          <div key={item.id} className="printed-item-container mb-10 pb-5" style={{ pageBreakInside: layout === '1x2_per_page' ? 'avoid' : 'auto', pageBreakAfter: layout === '1_per_page' ? 'always' : 'auto' }}>
            <div className={`schedule-print-header-base ${itemType}-schedule-print-header border-b-2 border-black pb-1 mb-2.5 flex justify-between items-center`}>
              <div className="flex flex-col items-start justify-center">
                  {logoUrl && <img src={logoUrl} alt="School Logo" className="h-12 mb-1" />}
                  <div className="text-lg font-bold">
                      {orgName} <span className="font-normal mx-1">|</span> ภาคเรียนที่ {semester} ปีการศึกษา {academicYear}
                  </div>
              </div>
              <div className="text-lg font-bold">
                  {rightSideText}
              </div>
            </div>
            
            <div className="actual-schedule-table-container">
              {itemType === 'teacher' && <TeacherScheduleTable {...commonTableProps} itemId={item.id} />}
              {itemType === 'gradeLevel' && <GradeLevelScheduleTable {...commonTableProps} itemId={item.id} gradeHierarchyHelpers={{ getParentGradeLevelId, isChildOf }} />}
              {itemType === 'physicalRoom' && <RoomUsageScheduleTable {...commonTableProps} itemId={item.id} />}
            </div>

            <div className="teacher-schedule-print-footer mt-8 mb-4 border-t border-dashed border-gray-300 pt-4 flex justify-between text-center" style={{ pageBreakInside: 'avoid' }}>
                <div className="w-[45%] text-center px-4">
                    <div className="mb-1 leading-snug">ลงชื่อ ........................................................ ผู้เสนออนุมัติ</div>
                    <div className="mb-1 leading-snug">({academicDirectorName || '........................................................'})</div>
                    <div className="leading-snug">{academicDirectorTitle}</div>
                </div>
                <div className="w-[45%] text-center px-4">
                    <div className="mb-1 leading-snug">ลงชื่อ ........................................................ ผู้อนุมัติ</div>
                    <div className="mb-1 leading-snug">({schoolDirectorName || '........................................................'})</div>
                    <div className="leading-snug">{schoolDirectorTitle}</div>
                </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
