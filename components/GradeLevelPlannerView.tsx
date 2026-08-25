import { formatRoomDisplay, formatRoomShort } from "../utils/stringUtils";

import React, { useState, useMemo, useEffect, DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { AppData, DayOfWeek, PeriodSetting, ScheduleEntry, Subject, Teacher, PhysicalRoom, GradeLevel, AssignmentModalContext, ContextMenuTargetInfo, ScreenAccessProps, OrganizationSettings, SingleScheduleTableProps, PrintWithOptionsModalProps } from '../types';
import { DAYS_OF_WEEK_ORDERED, Icons } from '../constants';
import { isParentGrade as checkIsParentGradeUtil, getParentGradeLevelId as getParentIdUtil } from './scheduleUtils';
import Modal from './Modal';

type TableView = 'daysAsCols' | 'periodsAsCols';

// Extracted table rendering logic for use in batch printing
export const GradeLevelScheduleTable: React.FC<SingleScheduleTableProps & {
  selectedCohort?: string;
  handleSlotContextMenu: (event: ReactMouseEvent<HTMLTableCellElement> | React.TouchEvent<HTMLTableCellElement>, targetInfo: ContextMenuTargetInfo) => void;
  onSlotSelect: (day: DayOfWeek, period: number) => void;
  openAssignmentModal: (context: AssignmentModalContext, entry?: ScheduleEntry) => void;
  handleLocalDragStart: (event: DragEvent<HTMLDivElement>, entryId: string, entryData: ScheduleEntry) => void;
  handleLocalDragOver: (event: DragEvent<HTMLTableCellElement>) => void;
  handleLocalDragLeave: (event: DragEvent<HTMLTableCellElement>) => void;
  handleLocalDrop: (event: DragEvent<HTMLTableCellElement>, targetDay: DayOfWeek, targetPeriodIndex: number) => void;
  handleDragEnd: (event: DragEvent<HTMLDivElement>) => void;
  draggedEntryId: string | null;
  permissions: ScreenAccessProps['permissions'];
  gradeHierarchyHelpers: { 
    getParentGradeLevelId: (childGradeLevelId: string, allGradeLevels: GradeLevel[]) => string | null;
    isChildOf: (childGradeLevelId: string, parentGradeLevelId: string, allGradeLevels: GradeLevel[]) => boolean;
  };
}> = ({
  appData, periodSettings, itemId: selectedGradeLevelId, getEntryDisplay, tableView,
  handleSlotContextMenu, onSlotSelect, openAssignmentModal,
  handleLocalDragStart, handleLocalDragOver, handleLocalDragLeave, handleLocalDrop, handleDragEnd,
  draggedEntryId, permissions, gradeHierarchyHelpers, isPrint, selectedCohort,
  startTouchDrag, handleTouchMove, finishTouchDrag
}) => {
  const { gradeLevels } = appData;
  const scheduleEntries = Array.isArray(appData.scheduleEntries) ? appData.scheduleEntries : [];
  const longPressTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleTouchStart = (e: React.TouchEvent<HTMLTableCellElement | HTMLDivElement>, targetInfo: ContextMenuTargetInfo) => {
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    longPressTimeoutRef.current = setTimeout(() => {
      handleSlotContextMenu(e as any, targetInfo);
      longPressTimeoutRef.current = null;
    }, 500);
  };

  const handleTouchCancel = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  // Fallback if selectedCohort isn't passed for some reason
  const cohortFilter = selectedCohort || 'ทั้งหมด';
  const getParentGradeLevelIdFromUtil = getParentIdUtil;
  const checkIsParentGrade = checkIsParentGradeUtil;
  const selectedGradeLevel = gradeLevels.find(gl => gl.id === selectedGradeLevelId);

  const renderTableCellForBatch = (day: DayOfWeek, periodIndex: number) => {
    if (!selectedGradeLevelId) return <td key={`${day}-${periodIndex}`} className="p-1 border border-slate-300 h-28 min-h-[7rem]"></td>;
    
        let cellEntries = scheduleEntries.filter(e =>
      e.gradeLevelId === selectedGradeLevelId &&
      e.day === day &&
      e.period === periodIndex
    );
    if (cohortFilter !== 'ทั้งหมด') {
        cellEntries = cellEntries.filter(e => !e.cohort || e.cohort === cohortFilter);
    }

    let inheritedFromParentInfo: { parentGradeName: string } | null = null;
    if (cellEntries.length === 0) {
        const parentId = getParentGradeLevelIdFromUtil(selectedGradeLevelId, gradeLevels);
        if (parentId) {
            const parentEntries = scheduleEntries.filter(e => 
                e.gradeLevelId === parentId &&
                e.day === day &&
                e.period === periodIndex
            );
            if (parentEntries.length > 0) {
                cellEntries = parentEntries; 
                const parentGrade = gradeLevels.find(gl => gl.id === parentId);
                inheritedFromParentInfo = { parentGradeName: parentGrade?.name || 'Parent Grade' };
            }
        }
    }

    const periodInfo = periodSettings[periodIndex];
    const periodLabel = periodInfo?.label || `P${periodIndex}`; 
    const periodTimeTooltip = periodInfo ? `${periodInfo.startTime} - ${periodInfo.endTime}` : '';

    const isLocked = !!appData.organizationSettings?.isLocked;
    const isAssistant = appData.currentUser?.role === 'assistant';
    const assignedDepts = appData.currentUser?.assignedDepartments || [];

    const getEntryDepts = (entryItem: ScheduleEntry) => {
        const depts = new Set<string>();
        const subject = appData.subjects.find(s => s.id === entryItem.subjectId);
        if (subject && (subject as any).department) depts.add((subject as any).department);
        entryItem.teacherIds.forEach(tid => {
            const t = appData.teachers.find(teacher => teacher.id === tid);
            if (t && t.department) depts.add(t.department);
        });
        appData.teacherSubjectAssignments.forEach(tsa => {
            if (tsa.subjectId === entryItem.subjectId && tsa.gradeLevelId === entryItem.gradeLevelId && entryItem.teacherIds.includes(tsa.teacherId)) {
                if (tsa.department) depts.add(tsa.department);
            }
        });
        return Array.from(depts);
    };

    const hasAssistantAccess = (entryItem: ScheduleEntry) => {
        if (!isAssistant) return true;
        if (assignedDepts.length === 0) return false;
        const depts = getEntryDepts(entryItem);
        return depts.some(d => assignedDepts.includes(d));
    };

    return (
        <td 
          key={`${day}-${periodIndex}`} 
          data-day={day}
          data-period={periodIndex}
          data-droppable="true"
          data-grade-level-id={selectedGradeLevelId}
          className={`p-1 border border-slate-300 align-top relative group min-w-0 transition-colors duration-150 ${tableView === 'daysAsCols' ? 'min-h-[80px] h-auto' : 'h-28 min-h-[7rem]'} hover:bg-slate-50`}
          style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
          onDragOver={handleLocalDragOver}
          onDragLeave={handleLocalDragLeave}
          onDrop={(e) => handleLocalDrop(e, day, periodIndex)}
          onClick={(e) => { 
            if (e.button === 0) onSlotSelect(day, periodIndex);
          }} 
          onContextMenu={(e) => {
             // For context menu on cell with multiple entries, we might just pass the first entry or undefined
             handleSlotContextMenu(e, { day, period: periodIndex, entryId: cellEntries[0]?.id, currentGradeLevelId: selectedGradeLevelId, viewType: 'gradeLevelPlanner' });
          }}
          onTouchStart={(e) => handleTouchStart(e, { day, period: periodIndex, entryId: cellEntries[0]?.id, currentGradeLevelId: selectedGradeLevelId, viewType: 'gradeLevelPlanner' })}
          onTouchEnd={handleTouchCancel}
          onTouchMove={handleTouchCancel}
          aria-label={`Slot for ${day}, ${periodLabel} (${periodTimeTooltip}).`}
          role="gridcell"
          tabIndex={0}
          onKeyDown={(e) => { 
            if (e.key === 'Enter' || e.key === ' ') onSlotSelect(day, periodIndex);
          }}
        >
        {cellEntries.length > 0 ? (
          <div className="flex flex-col gap-1 h-full print:gap-0 print:overflow-hidden">
            {cellEntries.map(entry => {
              const displayData = getEntryDisplay(entry);
              const isBeingDragged = entry.id === draggedEntryId;
              const teacherNames = displayData?.teachers.map(t => t.name).join(', ');
              
              let isDraggable = false;
              let cursorClass = 'cursor-default';
              let lockTooltip = '';
              
              const isEntryActuallyForParentGrade = checkIsParentGrade(entry.gradeLevelId, gradeLevels);
              if (inheritedFromParentInfo) {
                  isDraggable = false; 
              } else {
                  if (isLocked) {
                      isDraggable = false;
                      cursorClass = 'cursor-not-allowed';
                      lockTooltip = '\n[LOCKED] This term is locked.';
                  } else if (!hasAssistantAccess(entry)) {
                      isDraggable = false;
                      cursorClass = 'cursor-not-allowed';
                      lockTooltip = '\n[RESTRICTED] Admin access required';
                  } else {
                      if (isEntryActuallyForParentGrade) { 
                          isDraggable = permissions.canPerformManagerActions;
                      } else { 
                          isDraggable = permissions.canModifyScheduleEntries;
                      }
                  }
              }
              if (isDraggable) {
                  cursorClass = 'cursor-grab';
              }
              
              const titleText = displayData ? `Subject: ${displayData.subject?.name}\nTeacher(s): ${teacherNames}\nCohort: ${entry.cohort || 'All'}\nRoom: ${formatRoomDisplay(displayData?.physicalRoom)}\nDay: ${day}, P${periodLabel}\n${lockTooltip}` : '';
              
              return (
                <div
                  key={entry.id}
                  draggable={isDraggable}
                  onDragStart={(e) => { e.stopPropagation(); if(isDraggable) handleLocalDragStart(e, entry.id, entry); }} 
                  onDragEnd={(e) => { e.stopPropagation(); handleDragEnd(e); }}
                  onContextMenu={(e) => {
                     e.stopPropagation();
                     handleSlotContextMenu(e, { day, period: periodIndex, entryId: entry.id, currentGradeLevelId: selectedGradeLevelId, viewType: 'gradeLevelPlanner' });
                  }}
                  onTouchStart={(e) => { e.stopPropagation(); handleTouchStart(e, { day, period: periodIndex, entryId: entry.id, currentGradeLevelId: selectedGradeLevelId, viewType: 'gradeLevelPlanner' }); if (isDraggable && startTouchDrag) startTouchDrag(e, entry.id, entry); }}
                  onTouchEnd={(e) => { handleTouchCancel(); if (isDraggable && finishTouchDrag) finishTouchDrag(e); }}
                  onTouchMove={(e) => { handleTouchCancel(); if (isDraggable && handleTouchMove) handleTouchMove(e); }}
                  style={{ borderLeftColor: displayData?.subject?.color || '#cbd5e1', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
                  className={`bg-white p-1.5 rounded shadow-sm flex flex-col border-l-4 ${cursorClass} hover:shadow-lg transition-all text-xs ${isBeingDragged ? 'opacity-50 ring-2 ring-blue-500' : (isDraggable ? 'hover:ring-1 hover:ring-blue-300' : '')} ${inheritedFromParentInfo ? 'opacity-75 bg-slate-50' : ''} print:p-0 print:border-l-2 print:flex-1 print:min-h-0 print:justify-center`}
                  title={titleText}
                >
                  {isPrint ? (
                    <div className="flex flex-col items-center justify-center text-center overflow-hidden w-full h-full">
                       <div className="font-bold text-[10px] leading-tight text-slate-900 truncate w-full px-0.5">
                          {displayData?.subject?.subjectCode || displayData?.subject?.name}
                       </div>
                       {entry.cohort && (
                          <div className="text-[9px] text-blue-600 font-medium truncate w-full px-0.5">({entry.cohort})</div>
                       )}
                       <div className="text-[9px] leading-tight text-slate-800 font-medium truncate w-full px-0.5">
                          {teacherNames}
                       </div>
                       <div className="text-[9px] leading-tight text-slate-800 font-medium truncate w-full px-0.5">
                          {formatRoomShort(displayData?.physicalRoom)}
                       </div>
                    </div>
                  ) : (
                  <div>
                    <div className="font-semibold text-xs leading-tight text-slate-800 truncate" style={{ color: displayData?.subject?.color || 'inherit' }}>
                      {displayData?.subject?.subjectCode || displayData?.subject?.name}
                      {entry.cohort && <span className="ml-1 text-[10px] text-blue-600 bg-blue-50 px-1 py-0.5 rounded">[{entry.cohort}]</span>}
                    </div>
                    <div className="text-xxs leading-tight text-slate-600 truncate flex items-center mt-0.5" title={teacherNames}>
                      <Icons.Teacher size={10} className="inline mr-1 flex-shrink-0" />
                      <span className="truncate">{teacherNames}</span>
                    </div>
                    <div className="text-xxs leading-tight text-slate-500 truncate flex items-center mt-0.5" title={formatRoomDisplay(displayData?.physicalRoom)}>
                       <Icons.PhysicalRoom size={10} className="inline mr-1 flex-shrink-0" />
                       <span className="truncate">
                          {formatRoomShort(displayData?.physicalRoom)}
                       </span>
                    </div>
                  </div>
                  )}
                  <div className="mt-auto pt-0.5 flex-none"> 
                    {inheritedFromParentInfo && (
                      <div className="text-[9px] text-sky-600 truncate" title={`Inherited from ${inheritedFromParentInfo.parentGradeName}`}>
                          Inherited: {inheritedFromParentInfo.parentGradeName}
                      </div>
                    )}
                     {entry.totalInBlock && entry.totalInBlock > 1 && !isPrint && (
                      <div className="text-[9px] text-purple-600 truncate">
                          Block {entry.blockIndex !== undefined ? entry.blockIndex + 1 : ''}/{entry.totalInBlock}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <button 
            onClick={(e) => { 
                e.stopPropagation(); 
                let canOpenModal = permissions.canModifyScheduleEntries;
                if(selectedGradeLevelId && checkIsParentGrade(selectedGradeLevelId, gradeLevels)) {
                    canOpenModal = permissions.canPerformManagerActions;
                }
                if(selectedGradeLevelId && e.button === 0 && canOpenModal) {
                     openAssignmentModal({ viewType: 'gradeLevelPlanner', day, period: periodIndex, fixedGradeLevelId: selectedGradeLevelId });
                }
            }}
            className="w-full h-full min-h-[4rem] flex items-center justify-center text-slate-300 hover:text-blue-500 transition-colors rounded opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer disabled:cursor-not-allowed disabled:hover:text-slate-300"
            aria-label={`Add assignment for ${selectedGradeLevel?.name || 'grade level'} to ${day}, ${periodLabel} (${periodTimeTooltip})`}
            title={(selectedGradeLevelId && checkIsParentGrade(selectedGradeLevelId, gradeLevels) && !permissions.canPerformManagerActions) ? "Only managers can assign to parent grades" : (permissions.canModifyScheduleEntries ? `Add to ${day}, ${periodLabel} (${periodTimeTooltip})` : "Permission denied")}
            disabled={!selectedGradeLevelId || (checkIsParentGrade(selectedGradeLevelId, gradeLevels) && !permissions.canPerformManagerActions && !permissions.canModifyScheduleEntries) || (!checkIsParentGrade(selectedGradeLevelId, gradeLevels) && !permissions.canModifyScheduleEntries)}
          >
            <Icons.Add size={20} />
             <span className="ml-1 text-xs hidden sm:inline">Assign</span>
          </button>
        )}
      </td>
    );
  };
  if (periodSettings.length === 0 && selectedGradeLevelId) {
    return <p className="text-center text-slate-500 py-8">Period settings are not configured.</p>;
  }
  if (!selectedGradeLevelId) {
     return <p className="text-center text-slate-500 py-8">Please select a grade level to view its schedule.</p>;
  }

  const displayDays = appData.organizationSettings?.operatingDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as DayOfWeek[];

  return (
    <div className="overflow-x-auto shadow-md rounded-lg border border-slate-200 bg-white">
      <table className="w-full divide-y divide-slate-200 border-collapse table-fixed">
        <thead className="bg-slate-100">
          <tr>
            <th className="sticky left-0 bg-slate-100 z-10 px-2 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-16 md:w-24 border-r border-slate-300"
                title={tableView === 'periodsAsCols' ? 'Day / Period' : 'Period / Day'}>
              {tableView === 'daysAsCols' ? 'Day / P' : 'P / Day'}
            </th>
            {tableView === 'daysAsCols' 
              ? periodSettings.map((period, index) => (
                  <th key={`period-header-${index}`} scope="col" 
                      className="px-2 py-2 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider min-w-0"
                      title={`${period.startTime} - ${period.endTime}`}>
                    {period.label}
                  </th>
                ))
              : displayDays.map(day => ( 
                  <th key={day} scope="col" className="px-2 py-2 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider min-w-0" title={day}>
                    {isPrint ? day : (
                      <>
                        <span className="print:hidden">{day.substring(0, 3)}</span>
                        <span className="hidden print:inline">{day}</span>
                      </>
                    )}
                  </th>
                ))
              }
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {tableView === 'daysAsCols' 
            ? displayDays.map(day => (
                <tr key={day}>
                  <td className="sticky left-0 bg-white px-2 py-2 text-xs font-semibold text-slate-700 text-center border-r border-slate-300 z-10" title={day}>
                    {isPrint ? day : (
                      <>
                        <span className="print:hidden">{day.substring(0, 3)}</span>
                        <span className="hidden print:inline">{day}</span>
                      </>
                    )}
                  </td>
                  {periodSettings.map((_, periodIndex) => renderTableCellForBatch(day, periodIndex))}
                </tr>
              ))
            : periodSettings.map((period, periodIndex) => ( 
                <tr key={`period-row-${periodIndex}`}>
                  <td className="sticky left-0 bg-white px-2 py-2 text-xs font-semibold text-slate-700 text-center border-r border-slate-300 z-10"
                      title={`${period.startTime} - ${period.endTime}`}>
                    {period.label}
                  </td>
                  {displayDays.map(day => renderTableCellForBatch(day, periodIndex))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
};


interface GradeLevelPlannerViewPropsExtended extends ScreenAccessProps {
  appData: AppData;
  periodSettings: PeriodSetting[];
  openAssignmentModal: (context: AssignmentModalContext, entry?: ScheduleEntry) => void;
  handleDragStart: (event: DragEvent<HTMLDivElement>, entryId: string, entryData: ScheduleEntry) => void;
  handleDropEntry: (targetDay: DayOfWeek, targetPeriodIndex: number, targetContext: { gradeLevelId: string }) => void;
  handleDragEnd: (event: DragEvent<HTMLDivElement>) => void;
  startTouchDrag: (e: React.TouchEvent, entryId: string, entryData: ScheduleEntry) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  finishTouchDrag: (e: React.TouchEvent) => void;
  draggedEntryId: string | null;
  onSlotSelect: (day: DayOfWeek, period: number) => void;
  getEntryDisplay: (entry: ScheduleEntry) => { subject?: Subject, teachers: Teacher[], physicalRoom?: PhysicalRoom, gradeLevel?: GradeLevel }; 
  handleSlotContextMenu: (event: ReactMouseEvent<HTMLTableCellElement>, targetInfo: ContextMenuTargetInfo) => void;
  gradeHierarchyHelpers: { 
    getParentGradeLevelId: (childGradeLevelId: string, allGradeLevels: GradeLevel[]) => string | null;
    isChildOf: (childGradeLevelId: string, parentGradeLevelId: string, allGradeLevels: GradeLevel[]) => boolean;
  };
  setAppData: React.Dispatch<React.SetStateAction<AppData>>;
  checkConflicts: (day: DayOfWeek, periodIndex: number, teacherIdsToCheck: string[], physicalRoomIdToCheck: string, gradeLevelIdToCheck: string, subjectIdForCheck: string, currentEditingEntryId: string | null, entryTotalInBlock?: number) => string | null;
  isScheduleVisible: boolean; 
  setIsScheduleVisible: React.Dispatch<React.SetStateAction<boolean>>;
  openPrintOptionsModal: (itemType: 'gradeLevel', currentItemId: string | null) => void;
  onGradeBlockSelect?: (blockInfo: { gradeLevelId: string; day: DayOfWeek; period: number; teacherIds: string[], physicalRoomId?: string } | null) => void;
}


const GradeLevelPlannerView: React.FC<GradeLevelPlannerViewPropsExtended> = (props) => {
  const [selectedCohort, setSelectedCohort] = useState<string>('ทั้งหมด');
  const { 
    appData, periodSettings, openAssignmentModal, 
    handleDragStart, handleDropEntry, handleDragEnd, draggedEntryId, onSlotSelect, getEntryDisplay,
    handleSlotContextMenu, gradeHierarchyHelpers, permissions, setAppData, checkConflicts,
    isScheduleVisible, setIsScheduleVisible, openPrintOptionsModal, onGradeBlockSelect
  } = props;
  const { gradeLevels, teachers, subjects, physicalRooms, teacherSubjectAssignments } = appData; 
  const scheduleEntries = Array.isArray(appData.scheduleEntries) ? appData.scheduleEntries : []; 
  const getParentGradeLevelIdFromUtil = getParentIdUtil;
  const checkIsParentGrade = checkIsParentGradeUtil;

  const [selectedGradeLevelId, setSelectedGradeLevelId] = useState<string | null>(null);
  const [tableView, setTableView] = useState<TableView>('daysAsCols'); 

  const [assistantSubjectId, setAssistantSubjectId] = useState<string>('');
  const [assistantTargetDay, setAssistantTargetDay] = useState<DayOfWeek | ''>('');
  const [assistantTargetPeriod, setAssistantTargetPeriod] = useState<number | ''>('');
  const [isRightAssistantOpen, setIsRightAssistantOpen] = useState(false);

  const allowedAssistantRoles = ['admin', 'manager', 'assistant', 'academic_staff'];

  const selectedGradeLevel = useMemo(() => {
    return gradeLevels.find(gl => gl.id === selectedGradeLevelId);
  }, [selectedGradeLevelId, gradeLevels]);

  useEffect(() => {
    if (!selectedGradeLevelId && gradeLevels.length > 0) {
      setSelectedGradeLevelId(gradeLevels[0].id);
    }
    if (selectedGradeLevelId && !gradeLevels.find(gl => gl.id === selectedGradeLevelId)) {
        setSelectedGradeLevelId(gradeLevels.length > 0 ? gradeLevels[0].id : null);
    }
  }, [gradeLevels, selectedGradeLevelId]);

  const toggleTableView = () => {
    setTableView(prev => prev === 'daysAsCols' ? 'periodsAsCols' : 'daysAsCols');
  };
  
  const handleLocalDrop = (event: DragEvent<HTMLTableCellElement>, targetDay: DayOfWeek, targetPeriodIndex: number) => {
    event.preventDefault();
    event.currentTarget.classList.remove('bg-blue-100');
    if (selectedGradeLevelId) {
      if (checkIsParentGrade(selectedGradeLevelId, gradeLevels) && !permissions.canPerformManagerActions) {
        alert("Only managers can modify entries for parent grade levels.");
        (window as any)._tempDragData = null; 
        return;
      }
      handleDropEntry(targetDay, targetPeriodIndex, { gradeLevelId: selectedGradeLevelId });
    }
  };
  
  const handleLocalDragOver = (event: DragEvent<HTMLTableCellElement>) => {
    event.preventDefault(); 
    event.dataTransfer.dropEffect = "move";
    event.currentTarget.classList.add('bg-blue-100'); 
  };
  
  const handleLocalDragLeave = (event: DragEvent<HTMLTableCellElement>) => {
    event.currentTarget.classList.remove('bg-blue-100'); 
  };
  
  const handleLocalDragStartInternal = (event: DragEvent<HTMLDivElement>, entryId: string, entryData: ScheduleEntry) => {
    const dataToTransfer = { entryId, blockId: entryData.blockId, blockIndex: entryData.blockIndex, totalInBlock: entryData.totalInBlock };
    (window as any)._tempDragData = JSON.stringify(dataToTransfer); 
    handleDragStart(event, entryId, entryData); 
  };

  const relevantTeacherAssignments = useMemo(() => {
    if (!selectedGradeLevelId) return [];
    return teacherSubjectAssignments.filter(tsa => 
      tsa.gradeLevelId === selectedGradeLevelId || 
      (gradeHierarchyHelpers.isChildOf(selectedGradeLevelId, tsa.gradeLevelId, gradeLevels)) || 
      (checkIsParentGrade(tsa.gradeLevelId, gradeLevels) && gradeHierarchyHelpers.isChildOf(selectedGradeLevelId, tsa.gradeLevelId, gradeLevels))
    );
  }, [selectedGradeLevelId, teacherSubjectAssignments, gradeHierarchyHelpers, gradeLevels, checkIsParentGrade]);

  const assistantSelectedTSA = relevantTeacherAssignments.find(tsa => tsa.subjectId === assistantSubjectId);
  const assistantSelectedSubject = subjects.find(s => s.id === assistantSubjectId);
  const assistantSelectedTeacherIds = assistantSelectedTSA ? [assistantSelectedTSA.teacherId] : [];

  const smartSuggestions = useMemo(() => {
    if (!assistantSelectedSubject || !selectedGradeLevelId || assistantSelectedTeacherIds.length === 0) return [];
    const scheduledPeriods = scheduleEntries.filter(e => 
      (e.gradeLevelId === selectedGradeLevelId || (checkIsParentGrade(selectedGradeLevelId, gradeLevels) && gradeHierarchyHelpers.isChildOf(e.gradeLevelId, selectedGradeLevelId, gradeLevels)) )
      && e.subjectId === assistantSubjectId
    ).length;
    
    if (assistantSelectedSubject.periodsPerWeek !== undefined && scheduledPeriods >= assistantSelectedSubject.periodsPerWeek) {
      return [];
    }
    
    const operatingDays = appData.organizationSettings?.operatingDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as DayOfWeek[];
    const suggestions: {day: DayOfWeek, periodIndex: number}[] = [];
    
    for (const day of operatingDays) {
      for (let pIndex = 0; pIndex < periodSettings.length; pIndex++) {
        const conflict = checkConflicts(day, pIndex, assistantSelectedTeacherIds, '', selectedGradeLevelId, assistantSubjectId, null, 1);
        if (!conflict) {
          suggestions.push({day, periodIndex: pIndex});
        }
      }
    }
    return suggestions.slice(0, 3);
  }, [assistantSelectedSubject, selectedGradeLevelId, assistantSelectedTeacherIds, scheduleEntries, gradeLevels, gradeHierarchyHelpers, checkIsParentGrade, appData.organizationSettings?.operatingDays, periodSettings, checkConflicts, assistantSubjectId]);

  const activeConflict = useMemo(() => {
    if (!assistantSelectedSubject || !selectedGradeLevelId || assistantSelectedTeacherIds.length === 0 || !assistantTargetDay || assistantTargetPeriod === '') return null;
    return checkConflicts(assistantTargetDay, Number(assistantTargetPeriod), assistantSelectedTeacherIds, '', selectedGradeLevelId, assistantSubjectId, null, 1);
  }, [assistantSelectedSubject, selectedGradeLevelId, assistantSelectedTeacherIds, assistantTargetDay, assistantTargetPeriod, checkConflicts, assistantSubjectId]);
  
  const teacherInsights = useMemo(() => {
    if (assistantSelectedTeacherIds.length === 0) return null;
    const tId = assistantSelectedTeacherIds[0];
    const teacher = teachers.find(t => t.id === tId);
    if (!teacher) return null;
    
    const teacherEntries = scheduleEntries.filter(e => e.teacherIds.includes(tId));
    
    let hasExcessiveConsecutive = false;
    const entriesByDay = teacherEntries.reduce((acc, entry) => {
      if (!acc[entry.day]) acc[entry.day] = [];
      acc[entry.day].push(entry.period);
      return acc;
    }, {} as Record<string, number[]>);
    
    for (const day in entriesByDay) {
      const periods = entriesByDay[day].sort((a, b) => a - b);
      let consecutive = 1;
      let maxConsecutive = 1;
      for (let i = 1; i < periods.length; i++) {
        if (periods[i] === periods[i-1] + 1) {
          consecutive++;
          if (consecutive > maxConsecutive) maxConsecutive = consecutive;
        } else {
          consecutive = 1;
        }
      }
      if (maxConsecutive >= 4) {
        hasExcessiveConsecutive = true;
        break;
      }
    }

    return {
      teacher,
      totalPeriods: teacherEntries.length,
      hasExcessiveConsecutive
    };
  }, [assistantSelectedTeacherIds, teachers, scheduleEntries]);

  const applyAssistantSuggestion = (day: DayOfWeek, periodIndex: number) => {
    if (appData.organizationSettings?.isLocked) {
      alert("ตารางเรียนถูกล็อค ไม่สามารถแก้ไขได้");
      return;
    }
    if (!selectedGradeLevelId || !assistantSubjectId || assistantSelectedTeacherIds.length === 0) return;
    const newEntry: ScheduleEntry = {
      id: crypto.randomUUID(),
      day: day,
      period: periodIndex,
      gradeLevelId: selectedGradeLevelId,
      subjectId: assistantSubjectId,
      teacherIds: assistantSelectedTeacherIds,
      totalInBlock: 1,
    };
    setAppData(prev => ({ ...prev, scheduleEntries: [...prev.scheduleEntries, newEntry] }));
    setAssistantTargetDay('');
    setAssistantTargetPeriod('');
  };

  return (
    <div className="flex w-full relative">
      <div className={`flex flex-col space-y-6 flex-grow transition-all duration-300 p-1 ${isRightAssistantOpen ? 'pr-4 w-[70%]' : 'w-full'}`}>
        <div className="non-printable flex flex-col sm:flex-row justify-between items-center gap-4 p-4 bg-white shadow-md rounded-lg border border-slate-200">
          <div className="flex items-center">
            <Icons.Schedule size={28} className="mr-3 text-blue-600" />
            <h2 className="text-xl font-semibold text-slate-800">
              Grade Level: {selectedGradeLevel?.name || "Select Grade"}
            </h2>
          </div>
          <div className="flex items-center gap-x-2">
              <select
                  id="gradeLevelSelect"
                  value={selectedGradeLevelId || ""}
                  onChange={(e) => setSelectedGradeLevelId(e.target.value)}
                  className="p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm text-sm"
                  aria-label="Select Grade Level"
              >
                  <option value="" disabled>-- Select Grade Level --</option>
                  {gradeLevels.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })).map(gl => (
                      <option key={gl.id} value={gl.id}>{gl.name}</option>
                  ))}
                            </select>
              {selectedGradeLevelId && (
                  <select
                      value={selectedCohort}
                      onChange={(e) => setSelectedCohort(e.target.value)}
                      className="p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm text-sm"
                  >
                      <option value="ทั้งหมด">เลือกกลุ่มเรียน (Filter Cohort)</option>
                      {Array.from(new Set(scheduleEntries.filter(e => e.gradeLevelId === selectedGradeLevelId && e.cohort).map(e => e.cohort))).sort().map(c => (
                          <option key={c} value={c}>{c}</option>
                      ))}
                  </select>
              )}
              <button
                  onClick={() => openPrintOptionsModal('gradeLevel', selectedGradeLevelId)}
                className="flex items-center bg-teal-500 hover:bg-teal-600 text-white font-semibold py-2 px-3 rounded-md shadow-sm transition-colors duration-150 text-sm"
                title="Print Options"
                aria-label="Open print options for grade level schedule"
            >
                <Icons.Printer size={18} className="mr-1.5" />
                Print
            </button>
            <button
              onClick={() => setIsScheduleVisible(!isScheduleVisible)}
              className="p-2 text-slate-600 hover:bg-slate-100 hover:text-blue-600 rounded-md border border-slate-300 shadow-sm"
              title={isScheduleVisible ? "Hide Schedule" : "Show Schedule"}
              aria-label={isScheduleVisible ? "Hide schedule table" : "Show schedule table"}
            >
              {isScheduleVisible ? <Icons.EyeOff size={20} /> : <Icons.Eye size={20} />}
            </button>
            <button 
                onClick={toggleTableView} 
                className="p-2 text-slate-600 hover:bg-slate-100 hover:text-blue-600 rounded-md border border-slate-300 shadow-sm" 
                title={tableView === 'daysAsCols' ? "Switch to: Periods as Rows" : "Switch to: Days as Rows"}
                aria-label="Switch table view"
            >
                <Icons.SwitchView size={20} />
            </button>
        </div>
      </div>
       {isScheduleVisible && selectedGradeLevelId ? (
           <GradeLevelScheduleTable
             selectedCohort={selectedCohort}
             appData={appData}
             periodSettings={periodSettings}
             itemId={selectedGradeLevelId}
             getEntryDisplay={getEntryDisplay}
             tableView={tableView}
             handleSlotContextMenu={handleSlotContextMenu}
             startTouchDrag={props.startTouchDrag}
             handleTouchMove={props.handleTouchMove}
             finishTouchDrag={props.finishTouchDrag}
             onSlotSelect={(day, periodIndex) => {
                onSlotSelect(day, periodIndex);
                if (onGradeBlockSelect && selectedGradeLevelId) {
                    const entry = scheduleEntries.find(e =>
                      e.gradeLevelId === selectedGradeLevelId &&
                      e.day === day &&
                      e.period === periodIndex
                    );
                    onGradeBlockSelect({
                        gradeLevelId: selectedGradeLevelId,
                        day,
                        period: periodIndex,
                        teacherIds: entry ? entry.teacherIds : [],
                        physicalRoomId: entry ? entry.physicalRoomId : undefined
                    });
                }
             }}
             openAssignmentModal={openAssignmentModal}
             handleLocalDragStart={handleLocalDragStartInternal}
             handleLocalDragOver={handleLocalDragOver}
             handleLocalDragLeave={handleLocalDragLeave}
             handleLocalDrop={handleLocalDrop}
             handleDragEnd={handleDragEnd}
             draggedEntryId={draggedEntryId}
             permissions={permissions}
             gradeHierarchyHelpers={gradeHierarchyHelpers}
           />
      ) : (
        <div className="text-center py-16 text-slate-500 bg-white shadow-md rounded-lg border border-slate-200">
            <Icons.EyeOff size={48} className="mx-auto mb-4 text-slate-400" />
            <p className="text-xl mb-2">{!selectedGradeLevelId ? "Please select a grade level." : "Schedule Hidden"}</p>
            {!selectedGradeLevelId ? null : 
              <>
                <p className="text-sm mb-4">The schedule table is currently hidden.</p>
                <button
                    onClick={() => setIsScheduleVisible(true)}
                    className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md shadow-sm transition-colors flex items-center mx-auto"
                >
                    <Icons.Eye size={18} className="mr-2 inline" />
                    Show Schedule
                </button>
              </>
            }
        </div>
      )}

      </div>{/* End Main Panel */}

      {/* Right Assistant Panel Toggle Button (Standby) */}
      {!isRightAssistantOpen && (
        <div className="absolute right-0 top-1/4 -translate-y-1/2 z-20">
          <button 
            onClick={() => setIsRightAssistantOpen(true)}
            className="bg-purple-200 hover:bg-purple-300 text-purple-700 p-2 rounded-l-md shadow-md border border-r-0 border-purple-300 flex items-center justify-center transition-colors"
            title="เปิดแผงผู้ช่วย AI"
          >
            <Icons.Sparkles size={20} />
          </button>
        </div>
      )}

      {/* Right Assistant Panel */}
      {isRightAssistantOpen && (
        <div className="fixed top-0 right-0 h-screen w-[320px] bg-white border-l border-purple-200 shadow-2xl flex flex-col z-50 transform transition-transform duration-300 overflow-y-auto">            
          <div className="flex items-center justify-between p-4 border-b border-purple-200 bg-white">
              <h3 className="font-semibold text-purple-800 flex items-center">
                  <Icons.Sparkles size={18} className="mr-2" />
                  ผู้ช่วยวิเคราะห์คาบว่าง
              </h3>
              <button onClick={() => setIsRightAssistantOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <Icons.Close size={20} />
              </button>
          </div>
          
          <div className="p-4 flex-grow overflow-y-auto space-y-6">
              <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">เลือกวิชาที่จะจัดตาราง</label>
                  <select
                      value={assistantSubjectId}
                      onChange={(e) => {
                          setAssistantSubjectId(e.target.value);
                          setAssistantTargetDay('');
                          setAssistantTargetPeriod('');
                      }}
                      className="w-full p-2 border border-slate-300 rounded focus:ring-purple-500 focus:border-purple-500 text-sm"
                  >
                      <option value="">-- เลือกวิชา --</option>
                      {relevantTeacherAssignments.map(tsa => {
                          const subject = subjects.find(s => s.id === tsa.subjectId);
                          const teacher = teachers.find(t => t.id === tsa.teacherId);
                          return (
                              <option key={`${tsa.subjectId}-${tsa.teacherId}`} value={tsa.subjectId}>
                                  {subject?.name} ({teacher?.name || 'No Teacher'})
                              </option>
                          );
                      })}
                  </select>
              </div>

              {assistantSubjectId && (
                  <>
                      {/* Insights */}
                      {teacherInsights && (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                              <h4 className="text-sm font-semibold text-blue-800 mb-1 flex items-center">
                                  <Icons.Teacher size={16} className="mr-1" />
                                  ข้อมูลครูผู้สอน ({teacherInsights.teacher.name})
                              </h4>
                              <p className="text-xs text-blue-700">ภาระงานในสัปดาห์นี้: <strong>{teacherInsights.totalPeriods} คาบ</strong></p>
                              {teacherInsights.totalPeriods >= 25 && (
                                  <p className="text-xs text-red-600 mt-1 font-medium flex items-center">
                                      <Icons.Warning size={14} className="mr-1" />
                                      ครูมีภาระงานค่อนข้างหนักในสัปดาห์นี้
                                  </p>
                              )}
                              {teacherInsights.hasExcessiveConsecutive && (
                                  <p className="text-xs text-orange-600 mt-1 font-medium flex items-center">
                                      <Icons.Warning size={14} className="mr-1 flex-shrink-0" />
                                      มีสอนติดกันมากกว่า 4 คาบในวันเดียวกัน
                                  </p>
                              )}
                          </div>
                      )}

                      {/* Smart Suggestions */}
                      <div>
                          <h4 className="text-sm font-semibold text-purple-800 mb-2 flex items-center">
                              <Icons.Sparkles size={16} className="mr-1" />
                              ข้อเสนอแนะ 3 คาบที่ว่างตรงกัน
                          </h4>
                          {smartSuggestions.length > 0 ? (
                              <ul className="space-y-2">
                                  {smartSuggestions.map((sug, idx) => {
                                      const periodLabel = periodSettings[sug.periodIndex]?.label || `P${sug.periodIndex}`;
                                      return (
                                          <li key={idx} className="p-2 border border-purple-200 rounded bg-purple-50 flex items-center justify-between">
                                              <span className="text-xs text-purple-800 font-medium">{sug.day}, {periodLabel}</span>
                                              <button 
                                                  onClick={() => applyAssistantSuggestion(sug.day, sug.periodIndex)}
                                                  className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs transition-colors"
                                              >
                                                  เลือก
                                              </button>
                                          </li>
                                      );
                                  })}
                              </ul>
                          ) : (
                              <p className="text-xs text-slate-500 italic p-2 border border-slate-200 rounded bg-slate-50">
                                  ไม่มีคาบว่างที่ตรงกันทั้งห้องเรียนและครูผู้สอน หรือจัดครบจำนวนคาบแล้ว
                              </p>
                          )}
                      </div>

                      {/* Instant Conflict Summary */}
                      <div className="pt-2 border-t border-slate-200">
                          <h4 className="text-sm font-semibold text-slate-700 mb-2">ตรวจสอบการชนกัน</h4>
                          <div className="flex gap-2 mb-2">
                              <select 
                                  value={assistantTargetDay} 
                                  onChange={(e) => setAssistantTargetDay(e.target.value as DayOfWeek)}
                                  className="flex-1 p-1.5 border border-slate-300 rounded text-xs"
                              >
                                  <option value="">-- วัน --</option>
                                  {(appData.organizationSettings?.operatingDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]).map(day => (
                                      <option key={day} value={day}>{day}</option>
                                  ))}
                              </select>
                              <select 
                                  value={assistantTargetPeriod} 
                                  onChange={(e) => setAssistantTargetPeriod(e.target.value)}
                                  className="flex-1 p-1.5 border border-slate-300 rounded text-xs"
                              >
                                  <option value="">-- คาบ --</option>
                                  {periodSettings.map((p, idx) => (
                                      <option key={idx} value={idx}>{p.label}</option>
                                  ))}
                              </select>
                          </div>
                          {assistantTargetDay && assistantTargetPeriod !== '' && (
                              <div className={`p-2 rounded border text-xs ${activeConflict ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
                                  {activeConflict ? (
                                      <div className="flex items-start">
                                          <Icons.Warning size={14} className="mr-1 mt-0.5 flex-shrink-0" />
                                          <span className="whitespace-pre-wrap">{activeConflict}</span>
                                      </div>
                                  ) : (
                                      <div className="flex items-center">
                                          <Icons.Add size={14} className="mr-1 flex-shrink-0" />
                                          ว่างตรงกัน สามารถจัดลงได้
                                      </div>
                                  )}
                                  {!activeConflict && (
                                      <button 
                                          onClick={() => applyAssistantSuggestion(assistantTargetDay, Number(assistantTargetPeriod))}
                                          className="mt-2 w-full py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition-colors"
                                      >
                                          นำไปจัดตาราง
                                      </button>
                                  )}
                              </div>
                          )}
                      </div>
                  </>
              )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GradeLevelPlannerView;
