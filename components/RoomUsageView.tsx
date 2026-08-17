import { formatRoomDisplay } from "../utils/stringUtils";

import React, { useState, useMemo, useEffect, DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { AppData, DayOfWeek, PeriodSetting, ScheduleEntry, Subject, Teacher, PhysicalRoom, GradeLevel, AssignmentModalContext, ContextMenuTargetInfo, ScreenAccessProps, OrganizationSettings, SingleScheduleTableProps } from '../types';
import { DAYS_OF_WEEK_ORDERED, Icons } from '../constants';
import { isParentGrade } from './scheduleUtils'; // Import from new utils file

type TableView = 'daysAsCols' | 'periodsAsCols';

// Extracted table rendering logic
export const RoomUsageScheduleTable: React.FC<SingleScheduleTableProps & {
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
}> = ({
  appData, periodSettings, itemId: selectedPhysicalRoomId, getEntryDisplay, tableView,
  handleSlotContextMenu, onSlotSelect, openAssignmentModal,
  handleLocalDragStart, handleLocalDragOver, handleLocalDragLeave, handleLocalDrop, handleDragEnd,
  draggedEntryId, permissions, isPrint, startTouchDrag, handleTouchMove, finishTouchDrag
}) => {
  const { scheduleEntries, gradeLevels, physicalRooms } = appData;
  const selectedPhysicalRoom = physicalRooms.find(c => c.id === selectedPhysicalRoomId);
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

  const renderTableCellForBatch = (day: DayOfWeek, periodIndex: number) => {
    if (!selectedPhysicalRoomId) return <td key={`${day}-${periodIndex}`} className="p-1 border border-slate-300 h-28 min-h-[7rem]"></td>;

    const entry = scheduleEntries.find(e =>
      e.physicalRoomId === selectedPhysicalRoomId &&
      e.day === day &&
      e.period === periodIndex
    );
    const displayInfo = entry ? getEntryDisplay(entry) : null;
    const isBeingDragged = entry && entry.id === draggedEntryId;
    const periodInfo = periodSettings[periodIndex];
    const periodLabel = periodInfo?.label || `P${periodIndex}`; 
    const periodTimeTooltip = periodInfo ? `${periodInfo.startTime} - ${periodInfo.endTime}` : '';
    const teacherNames = displayInfo?.teachers.map(t => t.name).join(', ');

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

    let isDraggable = false;
    let cursorClass = 'cursor-default';
    let lockTooltip = '';

    if (entry) {
      const isEntryForParentGrade = isParentGrade(entry.gradeLevelId, gradeLevels);
      if (isLocked) {
        isDraggable = false;
        cursorClass = 'cursor-not-allowed';
        lockTooltip = '\n[LOCKED] This term is locked. All schedules are read-only.';
      } else if (!hasAssistantAccess(entry)) {
        isDraggable = false;
        cursorClass = 'cursor-not-allowed';
        lockTooltip = '\n[RESTRICTED] Please contact a Manager or Admin to modify this block';
      } else {
        if (isEntryForParentGrade) {
          isDraggable = permissions.canPerformManagerActions;
        } else {
          isDraggable = permissions.canModifyScheduleEntries;
        }
      }
      if (isDraggable) {
        cursorClass = 'cursor-grab';
      }
    }

    const titleText = entry && displayInfo ?
        `Subject: ${displayInfo.subject?.name}\nGrade: ${displayInfo.gradeLevel?.name}\nTeacher(s): ${teacherNames}\nDay: ${day}, Period: ${periodLabel} (${periodTimeTooltip})${entry.totalInBlock && entry.totalInBlock > 1 ? `\nBlock ${entry.blockIndex !== undefined ? entry.blockIndex+1 : ''} of ${entry.totalInBlock}` : ''}${lockTooltip}`
        : `${isLocked ? '[LOCKED] ' : ''}Add to ${day}, ${periodLabel} (${periodTimeTooltip})${isLocked ? ' (Term is locked)' : ''}`;


    return (
      <td
        key={`${day}-${periodIndex}`}
        data-day={day}
        data-period={periodIndex}
        data-droppable="true"
        data-physical-room-id={selectedPhysicalRoomId}
        className={`p-1 border border-slate-300 align-top relative group min-w-0 transition-colors duration-150 
                    ${tableView === 'daysAsCols' ? 'min-h-[80px] h-auto' : 'h-28 min-h-[7rem]'}
                    hover:bg-slate-50`}
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        onDragOver={handleLocalDragOver}
        onDragLeave={handleLocalDragLeave}
        onDrop={(e) => handleLocalDrop(e, day, periodIndex)}
        onClick={(e) => { 
          if (e.button === 0) onSlotSelect(day, periodIndex);
        }} 
        onContextMenu={(e) => handleSlotContextMenu(e, { day, period: periodIndex, entryId: entry?.id, currentPhysicalRoomId: selectedPhysicalRoomId, viewType: 'roomUsage' })}
        onTouchStart={(e) => handleTouchStart(e, { day, period: periodIndex, entryId: entry?.id, currentPhysicalRoomId: selectedPhysicalRoomId, viewType: 'roomUsage' })}
        onTouchEnd={handleTouchCancel}
        onTouchMove={handleTouchCancel}
        aria-label={`Slot for ${day}, ${periodLabel} (${periodTimeTooltip}). ${entry ? `Occupied by ${displayInfo?.subject?.name}` : 'Free slot.'} Right-click for options.`}
        role="gridcell"
        tabIndex={0}
        onKeyDown={(e) => { 
          if (e.key === 'Enter' || e.key === ' ') onSlotSelect(day, periodIndex);
        }}
      >
        {entry && displayInfo ? (
          <div
            draggable={isDraggable}
            onDragStart={(e) => { e.stopPropagation(); if(isDraggable) handleLocalDragStart(e, entry.id, entry); }} 
            onDragEnd={(e) => { e.stopPropagation(); handleDragEnd(e); }}
            style={{ borderLeftColor: displayInfo.subject?.color || '#cbd5e1', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
            onTouchStart={(e) => { e.stopPropagation(); handleTouchStart(e, { day, period: periodIndex, entryId: entry?.id, currentPhysicalRoomId: selectedPhysicalRoomId, viewType: 'roomUsage' }); if (isDraggable && startTouchDrag) startTouchDrag(e, entry.id, entry); }}
            onTouchEnd={(e) => { handleTouchCancel(); if (isDraggable && finishTouchDrag) finishTouchDrag(e); }}
            onTouchMove={(e) => { handleTouchCancel(); if (isDraggable && handleTouchMove) handleTouchMove(e); }}
            className={`bg-white p-1.5 rounded shadow-sm h-full flex flex-col border-l-4 ${cursorClass} hover:shadow-lg transition-all text-xs ${isBeingDragged ? 'opacity-50 ring-2 ring-blue-500' : (isDraggable ? 'hover:ring-1 hover:ring-blue-300' : '')} print:p-0 print:border-l-2 print:flex-1 print:min-h-0 print:justify-center`}
            title={titleText}
          >
            {isPrint ? (
              <div className="flex flex-col flex-grow items-center justify-center text-center overflow-hidden w-full h-full">
                 <div className="font-bold text-[10px] leading-tight text-slate-900 truncate w-full px-0.5">
                    {displayInfo.subject?.subjectCode || displayInfo.subject?.name}
                 </div>
                 <div className="text-[9px] leading-tight text-slate-800 font-medium truncate w-full px-0.5">
                    {teacherNames}
                 </div>
                 <div className="text-[9px] leading-tight text-slate-800 font-medium truncate w-full px-0.5">
                    {displayInfo.gradeLevel?.name}
                 </div>
              </div>
            ) : (
            <div className="flex-grow">
              <div className="font-semibold text-xs leading-tight text-slate-800 truncate" style={{ color: displayInfo.subject?.color || 'inherit' }}>
                {displayInfo.subject?.subjectCode || displayInfo.subject?.name}
              </div>
              <div className="text-xxs leading-tight text-slate-500 truncate flex items-center mt-0.5" title={teacherNames}>
                <Icons.Teacher size={10} className="inline mr-1 flex-shrink-0" />
                <span className="truncate">{teacherNames}</span>
              </div>
              <div className="text-xxs leading-tight text-slate-600 truncate flex items-center mt-0.5">
                <Icons.GradeLevel size={10} className="inline mr-1 flex-shrink-0" />
                 <span className="truncate">{displayInfo.gradeLevel?.name}</span>
              </div>
            </div>
            )}
            <div className="mt-auto pt-0.5 flex-none"> {/* For bottom aligned info */}
                 {entry.totalInBlock && entry.totalInBlock > 1 && !isPrint ? (
                    <div className="text-[9px] text-purple-600 truncate">
                        Block {entry.blockIndex !== undefined ? entry.blockIndex + 1 : ''}/{entry.totalInBlock}
                    </div>
                 ) : null}
            </div>
          </div>
        ) : !isLocked ? (
           <button 
            onClick={(e) => { 
              e.stopPropagation(); 
              if (isLocked) {
                alert("ตารางเรียนประจําภาคเรียนนี้ถูกล็อคอยู่ ไม่สามารถแก้ไขข้อมูลได้ (This academic term is locked. Editing is disabled.)");
                return;
              }
              if(selectedPhysicalRoomId && e.button === 0 && permissions.canModifyScheduleEntries) openAssignmentModal({ viewType: 'roomUsage', day, period: periodIndex, fixedPhysicalRoomId: selectedPhysicalRoomId });
            }}
            className="w-full h-full flex items-center justify-center text-slate-300 hover:text-blue-500 transition-colors rounded opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer disabled:cursor-not-allowed disabled:hover:text-slate-300"
            aria-label={`Add assignment for ${selectedPhysicalRoom?.name || 'physicalRoom'} to ${day}, ${periodLabel} (${periodTimeTooltip})`}
            title={isLocked ? "ตารางเรียนประจําภาคเรียนนี้ถูกล็อคอยู่" : (permissions.canModifyScheduleEntries ? `Add to ${day}, ${periodLabel} (${periodTimeTooltip})` : "Permission denied")}
            disabled={isLocked || !selectedPhysicalRoomId || !permissions.canModifyScheduleEntries}
          >
            <Icons.Add size={20} />
            <span className="ml-1 text-xs hidden sm:inline">Assign</span>
          </button>
        ) : null}
      </td>
    );
  };
  
  if (periodSettings.length === 0 && selectedPhysicalRoomId) {
    return <p className="text-center text-slate-500 py-8">Period settings are not configured.</p>;
  }
   if (!selectedPhysicalRoomId) {
    return <p className="text-center text-slate-500 py-8">Please select a physicalRoom to view its usage.</p>;
  }

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
              : DAYS_OF_WEEK_ORDERED.map(day => ( 
                  <th key={day} scope="col" className="px-2 py-2 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider min-w-0">
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
            ? DAYS_OF_WEEK_ORDERED.map(day => (
                <tr key={day}>
                  <td className="sticky left-0 bg-white px-2 py-2 text-xs font-semibold text-slate-700 text-center border-r border-slate-300 z-10">
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
                  {DAYS_OF_WEEK_ORDERED.map(day => renderTableCellForBatch(day, periodIndex))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
};


interface RoomUsageViewPropsExtended extends ScreenAccessProps {
  appData: AppData;
  periodSettings: PeriodSetting[];
  openAssignmentModal: (context: AssignmentModalContext, entry?: ScheduleEntry) => void;
  handleDragStart: (event: DragEvent<HTMLDivElement>, entryId: string, entryData: ScheduleEntry) => void;
  handleDropEntry: (targetDay: DayOfWeek, targetPeriodIndex: number, targetContext: { physicalRoomId: string }) => void;
  handleDragEnd: (event: DragEvent<HTMLDivElement>) => void;
  startTouchDrag: (e: React.TouchEvent, entryId: string, entryData: ScheduleEntry) => void;
  handleTouchMove: (e: React.TouchEvent) => void;
  finishTouchDrag: (e: React.TouchEvent) => void;
  draggedEntryId: string | null;
  onSlotSelect: (day: DayOfWeek, period: number) => void;
  getEntryDisplay: (entry: ScheduleEntry) => { subject?: Subject, teachers: Teacher[], physicalRoom?: PhysicalRoom, gradeLevel?: GradeLevel }; 
  handleSlotContextMenu: (event: ReactMouseEvent<HTMLTableCellElement>, targetInfo: ContextMenuTargetInfo) => void;
  isScheduleVisible: boolean; 
  setIsScheduleVisible: React.Dispatch<React.SetStateAction<boolean>>;
  openPrintOptionsModal: (itemType: 'physicalRoom', currentItemId: string | null) => void;
  selectedPhysicalRoomId: string | null;
  onPhysicalRoomIdChange: (id: string | null) => void;
}

const RoomUsageView: React.FC<RoomUsageViewPropsExtended> = ({
  appData,
  periodSettings,
  openAssignmentModal,
  handleDragStart,
  handleDropEntry,
  handleDragEnd,
  draggedEntryId,
  onSlotSelect,
  getEntryDisplay,
  handleSlotContextMenu,
  permissions, 
  isScheduleVisible, 
  setIsScheduleVisible,
  openPrintOptionsModal,
  selectedPhysicalRoomId,
  onPhysicalRoomIdChange,
  startTouchDrag,
  handleTouchMove,
  finishTouchDrag
}) => {
  const { physicalRooms } = appData; 
  const [tableView, setTableView] = useState<TableView>('daysAsCols'); 
  
  const sortedPhysicalRooms = useMemo(() => {
    return [...physicalRooms].sort((a, b) => {
      return ((a?.code) || '').localeCompare((b?.code) || '', undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [physicalRooms]);

  const effectivePhysicalRoomId = selectedPhysicalRoomId;

  const selectedPhysicalRoom = useMemo(() => {
    return physicalRooms.find(c => c.id === effectivePhysicalRoomId);
  }, [effectivePhysicalRoomId, physicalRooms]);

  useEffect(() => {
    if (!selectedPhysicalRoomId && sortedPhysicalRooms.length > 0) {
      onPhysicalRoomIdChange(sortedPhysicalRooms[0].id);
    }
    if (selectedPhysicalRoomId && !physicalRooms.find(c => c.id === selectedPhysicalRoomId)) {
        onPhysicalRoomIdChange(sortedPhysicalRooms.length > 0 ? sortedPhysicalRooms[0].id : null);
    }
  }, [physicalRooms, sortedPhysicalRooms, selectedPhysicalRoomId, onPhysicalRoomIdChange]);

  const toggleTableView = () => {
    setTableView(prev => prev === 'daysAsCols' ? 'periodsAsCols' : 'daysAsCols');
  };

  const handleLocalDropInternal = (event: DragEvent<HTMLTableCellElement>, targetDay: DayOfWeek, targetPeriodIndex: number) => {
    event.preventDefault();
    event.currentTarget.classList.remove('bg-blue-100');
    if (effectivePhysicalRoomId) {
      handleDropEntry(targetDay, targetPeriodIndex, { physicalRoomId: effectivePhysicalRoomId });
    }
  };
  
  const handleLocalDragOverInternal = (event: DragEvent<HTMLTableCellElement>) => {
    event.preventDefault(); 
    event.dataTransfer.dropEffect = "move";
    event.currentTarget.classList.add('bg-blue-100'); 
  };
  
  const handleLocalDragLeaveInternal = (event: DragEvent<HTMLTableCellElement>) => {
    event.currentTarget.classList.remove('bg-blue-100'); 
  };

  const handleLocalDragStartInternal = (event: DragEvent<HTMLDivElement>, entryId: string, entryData: ScheduleEntry) => {
    const dataToTransfer = { entryId, blockId: entryData.blockId, blockIndex: entryData.blockIndex, totalInBlock: entryData.totalInBlock };
    (window as any)._tempDragData = JSON.stringify(dataToTransfer); 
    handleDragStart(event, entryId, entryData); 
  };

  return (
    <div className="space-y-6">
      <div className="non-printable flex flex-col sm:flex-row justify-between items-center gap-4 p-4 bg-white shadow-md rounded-lg border border-slate-200">
        <div className="flex items-center">
          <Icons.RoomUsage size={28} className="mr-3 text-teal-600" />
          <h2 className="text-xl font-semibold text-slate-800">
            Room Usage: {selectedPhysicalRoom?.name || "Select PhysicalRoom"}
          </h2>
        </div>
        <div className="flex items-center gap-x-2">
            <select
                id="physicalRoomSelect"
                value={effectivePhysicalRoomId || ""}
                onChange={(e) => onPhysicalRoomIdChange(e.target.value)}
                className="p-2 border border-slate-300 rounded-md focus:ring-teal-500 focus:border-teal-500 shadow-sm text-sm"
                aria-label="Select PhysicalRoom"
            >
                <option value="" disabled>-- Select PhysicalRoom --</option>
                {sortedPhysicalRooms.map(c => (
                <option key={c.id} value={c.id}>{formatRoomDisplay(c)}</option>
                ))}
            </select>
            <button
                onClick={() => openPrintOptionsModal('physicalRoom', effectivePhysicalRoomId)}
                className="flex items-center bg-teal-500 hover:bg-teal-600 text-white font-semibold py-2 px-3 rounded-md shadow-sm transition-colors duration-150 text-sm"
                title="Print Options"
                aria-label="Open print options for room usage schedule"
            >
                <Icons.Printer size={18} className="mr-1.5" />
                Print
            </button>
            <button
              onClick={() => setIsScheduleVisible(!isScheduleVisible)}
              className="p-2 text-slate-600 hover:bg-slate-100 hover:text-teal-600 rounded-md border border-slate-300 shadow-sm"
              title={isScheduleVisible ? "Hide Schedule" : "Show Schedule"}
              aria-label={isScheduleVisible ? "Hide schedule table" : "Show schedule table"}
            >
              {isScheduleVisible ? <Icons.EyeOff size={20} /> : <Icons.Eye size={20} />}
            </button>
            <button 
                onClick={toggleTableView} 
                className="p-2 text-slate-600 hover:bg-slate-100 hover:text-teal-600 rounded-md border border-slate-300 shadow-sm" 
                title={tableView === 'daysAsCols' ? "Switch to: Periods as Rows" : "Switch to: Days as Rows"}
                aria-label="Switch table view"
            >
                <Icons.SwitchView size={20} />
            </button>
        </div>
      </div>
      {isScheduleVisible && effectivePhysicalRoomId ? (
           <RoomUsageScheduleTable
             appData={appData}
             periodSettings={periodSettings}
             itemId={effectivePhysicalRoomId}
             getEntryDisplay={getEntryDisplay}
             tableView={tableView}
             handleSlotContextMenu={handleSlotContextMenu}
             onSlotSelect={onSlotSelect}
             openAssignmentModal={openAssignmentModal}
             handleLocalDragStart={handleLocalDragStartInternal}
             handleLocalDragOver={handleLocalDragOverInternal}
             handleLocalDragLeave={handleLocalDragLeaveInternal}
             handleLocalDrop={handleLocalDropInternal}
             handleDragEnd={handleDragEnd}
             draggedEntryId={draggedEntryId}
             permissions={permissions}
             startTouchDrag={startTouchDrag}
             handleTouchMove={handleTouchMove}
             finishTouchDrag={finishTouchDrag}
           />
      ) : (
        <div className="text-center py-16 text-slate-500 bg-white shadow-md rounded-lg border border-slate-200">
            <Icons.EyeOff size={48} className="mx-auto mb-4 text-slate-400" />
            <p className="text-xl mb-2">{!effectivePhysicalRoomId ? "Please select a physicalRoom." : "Schedule Hidden"}</p>
            {!effectivePhysicalRoomId ? null : (
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
            )}
        </div>
      )}
    </div>
  );
};

export default RoomUsageView;
