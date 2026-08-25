import { formatRoomDisplay } from "../utils/stringUtils";

import React, { useState, useMemo, DragEvent, useCallback, useEffect, MouseEvent as ReactMouseEvent } from 'react';
import { History, Lock } from 'lucide-react';
import { AppData, DayOfWeek, GradeLevel, ScheduleEntry, Subject, Teacher, PhysicalRoom, PeriodSetting, TeacherSubjectAssignment, ScheduleViewType, AssignmentModalContext, CurrentAssignmentState, SubjectTeachingMode, ContextMenuState, ContextMenuItemAction, ContextMenuTargetInfo, CopiedScheduleEntryData, ScreenAccessProps, SlotAvailabilityInspectorModalProps, PrintOptions, PrintWithOptionsModalProps } from '../types';
import { DAYS_OF_WEEK_ORDERED, Icons } from '../constants';
import Modal from './Modal';
import ConfirmationModal from './ConfirmationModal'; 
import TeacherScheduleView from './TeacherScheduleView';
import RoomUsageView from './RoomUsageView';
import ContextMenu from './ContextMenu'; 
import GradeLevelPlannerView from './GradeLevelPlannerView'; 
import SlotAvailabilityInspectorModal from './SlotAvailabilityInspectorModal'; 
import { AuditModal } from './AuditModal';
import { getParentGradeLevelId, getChildGradeLevelIds, isParentGrade, isChildOf, isSharable } from './scheduleUtils';
import { useTouchDrag } from '../hooks/useTouchDrag';
import { ReviewWizardModal, Discrepancy } from './ReviewWizardModal';

interface ScheduleScreenProps extends ScreenAccessProps {
  appData: AppData;
  setAppData: React.Dispatch<React.SetStateAction<AppData>>;
  openPrintOptionsModal: (itemType: 'teacher' | 'gradeLevel' | 'physicalRoom', currentItemId: string | null) => void;
}

interface OccupancyInfo {
  gradeLevelName: string;
  subjectName: string;
  teacherNames?: string[];
  physicalRoomName?: string; 
  isCurrentContextEntity: boolean; 
}

type TableView = 'daysAsCols' | 'periodsAsCols'; 

// Helper functions moved to scheduleUtils.ts

const ScheduleScreen: React.FC<ScheduleScreenProps> = ({ appData, setAppData, permissions, openPrintOptionsModal }) => {
  const [activeScheduleView, setActiveScheduleView] = useState<ScheduleViewType>('gradeLevelPlanner');
  const [selectedAvailabilitySlot, setSelectedAvailabilitySlot] = useState<{ day: DayOfWeek; period: number } | null>(null);
  
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [assignmentModalContext, setAssignmentModalContext] = useState<AssignmentModalContext | null>(null);
  const [currentAssignment, setCurrentAssignment] = useState<CurrentAssignmentState>({ assignmentDuration: 1 }); 
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [copiedScheduleEntryData, setCopiedScheduleEntryData] = useState<CopiedScheduleEntryData | null>(null);
  
  const [isConfirmClearModalOpen, setIsConfirmClearModalOpen] = useState(false);
  const [entryToClearId, setEntryToClearId] = useState<string | null>(null);

  const [isSlotInspectorModalOpen, setIsSlotInspectorModalOpen] = useState(false);
  const [slotInspectorModalContext, setSlotInspectorModalContext] = useState<Omit<SlotAvailabilityInspectorModalProps, 'isOpen' | 'onClose' | 'appData' | 'periodSettings'> | null>(null);

  const [isScheduleVisible, setIsScheduleVisible] = useState<boolean>(true);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [ignoredDiscrepancyIds, setIgnoredDiscrepancyIds] = useState<string[]>([]);

  const [completionToast, setCompletionToast] = useState<{
    teacherName: string; teacherCode: string; subjectName: string; subjectCode: string; roomName: string; required: number; isVisible: boolean;
  } | null>(null);

  const { teachers, subjects, gradeLevels, physicalRooms, periodSettings, teacherSubjectAssignments } = appData;
  const scheduleEntries = Array.isArray(appData.scheduleEntries) ? appData.scheduleEntries : [];

  const prevAllocationRef = React.useRef<Record<string, number>>({});

  useEffect(() => {
    const allocationCounts = new Map<string, { count: number, lastPhysicalRoomId: string | null }>();
    scheduleEntries.forEach(entry => {
      entry.teacherIds.forEach(tId => {
        const key = `${tId}::${entry.subjectId}::${entry.gradeLevelId}`;
        const current = allocationCounts.get(key) || { count: 0, lastPhysicalRoomId: null };
        allocationCounts.set(key, { count: current.count + 1, lastPhysicalRoomId: entry.physicalRoomId });
      });
    });

    const currentAllocations: Record<string, number> = {};
    allocationCounts.forEach((stats, key) => currentAllocations[key] = stats.count);

    let newlyCompletedKey: string | null = null;
    let newlyCompletedCount = 0;

    teacherSubjectAssignments.forEach(link => {
      const key = `${link.teacherId}::${link.subjectId}::${link.gradeLevelId}`;
      const currentCount = currentAllocations[key] || 0;
      const prevCount = prevAllocationRef.current[key] || 0;
      
      const subject = subjects.find(s => s.id === link.subjectId);
      const required = link.periodsPerWeek || subject?.periodsPerWeek || 0;

      if (required > 0 && currentCount === required && prevCount < required) {
        newlyCompletedKey = key;
        newlyCompletedCount = required;
      }
    });

    if (newlyCompletedKey) {
      const stats = allocationCounts.get(newlyCompletedKey);
      const [tId, sId, gId] = newlyCompletedKey.split('::');
      const teacher = teachers.find(t => t.id === tId);
      const subject = subjects.find(s => s.id === sId);
      const physicalRoom = (physicalRooms || []).find(c => c.id === stats?.lastPhysicalRoomId);

      setCompletionToast({
        teacherName: teacher?.name || 'Unknown',
        teacherCode: teacher?.teacherCode || '',
        subjectName: subject?.name || 'Unknown',
        subjectCode: subject?.subjectCode || '',
        // Physical room or cohort as proxy for now if needed.
        roomName: physicalRoom?.name || '-',
        required: newlyCompletedCount,
        isVisible: true
      });

      setTimeout(() => {
        setCompletionToast(prev => prev ? { ...prev, isVisible: false } : null);
      }, 5000);
    }

    prevAllocationRef.current = currentAllocations;
  }, [scheduleEntries, teacherSubjectAssignments, teachers, subjects, physicalRooms]);

  type ViewState = { day: DayOfWeek, period: number, gradeLevelId?: string, teacherId?: string, physicalRoomId?: string };
  const [selectedBlock, setSelectedBlock] = useState<ViewState | null>(null);
  const [viewingTeacherId, setViewingTeacherId] = useState<string | null>(null);
  const [viewingPhysicalRoomId, setViewingPhysicalRoomId] = useState<string | null>(null);

  const gradeHierarchyHelpers = { getParentGradeLevelId, getChildGradeLevelIds, isParentGrade, isChildOf };

  const createActivityLog = useCallback((action: 'Added' | 'Removed' | 'Updated' | 'Cleared', entry: ScheduleEntry, prevData: AppData) => {
    const subjectName = prevData.subjects.find(s => s.id === entry.subjectId)?.name || 'Unknown Subject';
    const gradeName = prevData.gradeLevels.find(gl => gl.id === entry.gradeLevelId)?.name || 'Unknown Grade';
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      user: prevData.currentUser?.name || prevData.currentUser?.email || 'Unknown User',
      description: `${subjectName} for ${gradeName} (${entry.day} P${entry.period + 1})`
    };
  }, []);


  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);


  // 1. Silent Initialization of legacy entries' caches
  useEffect(() => {
    if (!scheduleEntries || scheduleEntries.length === 0) return;
    const entriesNeedInit = scheduleEntries.some(e => !(e as any).cachedSubjectName);
    if (entriesNeedInit) {
      setAppData(prev => {
        if (!prev) return prev;
        const updatedEntries = prev.scheduleEntries.map(entry => {
          if (!(entry as any).cachedSubjectName) {
            const sub = prev.subjects.find(s => s.id === entry.subjectId);
            return {
              ...entry,
              cachedSubjectName: sub?.name || '',
              cachedSubjectCode: sub?.subjectCode || ''
            };
          }
          return entry;
        });
        return {
          ...prev,
          scheduleEntries: updatedEntries
        };
      });
    }
  }, [scheduleEntries, subjects, setAppData]);

  // 2. Discrepancy Detection Engine
  const DAY_LABELS_TH: Record<string, string> = {
    Monday: 'วันจันทร์',
    Tuesday: 'วันอังคาร',
    Wednesday: 'วันพุธ',
    Thursday: 'วันพฤหัสบดี',
    Friday: 'วันศุกร์',
    Saturday: 'วันเสาร์',
    Sunday: 'วันอาทิตย์'
  };

  const discrepancies = useMemo(() => {
    if (!appData || !scheduleEntries) return [];
    const list: Discrepancy[] = [];

    for (const entry of scheduleEntries) {
      // If ignored, skip
      if (ignoredDiscrepancyIds.includes(entry.id)) continue;

      const subject = subjects.find(s => s.id === entry.subjectId);
      const teacher = entry.teacherIds.length > 0 ? teachers.find(t => t.id === entry.teacherIds[0]) : null;
      const gradeLevel = gradeLevels.find(gl => gl.id === entry.gradeLevelId);
      const currentRoom = (physicalRooms || []).find(r => r.id === entry.physicalRoomId);

      if (!subject) continue;

      const componentLabel = `${DAY_LABELS_TH[entry.day] || entry.day} คาบ P${entry.period + 1} (${gradeLevel?.name || 'Unknown'})`;

      // Check 1: Teacher's homeroom changed
      if (subject.isHomeroomAdvisorySubject && teacher) {
        const firstHomeroomId = teacher.homeroomGradeLevelIds?.[0];
        if (firstHomeroomId && entry.gradeLevelId !== firstHomeroomId) {
          const targetGrade = gradeLevels.find(gl => gl.id === firstHomeroomId);
          if (targetGrade) {
            // Check conflict in the target slot
            const conflictingEntry = scheduleEntries.find(e => 
              e.id !== entry.id &&
              e.day === entry.day && 
              e.period === entry.period && 
              e.gradeLevelId === firstHomeroomId
            );

            let conflictDesc = "";
            let status: 'green' | 'red' = 'green';
            if (conflictingEntry) {
              status = 'red';
              const confSubject = subjects.find(s => s.id === conflictingEntry.subjectId);
              conflictDesc = `ชนกับวิชา ${confSubject?.name || 'วิชาอื่น'} ของห้อง ${targetGrade.name}`;
            }

            list.push({
              id: entry.id,
              entry,
              type: 'homeroom_changed',
              title: 'ห้องประจำชั้นครูเปลี่ยนไป (Homeroom Changed)',
              component: componentLabel,
              currentGridData: `${teacher.name} - [${subject.subjectCode || 'HR'}] - ${gradeLevel?.name || 'Unknown'}`,
              pendingUpdateData: `${teacher.name} - [${subject.subjectCode || 'HR'}] - ${targetGrade.name}`,
              status,
              statusDescription: status === 'green' ? 'ว่าง (พร้อมอัปเดต)' : conflictDesc,
              proposedChange: {
                gradeLevelId: firstHomeroomId,
                physicalRoomId: targetGrade.homeroomPhysicalRoomId || entry.physicalRoomId
              }
            });
            continue;
          }
        }
      }

      // Check 2: Room assignment changed within homeroom
      if (subject.isHomeroomAdvisorySubject && gradeLevel && gradeLevel.homeroomPhysicalRoomId) {
        if (entry.physicalRoomId !== gradeLevel.homeroomPhysicalRoomId) {
          const targetRoom = (physicalRooms || []).find(r => r.id === gradeLevel.homeroomPhysicalRoomId);
          if (targetRoom) {
            // Check if target room is occupied at this day and period
            const conflictingEntry = scheduleEntries.find(e => 
              e.id !== entry.id &&
              e.day === entry.day && 
              e.period === entry.period && 
              e.physicalRoomId === targetRoom.id
            );

            let conflictDesc = "";
            let status: 'green' | 'red' = 'green';
            if (conflictingEntry) {
              status = 'red';
              const confSubject = subjects.find(s => s.id === conflictingEntry.subjectId);
              const confGrade = gradeLevels.find(gl => gl.id === conflictingEntry.gradeLevelId);
              conflictDesc = `ห้อง ${targetRoom.name} ถูกใช้งานในวิชา ${confSubject?.name || 'วิชาอื่น'} ของห้อง ${confGrade?.name || 'ห้องอื่น'}`;
            }

            list.push({
              id: entry.id,
              entry,
              type: 'room_changed',
              title: 'ห้องเรียนประจำชั้นเปลี่ยนไป (Homeroom Room Changed)',
              component: componentLabel,
              currentGridData: `ห้องเดิม: ${currentRoom?.name || 'ไม่ระบุ'}`,
              pendingUpdateData: `ห้องใหม่: ${targetRoom.name}`,
              status,
              statusDescription: status === 'green' ? 'ว่าง (พร้อมอัปเดต)' : conflictDesc,
              proposedChange: {
                physicalRoomId: targetRoom.id
              }
            });
            continue;
          }
        }
      }

      // Check 3: Subject code/name updated
      const cachedName = (entry as any).cachedSubjectName;
      const cachedCode = (entry as any).cachedSubjectCode;
      
      if (cachedName && (subject.name !== cachedName || (subject.subjectCode || '') !== (cachedCode || ''))) {
        list.push({
          id: entry.id,
          entry,
          type: 'subject_updated',
          title: 'ข้อมูลวิชาอัปเดตใหม่ (Subject Info Updated)',
          component: componentLabel,
          currentGridData: `วิชาเดิม: ${cachedCode ? '[' + cachedCode + '] ' : ''}${cachedName}`,
          pendingUpdateData: `วิชาใหม่: ${subject.subjectCode ? '[' + subject.subjectCode + '] ' : ''}${subject.name}`,
          status: 'green',
          statusDescription: 'ว่าง (พร้อมอัปเดต)',
          proposedChange: {
            cachedSubjectName: subject.name,
            cachedSubjectCode: subject.subjectCode || ''
          }
        });
      }
    }

    return list;
  }, [scheduleEntries, ignoredDiscrepancyIds, teachers, subjects, gradeLevels, physicalRooms, appData]);

  // Handlers for Review Wizard Actions
  const handleAcceptDiscrepancy = useCallback((discrepancy: Discrepancy) => {
    setAppData(prev => {
      if (!prev) return prev;
      
      const updatedEntries = prev.scheduleEntries.map(e => {
        if (e.id === discrepancy.id) {
          return {
            ...e,
            ...discrepancy.proposedChange
          };
        }
        return e;
      });

      const entryToLog = updatedEntries.find(e => e.id === discrepancy.id) || discrepancy.entry;
      const log = createActivityLog('Updated', entryToLog, prev);
      const newLogs = [log, ...(prev.activityLogs || [])].slice(0, 5);

      return {
        ...prev,
        scheduleEntries: updatedEntries,
        activityLogs: newLogs
      };
    });
  }, [setAppData, createActivityLog]);

  const handleRejectDiscrepancy = useCallback((discrepancy: Discrepancy) => {
    setIgnoredDiscrepancyIds(prev => [...prev, discrepancy.id]);
  }, []);

  const handleAcceptAllNonConflicting = useCallback(() => {
    const greens = discrepancies.filter(d => d.status === 'green');
    if (greens.length === 0) return;

    setAppData(prev => {
      if (!prev) return prev;

      const updateMap = new Map<string, Partial<ScheduleEntry>>();
      greens.forEach(g => {
        updateMap.set(g.id, g.proposedChange);
      });

      const updatedEntries = prev.scheduleEntries.map(e => {
        const update = updateMap.get(e.id);
        if (update) {
          return {
            ...e,
            ...update
          };
        }
        return e;
      });

      const firstGreen = greens[0];
      const entryToLog = updatedEntries.find(e => e.id === firstGreen.id) || firstGreen.entry;
      const log = createActivityLog('Updated', entryToLog, prev);
      log.description = `ซิงค์ข้อมูลตามการเปลี่ยนแปลงข้อมูลหลัก (${greens.length} รายการ)`;
      const newLogs = [log, ...(prev.activityLogs || [])].slice(0, 5);

      return {
        ...prev,
        scheduleEntries: updatedEntries,
        activityLogs: newLogs
      };
    });
  }, [discrepancies, setAppData, createActivityLog]);

  const handleCopyEntry = useCallback((entryToCopy: ScheduleEntry) => {
    const { id, day, period, blockId, blockIndex, totalInBlock, ...restOfEntry } = entryToCopy;
    setCopiedScheduleEntryData(restOfEntry);
  }, [setCopiedScheduleEntryData]);

  const openSlotInspectorModalFromContext = useCallback((day: DayOfWeek, periodIndex: number, currentGradeLevelIdForContext?: string) => {
    setSlotInspectorModalContext({
        day: day,
        period: periodIndex,
        currentGradeLevelId: currentGradeLevelIdForContext,
    });
    setIsSlotInspectorModalOpen(true);
    closeContextMenu();
  }, [closeContextMenu]);

  const openAssignmentModalFromContext = useCallback((
    context: AssignmentModalContext,
    entry?: ScheduleEntry
  ) => {
    if (appData.organizationSettings?.isLocked) {
      alert("ตารางเรียนถูกล็อค ไม่สามารถแก้ไขได้");
      return;
    }
    if (!permissions.canModifyScheduleEntries) {
      alert("You do not have permission to modify schedule entries.");
      return;
    }
    if (entry) {
        const entryGradeIsParent = isParentGrade(entry.gradeLevelId, gradeLevels);
        if (entryGradeIsParent && !permissions.canPerformManagerActions) {
            alert("Only managers can edit entries for parent grade levels.");
            return;
        }
        if (appData.currentUser?.role === 'assistant') {
            const assignedDepts = appData.currentUser?.assignedDepartments || [];
            const entryTeachers = entry.teacherIds.map(tid => appData.teachers.find(t => t.id === tid));
            const hasAccess = entryTeachers.some(t => t?.department && assignedDepts.includes(t.department));
            if (!hasAccess) {
              alert("คุณไม่สามารถแก้ไขตารางสอนของกลุ่มสาระที่คุณไม่ได้ดูแลได้");
              return;
            }
        }
    }

    closeContextMenu();
    setAssignmentModalContext(context); 
    let initialAssignmentState: CurrentAssignmentState = {
      day: context.day,
      period: context.period,
      teacherIds: [], 
      assignmentDuration: 1,
      physicalRoomId: '', 
    };
    
    if (context.fixedGradeLevelId) initialAssignmentState.gradeLevelId = context.fixedGradeLevelId;
    if (context.fixedTeacherId) initialAssignmentState.teacherIds = [context.fixedTeacherId];
    if (context.fixedPhysicalRoomId) initialAssignmentState.physicalRoomId = context.fixedPhysicalRoomId;


    if (entry) {
      initialAssignmentState = {
        ...initialAssignmentState,
        subjectId: entry.subjectId,
        teacherIds: [...entry.teacherIds], 
        physicalRoomId: entry.physicalRoomId,
        gradeLevelId: entry.gradeLevelId, 
        assignmentDuration: entry.totalInBlock || 1,
        cohort: entry.cohort, 
      };
      setEditingEntryId(entry.id);
    } else {
      setEditingEntryId(null);
    }
    
    if (initialAssignmentState.subjectId && initialAssignmentState.gradeLevelId) {
        const subjectDetails = subjects.find(s => s.id === initialAssignmentState.subjectId);
        const gradeIdForAuto = initialAssignmentState.gradeLevelId;
        const gradeDetails = gradeLevels.find(gl => gl.id === gradeIdForAuto);

        if (subjectDetails?.isHomeroomAdvisorySubject && gradeIdForAuto) {
            let homeroomTeacherIds: string[] = [];
            if (isParentGrade(gradeIdForAuto, gradeLevels)) {
                const childGradeIds = getChildGradeLevelIds(gradeIdForAuto, gradeLevels);
                const teacherSet = new Set<string>();
                teachers.forEach(t => {
                    if (t.homeroomGradeLevelIds?.some(hgId => childGradeIds.includes(hgId))) {
                        teacherSet.add(t.id);
                    }
                });
                homeroomTeacherIds = Array.from(teacherSet);
            } else {
                homeroomTeacherIds = teachers.filter(t => t.homeroomGradeLevelIds?.includes(gradeIdForAuto)).map(t => t.id);
            }
            initialAssignmentState.teacherIds = homeroomTeacherIds;

            if (!isSharable(subjectDetails) && gradeDetails && !isParentGrade(gradeIdForAuto, gradeLevels) && gradeDetails.homeroomPhysicalRoomId) {
                initialAssignmentState.physicalRoomId = gradeDetails.homeroomPhysicalRoomId;
            } 
        } else if (subjectDetails?.isBroadAssignment && isParentGrade(gradeIdForAuto, gradeLevels)) {
            const childIds = getChildGradeLevelIds(gradeIdForAuto, gradeLevels);
            const relevantGradeIds = [gradeIdForAuto, ...childIds];
            const autoTeacherIds = new Set<string>();
            teacherSubjectAssignments.forEach(tsa => {
                if (tsa.subjectId === subjectDetails.id && relevantGradeIds.includes(tsa.gradeLevelId)) {
                    autoTeacherIds.add(tsa.teacherId);
                }
            });
            initialAssignmentState.teacherIds = Array.from(autoTeacherIds);
        }
    }
    setCurrentAssignment(initialAssignmentState);
    setConflictError(null);
    setIsAssignmentModalOpen(true);
  }, [permissions, gradeLevels, subjects, teachers, teacherSubjectAssignments, closeContextMenu, setAssignmentModalContext, setCurrentAssignment, setEditingEntryId, setConflictError]);

  const requestClearAssignment = useCallback((entryId: string) => {
    closeContextMenu();
    
    if (appData.organizationSettings?.isLocked) {
      alert("ตารางเรียนถูกล็อค ไม่สามารถแก้ไขได้");
      return;
    }

    const entryToClearDetails = scheduleEntries.find(e => e.id === entryId);
    if (!entryToClearDetails) return;

    const entryGradeIsParent = isParentGrade(entryToClearDetails.gradeLevelId, gradeLevels);
    if (entryGradeIsParent && !permissions.canPerformManagerActions) {
        alert("Only managers can clear entries for parent grade levels.");
        return;
    }
    if (!permissions.canModifyScheduleEntries) {
      alert("You do not have permission to clear schedule entries.");
      return;
    }
    if (appData.currentUser?.role === 'assistant') {
      const assignedDepts = appData.currentUser?.assignedDepartments || [];
      const entryTeachers = entryToClearDetails.teacherIds.map(tid => appData.teachers.find(t => t.id === tid));
      const hasAccess = entryTeachers.some(t => t?.department && assignedDepts.includes(t.department));
      if (!hasAccess) {
        alert("คุณไม่สามารถลบตารางสอนของกลุ่มสาระที่คุณไม่ได้ดูแลได้");
        return;
      }
    }

    setEntryToClearId(entryId);
    setIsConfirmClearModalOpen(true);
  }, [closeContextMenu, scheduleEntries, gradeLevels, permissions, setEntryToClearId, setIsConfirmClearModalOpen, appData.currentUser, appData.teachers]);
  
  const checkConflicts = useCallback((
    day: DayOfWeek, 
    periodIndex: number, 
    teacherIdsToCheck: string[], 
    physicalRoomIdToCheck: string | undefined,
    gradeLevelIdToCheck: string, 
    subjectIdForCheck: string, 
    currentEditingEntryId: string | null,
    entryTotalInBlock: number = 1,
    cohortToCheck?: string
  ): string | null => {
    
    const placingSubject = subjects.find(s => s.id === subjectIdForCheck);
    const placingSubjectType = placingSubject?.type || 'STANDARD';

    const allRelevantGradeIdsToCheck: string[] = [];
    if (gradeLevelIdToCheck !== 'Non-Student') {
      if (isParentGrade(gradeLevelIdToCheck, gradeLevels)) {
          allRelevantGradeIdsToCheck.push(gradeLevelIdToCheck, ...getChildGradeLevelIds(gradeLevelIdToCheck, gradeLevels));
      } else {
          allRelevantGradeIdsToCheck.push(gradeLevelIdToCheck);
          const parentId = getParentGradeLevelId(gradeLevelIdToCheck, gradeLevels);
          if (parentId) allRelevantGradeIdsToCheck.push(parentId); 
      }
    }

    for (const entry of scheduleEntries) {
        // Skip conflict check if 'entry' is the one being edited, or part of the same block being edited.
        const isSelfOrSameBlock = currentEditingEntryId === entry.id || 
                                  (editingEntryId && scheduleEntries.find(e => e.id === editingEntryId)?.blockId && entry.blockId === scheduleEntries.find(e => e.id === editingEntryId)?.blockId);
        if (isSelfOrSameBlock) continue;

        if (entry.day === day && entry.period === periodIndex) {
            const entrySubject = subjects.find(s => s.id === entry.subjectId);
            const entrySubjectType = entrySubject?.type || 'STANDARD';

            // Teacher Conflict Check (Bypassed if teacher is No Teacher Assigned)
            const realTeacherIdsToCheck = teacherIdsToCheck.filter(id => id !== 'No Teacher Assigned');
            if (realTeacherIdsToCheck.length > 0) {
                for (const teacherId of realTeacherIdsToCheck) {
                    if (entry.teacherIds.includes(teacherId) && !entry.teacherIds.includes('No Teacher Assigned')) {
                        const conflictingTeacher = teachers.find(t => t.id === teacherId);
                        const existingSubject = subjects.find(s => s.id === entry.subjectId);
                        const existingGrade = gradeLevels.find(gl => gl.id === entry.gradeLevelId);
                        
                        let busyWithDetail = "";
                        if (existingSubject) busyWithDetail += `วิชา ${existingSubject.name}`;
                        if (existingGrade) busyWithDetail += (busyWithDetail ? ` ให้ระดับชั้น ${existingGrade.name}` : `ระดับชั้น ${existingGrade.name}`);
                        if (!busyWithDetail) busyWithDetail = "กิจกรรมอื่น";

                        return `ครู ${conflictingTeacher?.name || teacherId} มีการสอน (${busyWithDetail}) ในคาบนี้แล้ว`;
                    }
                }
            }

            // PhysicalRoom Conflict Check (Bypassed for TEACHER_ONLY, STUDENT_ONLY, or Sharable subjects)
            const isPlacingSharable = isSharable(placingSubject);
            const isEntrySharable = isSharable(entrySubject);
            const bypassRoomCheck = (placingSubjectType === 'TEACHER_ONLY') || 
                                    (entrySubjectType === 'TEACHER_ONLY') ||
                                    (placingSubjectType === 'STUDENT_ONLY') ||
                                    (entrySubjectType === 'STUDENT_ONLY') ||
                                    isPlacingSharable || 
                                    isEntrySharable;

            if (!bypassRoomCheck && physicalRoomIdToCheck && entry.physicalRoomId === physicalRoomIdToCheck) {
                const physicalRoomDetails = (physicalRooms || []).find(c => c.id === physicalRoomIdToCheck);
                const entryGradeName = gradeLevels.find(gl => gl.id === entry.gradeLevelId)?.name || "another grade";
                return `ห้องเรียน ${formatRoomDisplay(physicalRoomDetails) || physicalRoomIdToCheck} ถูกใช้โดยวิชา ${entrySubject?.name || 'วิชาอื่น'} สำหรับ ${entryGradeName} และไม่อนุญาตให้ใช้ร่วมกัน`;
            }
            
            // Grade Level Slot Conflict Check (Bypassed for TEACHER_ONLY subjects)
            const bypassGradeCheck = (gradeLevelIdToCheck === 'Non-Student') || (entry.gradeLevelId === 'Non-Student');
            if (!bypassGradeCheck) {
                if (allRelevantGradeIdsToCheck.includes(entry.gradeLevelId)) {
                    // Allow bypass if both have cohorts and they are different
                    if (cohortToCheck && entry.cohort && cohortToCheck !== entry.cohort) {
                        continue;
                    }
                    const gradeName = gradeLevels.find(gl => gl.id === gradeLevelIdToCheck)?.name || "ระดับชั้นนี้";
                    const entryGradeName = gradeLevels.find(gl => gl.id === entry.gradeLevelId)?.name || "ระดับชั้นอื่น";
                     return `คาบนี้สำหรับ ${gradeName} ถูกใช้แล้วโดย ${entryGradeName}`;
                }
                if (isChildOf(gradeLevelIdToCheck, entry.gradeLevelId, gradeLevels)){ // e.g. M.1/1 trying to book, but M.1 (parent) already has entry
                     const gradeName = gradeLevels.find(gl => gl.id === gradeLevelIdToCheck)?.name || "ระดับชั้นนี้";
                     const parentGradeName = gradeLevels.find(gl => gl.id === entry.gradeLevelId)?.name || "ระดับชั้นแม่";
                     return `คาบนี้สำหรับ ${gradeName} ถูกใช้แล้วโดย ${parentGradeName}`;
                }
            }
        }
    }
    
    // Scheduling Pattern Conflict (for single period blocks on same day)
    const subjectDetails = subjects.find(s => s.id === subjectIdForCheck);
    if (entryTotalInBlock === 1 && subjectDetails?.schedulingPattern && gradeLevelIdToCheck) {
        const patternParts = subjectDetails.schedulingPattern.split('/').map(p => p.trim());
        const singlePatternPartsCount = patternParts.filter(p => p === '1').length;

        if (singlePatternPartsCount > 1) { // Only relevant if pattern expects multiple single periods
            const otherSinglesOnThisDay = scheduleEntries.filter(e =>
                e.id !== currentEditingEntryId && 
                e.subjectId === subjectDetails.id &&
                (e.gradeLevelId === gradeLevelIdToCheck || isChildOf(e.gradeLevelId, gradeLevelIdToCheck, gradeLevels) || isChildOf(gradeLevelIdToCheck, e.gradeLevelId, gradeLevels)) &&
                e.day === day &&
                (e.totalInBlock === 1 || e.totalInBlock === undefined) 
            ).length;

             if (otherSinglesOnThisDay > 0) { 
                return `วิชา '${subjectDetails.name}' มีการสอนแบบคาบเดี่ยวใน ${day} แล้วสำหรับระดับชั้นนี้ รูปแบบ (${subjectDetails.schedulingPattern}) กำหนดให้คาบเดี่ยวควรอยู่คนละวัน`;
             }
        }
    }
    return null;
  }, [scheduleEntries, gradeLevels, subjects, teachers, physicalRooms, editingEntryId]); // Added editingEntryId to dependency array

  const handlePasteEntry = useCallback((targetSlotInfo: ContextMenuTargetInfo) => {
    if (appData.organizationSettings?.isLocked) {
      alert("ตารางเรียนถูกล็อค ไม่สามารถแก้ไขได้");
      return;
    }
    if (!copiedScheduleEntryData || !permissions.canModifyScheduleEntries) return;

    if (appData.currentUser?.role === 'assistant') {
      const assignedDepts = appData.currentUser?.assignedDepartments || [];
      const entryTeachers = copiedScheduleEntryData.teacherIds.map(tid => appData.teachers.find(t => t.id === tid));
      const hasAccess = entryTeachers.some(t => t?.department && assignedDepts.includes(t.department));
      if (!hasAccess) {
        alert("คุณไม่สามารถวางตารางสอนของกลุ่มสาระที่คุณไม่ได้ดูแลได้");
        return;
      }
    }

    let { gradeLevelId, subjectId, teacherIds, physicalRoomId } = copiedScheduleEntryData;
    const { day: targetDay, period: targetPeriod, viewType } = targetSlotInfo;
    
    if (viewType === 'gradeLevelPlanner' && targetSlotInfo.currentGradeLevelId) {
        gradeLevelId = targetSlotInfo.currentGradeLevelId;
    } else if (viewType === 'teacherSchedules' && targetSlotInfo.currentTeacherId) {
        const subjectDetailsForPaste = subjects.find(s => s.id === subjectId);
        if (subjectDetailsForPaste?.isHomeroomAdvisorySubject && gradeLevelId) {
            if (isParentGrade(gradeLevelId, gradeLevels)) {
                const childGradeIds = getChildGradeLevelIds(gradeLevelId, gradeLevels);
                const teacherSet = new Set<string>();
                 teachers.forEach(t => {
                    if (t.homeroomGradeLevelIds?.some(hgId => childGradeIds.includes(hgId))) {
                        teacherSet.add(t.id);
                    }
                });
                teacherIds = Array.from(teacherSet);
            } else {
                teacherIds = teachers.filter(t => t.homeroomGradeLevelIds?.includes(gradeLevelId!)).map(t => t.id);
            }
        } else if (subjectDetailsForPaste?.teachingMode === 'single') {
            teacherIds = [targetSlotInfo.currentTeacherId]; 
        } else if (teacherIds && !teacherIds.includes(targetSlotInfo.currentTeacherId)) {
            teacherIds = [...teacherIds, targetSlotInfo.currentTeacherId]; 
        } else if (!teacherIds && targetSlotInfo.currentTeacherId) {
            teacherIds = [targetSlotInfo.currentTeacherId];
        }
    } else if (viewType === 'roomUsage' && targetSlotInfo.currentPhysicalRoomId) {
        physicalRoomId = targetSlotInfo.currentPhysicalRoomId;
    }

    const subjectDetails = subjects.find(s => s.id === subjectId);
    const placingSubjectType = subjectDetails?.type || 'STANDARD';

    if (placingSubjectType === 'TEACHER_ONLY') {
        gradeLevelId = 'Non-Student';
        physicalRoomId = '';
    } else if (placingSubjectType === 'STUDENT_ONLY') {
        teacherIds = ['No Teacher Assigned'];
    }

    if (placingSubjectType === 'TEACHER_ONLY') {
        if (!subjectId || !teacherIds || teacherIds.length === 0) {
            alert("Cannot paste: Missing critical information for Teacher-Only subject (subject or teacher).");
            return;
        }
    } else if (placingSubjectType === 'STUDENT_ONLY') {
        if (!subjectId || !gradeLevelId || !physicalRoomId) {
            alert("Cannot paste: Missing critical information for Student-Only subject (subject, grade, or physicalRoom).");
            return;
        }
    } else {
        if (!subjectId || !gradeLevelId || !physicalRoomId) {
            alert("Cannot paste: Missing critical information (subject, grade, or physicalRoom).");
            return;
        }
    }
    
    if (subjectDetails?.isHomeroomAdvisorySubject && gradeLevelId && placingSubjectType === 'STANDARD') { 
        if (isParentGrade(gradeLevelId, gradeLevels)) {
            const childGradeIds = getChildGradeLevelIds(gradeLevelId, gradeLevels);
            const teacherSet = new Set<string>();
            teachers.forEach(t => {
                if (t.homeroomGradeLevelIds?.some(hgId => childGradeIds.includes(hgId))) {
                    teacherSet.add(t.id);
                }
            });
            teacherIds = Array.from(teacherSet);
        } else {
            teacherIds = teachers.filter(t => t.homeroomGradeLevelIds?.includes(gradeLevelId)).map(t => t.id);
        }
        if (!isSharable(subjectDetails)) {
            const gradeDetailsForPaste = gradeLevels.find(gl => gl.id === gradeLevelId);
            if(gradeDetailsForPaste && !isParentGrade(gradeDetailsForPaste.id, gradeLevels) && gradeDetailsForPaste.homeroomPhysicalRoomId) {
                physicalRoomId = gradeDetailsForPaste.homeroomPhysicalRoomId;
            } 
        }
    }


    const conflict = checkConflicts(targetDay, targetPeriod, teacherIds || [], physicalRoomId, gradeLevelId, subjectId, null, 1, copiedScheduleEntryData.cohort);
    if (conflict) {
      alert(`Cannot Paste: ${conflict}`);
      return;
    }
    
    if(subjectDetails && gradeLevelId && placingSubjectType !== 'TEACHER_ONLY'){
        const scheduledPeriodsForSubject = scheduleEntries.filter(e => 
            (e.gradeLevelId === gradeLevelId || isChildOf(e.gradeLevelId, gradeLevelId, gradeLevels) || isChildOf(gradeLevelId, e.gradeLevelId, gradeLevels)) && 
            e.subjectId === subjectId
        ).length;
        if (subjectDetails.periodsPerWeek !== undefined && scheduledPeriodsForSubject >= subjectDetails.periodsPerWeek) {
            const gradeName = gradeLevels.find(gl => gl.id === gradeLevelId)?.name || 'this grade scope';
            alert(`Cannot Paste: Subject '${subjectDetails.name}' has reached its max periods for ${gradeName}.`);
            return;
        }
    }

    const newEntry: ScheduleEntry = {
      id: crypto.randomUUID(),
      day: targetDay,
      period: targetPeriod,
      gradeLevelId: gradeLevelId!, 
      subjectId: subjectId!,   
      teacherIds: teacherIds || [], 
      physicalRoomId: placingSubjectType === 'TEACHER_ONLY' ? '' : (copiedScheduleEntryData?.physicalRoomId || physicalRoomId!),
      totalInBlock: 1, 
    };

    setAppData(prev => {
      const log = createActivityLog('Added', newEntry, prev);
      const newLogs = [log, ...(prev.activityLogs || [])].slice(0, 5);
      return { ...prev, scheduleEntries: [...prev.scheduleEntries, newEntry], activityLogs: newLogs };
    });
  }, [copiedScheduleEntryData, permissions, subjects, gradeLevels, teachers, scheduleEntries, setAppData, checkConflicts, createActivityLog]);


  const handleSlotContextMenu = useCallback((event: React.MouseEvent | React.TouchEvent, targetInfo: ContextMenuTargetInfo) => {
    event.preventDefault();
    closeContextMenu(); 

    const items: ContextMenuItemAction[] = [];
    let effectiveEntryId = targetInfo.entryId;
    let gradeLevelForModalOperations = targetInfo.currentGradeLevelId; 

    if (targetInfo.viewType === 'gradeLevelPlanner' && targetInfo.currentGradeLevelId) {
        const parentId = getParentGradeLevelId(targetInfo.currentGradeLevelId, gradeLevels);
        if (parentId) {
            const parentEntry = scheduleEntries.find(e => e.gradeLevelId === parentId && e.day === targetInfo.day && e.period === targetInfo.period);
            if (parentEntry && !targetInfo.entryId) { 
                effectiveEntryId = parentEntry.id;
            }
        }
    }
    const existingEntry = effectiveEntryId ? scheduleEntries.find(e => e.id === effectiveEntryId) : null;

    const modalOpenContextBase: Omit<AssignmentModalContext, 'editingFromChildPerspectiveOfParentEntry'> = {
        viewType: targetInfo.viewType,
        day: targetInfo.day,
        period: targetInfo.period,
        fixedGradeLevelId: targetInfo.viewType === 'gradeLevelPlanner' ? gradeLevelForModalOperations : undefined,
        fixedTeacherId: targetInfo.currentTeacherId,
        fixedPhysicalRoomId: targetInfo.currentPhysicalRoomId,
    };

    let finalModalContext: AssignmentModalContext = { ...modalOpenContextBase, editingFromChildPerspectiveOfParentEntry: false };
    let isInheritedEntryFromParent = false;

    if (existingEntry) {
      isInheritedEntryFromParent = 
          targetInfo.viewType === 'gradeLevelPlanner' &&
          targetInfo.currentGradeLevelId && 
          existingEntry.gradeLevelId !== targetInfo.currentGradeLevelId && 
          isChildOf(targetInfo.currentGradeLevelId, existingEntry.gradeLevelId, gradeLevels);

      if (isInheritedEntryFromParent) {
          finalModalContext.editingFromChildPerspectiveOfParentEntry = true;
      }
      
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

      let canEditThisEntry = isInheritedEntryFromParent ? false : (isParentGrade(existingEntry.gradeLevelId, gradeLevels) 
                                ? permissions.canPerformManagerActions 
                                : permissions.canModifyScheduleEntries);
      let canClearThisEntry = isInheritedEntryFromParent ? false : (isParentGrade(existingEntry.gradeLevelId, gradeLevels)
                                ? permissions.canPerformManagerActions
                                : permissions.canModifyScheduleEntries);

      if (isLocked) {
          canEditThisEntry = false;
          canClearThisEntry = false;
      } else if (!hasAssistantAccess(existingEntry)) {
          canEditThisEntry = false;
          canClearThisEntry = false;
      }

      items.push({ 
        label: 'Edit Entry', 
        icon: Icons.Edit, 
        action: () => openAssignmentModalFromContext(finalModalContext, existingEntry),
        disabled: !canEditThisEntry,
      });
      items.push({ label: 'Copy Entry', icon: Icons.Copy, action: () => handleCopyEntry(existingEntry) });
      items.push({ 
        label: 'Clear Entry', 
        icon: Icons.Delete, 
        action: () => requestClearAssignment(existingEntry.id), 
        disabled: !canClearThisEntry,
      });
    } else { 
      const isLocked = !!appData.organizationSettings?.isLocked;
      let canAddEntry = permissions.canModifyScheduleEntries;
      if(targetInfo.viewType === 'gradeLevelPlanner' && targetInfo.currentGradeLevelId && isParentGrade(targetInfo.currentGradeLevelId, gradeLevels)){
        canAddEntry = permissions.canPerformManagerActions;
      }
      if (isLocked) {
        canAddEntry = false;
      }

      items.push({ 
          label: 'Add New Entry', 
          icon: Icons.Add, 
          action: () => openAssignmentModalFromContext(finalModalContext),
          disabled: !canAddEntry, 
        });
      items.push({ label: '', action: () => {}, isSeparator: true }); 
      items.push({
        label: 'Inspect Slot Availability',
        icon: Icons.Search, 
        action: () => openSlotInspectorModalFromContext(targetInfo.day, targetInfo.period, targetInfo.currentGradeLevelId),
      });
    }

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

    if (copiedScheduleEntryData && !existingEntry) { 
      let canPasteEntry = permissions.canModifyScheduleEntries;
      if(targetInfo.viewType === 'gradeLevelPlanner' && targetInfo.currentGradeLevelId && isParentGrade(targetInfo.currentGradeLevelId, gradeLevels)){
        canPasteEntry = permissions.canPerformManagerActions;
      }
      if (isLocked) {
        canPasteEntry = false;
      } else {
        const dummyEntry: ScheduleEntry = {
          id: 'dummy',
          day: targetInfo.day,
          period: targetInfo.period,
          gradeLevelId: targetInfo.currentGradeLevelId || copiedScheduleEntryData.gradeLevelId,
          subjectId: copiedScheduleEntryData.subjectId,
          teacherIds: copiedScheduleEntryData.teacherIds,
          physicalRoomId: copiedScheduleEntryData.physicalRoomId || '',
        };
        if (!hasAssistantAccess(dummyEntry)) {
          canPasteEntry = false;
        }
      }
      items.push({ 
          label: 'Paste Entry', 
          icon: Icons.Paste, 
          action: () => handlePasteEntry(targetInfo), 
          disabled: !canPasteEntry, 
        });
    }
    
    if (items.length > 0 && !(items.length === 1 && items[0].isSeparator)) { 
        let clientX = 0;
        let clientY = 0;
        if ('touches' in event) {
          clientX = event.touches[0].clientX;
          clientY = event.touches[0].clientY;
        } else {
          clientX = (event as React.MouseEvent).clientX;
          clientY = (event as React.MouseEvent).clientY;
        }
        setContextMenu({
        x: clientX,
        y: clientY,
        isOpen: true,
        items,
        targetInfo: {...targetInfo, currentGradeLevelId: gradeLevelForModalOperations}, 
        });
    }
  }, [scheduleEntries, copiedScheduleEntryData, closeContextMenu, gradeLevels, permissions, openAssignmentModalFromContext, requestClearAssignment, handleCopyEntry, handlePasteEntry, openSlotInspectorModalFromContext]);

  const closeAssignmentModal = () => {
    setIsAssignmentModalOpen(false);
    setAssignmentModalContext(null);
    setCurrentAssignment({ assignmentDuration: 1 });
    setEditingEntryId(null);
    setConflictError(null);
  };

  const handleAssignmentChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => { 
    const { name, value } = e.target;
    
    setCurrentAssignment(prev => {
        let updated = { ...prev };
        if (name === 'teacherIds') {
            const targetSelect = e.target as HTMLSelectElement;
            let newTeacherIds: string[];
            if (targetSelect.multiple) {
                newTeacherIds = Array.from(targetSelect.selectedOptions).map(option => option.value);
            } else {
                newTeacherIds = value ? [value] : [];
            }
            updated.teacherIds = newTeacherIds;
        } else if (name === 'assignmentDuration') {
            updated.assignmentDuration = parseInt(value, 10) || 1;
        } else {
            updated = { ...prev, [name]: value };
        }

        const newSubjectId = name === 'subjectId' ? value : updated.subjectId;
        const newSubjectDetails = newSubjectId ? subjects.find(s => s.id === newSubjectId) : null;

        // Apply CASE A / CASE B / CASE C Subject-driven defaults
        if (newSubjectDetails?.type === 'TEACHER_ONLY') {
            updated.gradeLevelId = 'Non-Student';
            updated.physicalRoomId = '';
            updated.cohort = '';
        } else {
            if (updated.gradeLevelId === 'Non-Student') {
                updated.gradeLevelId = assignmentModalContext?.fixedGradeLevelId || '';
            }
        }

        if (newSubjectDetails?.type === 'STUDENT_ONLY') {
            updated.teacherIds = ['No Teacher Assigned'];
        } else {
            if (updated.teacherIds && updated.teacherIds.includes('No Teacher Assigned')) {
                updated.teacherIds = assignmentModalContext?.fixedTeacherId ? [assignmentModalContext.fixedTeacherId] : [];
            }
        }

        const newGradeLevelId = updated.gradeLevelId;
        const newGradeDetails = newGradeLevelId ? gradeLevels.find(gl => gl.id === newGradeLevelId) : null;
        const newGradeIsActuallyParent = newGradeLevelId ? isParentGrade(newGradeLevelId, gradeLevels) : false;

        if (name === 'subjectId' || name === 'gradeLevelId') {
            if (newSubjectDetails?.isHomeroomAdvisorySubject && newGradeLevelId) {
                let homeroomTeacherIds: string[] = [];
                if (newGradeIsActuallyParent) {
                    const childGradeIds = getChildGradeLevelIds(newGradeLevelId, gradeLevels);
                    const teacherSet = new Set<string>();
                    teachers.forEach(t => {
                        if (t.homeroomGradeLevelIds?.some(hgId => childGradeIds.includes(hgId))) {
                            teacherSet.add(t.id);
                        }
                    });
                    homeroomTeacherIds = Array.from(teacherSet);
                } else { 
                    homeroomTeacherIds = teachers.filter(t => t.homeroomGradeLevelIds?.includes(newGradeLevelId)).map(t => t.id);
                }
                updated.teacherIds = homeroomTeacherIds;
                
                if (!isSharable(newSubjectDetails)) {
                    if (newGradeDetails && !newGradeIsActuallyParent && newGradeDetails.homeroomPhysicalRoomId) {
                         updated.physicalRoomId = newGradeDetails.homeroomPhysicalRoomId;
                    } else if (newGradeIsActuallyParent || !newGradeDetails?.homeroomPhysicalRoomId) { 
                         updated.physicalRoomId = ''; 
                    }
                } else if (isSharable(newSubjectDetails)) {
                    const prevSubjectDetails = prev.subjectId ? subjects.find(s=>s.id === prev.subjectId) : null;
                    if (prev.physicalRoomId && prevSubjectDetails?.isHomeroomAdvisorySubject && !isSharable(prevSubjectDetails)) {
                        updated.physicalRoomId = ''; 
                    }
                }

            } else if (newSubjectDetails?.isBroadAssignment && newGradeIsActuallyParent && newGradeLevelId && newSubjectId) {
                const childIds = getChildGradeLevelIds(newGradeLevelId, gradeLevels);
                const relevantGradeIds = [newGradeLevelId, ...childIds];
                const autoTeacherIds = new Set<string>();
                teacherSubjectAssignments.forEach(tsa => {
                    if (tsa.subjectId === newSubjectId && relevantGradeIds.includes(tsa.gradeLevelId)) {
                        autoTeacherIds.add(tsa.teacherId);
                    }
                });
                updated.teacherIds = Array.from(autoTeacherIds);
            } else if (newSubjectDetails?.teachingMode === 'single' && updated.teacherIds && updated.teacherIds.length > 1) {
                updated.teacherIds = updated.teacherIds.slice(0, 1);
            } else if (assignmentModalContext?.fixedTeacherId && newSubjectDetails?.teachingMode === 'single') {
                const isLinked = teacherSubjectAssignments.some(
                    tsa => tsa.teacherId === assignmentModalContext.fixedTeacherId &&
                           tsa.subjectId === newSubjectId &&
                           (tsa.gradeLevelId === newGradeLevelId || (newGradeLevelId && isChildOf(newGradeLevelId, tsa.gradeLevelId, gradeLevels)))
                );
                if (isLinked) {
                    updated.teacherIds = [assignmentModalContext.fixedTeacherId];
                } else {
                    updated.teacherIds = []; 
                }
            } else if (assignmentModalContext?.viewType !== 'teacherSchedules' && !newSubjectDetails?.isHomeroomAdvisorySubject && !(newSubjectDetails?.isBroadAssignment && newGradeIsActuallyParent)) {
                 updated.teacherIds = []; 
                 const prevSubjectDetails = prev.subjectId ? subjects.find(s=>s.id === prev.subjectId) : null;
                 if (name === 'subjectId' && prev.physicalRoomId && prevSubjectDetails?.isHomeroomAdvisorySubject && !isSharable(prevSubjectDetails)) {
                    updated.physicalRoomId = '';
                 }
            }
        }
        return updated;
    });
  };
  
  const handleSaveAssignment = () => {
    if (appData.organizationSettings?.isLocked) {
      alert("ตารางเรียนถูกล็อค ไม่สามารถแก้ไขได้");
      setIsAssignmentModalOpen(false);
      return;
    }
    const { subjectId, teacherIds, physicalRoomId, gradeLevelId, assignmentDuration = 1, cohort } = currentAssignment;

    if (!subjectId) {
      setConflictError("Subject is required.");
      return;
    }

    const currentSubjectDetails = subjects.find(s => s.id === subjectId);
    const placingSubjectType = currentSubjectDetails?.type || 'STANDARD';

    if (placingSubjectType === 'TEACHER_ONLY' || gradeLevelId === 'Non-Student') {
      if (!assignmentModalContext || !subjectId || !teacherIds || teacherIds.length === 0) {
        setConflictError("Subject and Teacher(s) are required for Teacher-Only slots.");
        return;
      }
    } else if (placingSubjectType === 'STUDENT_ONLY') {
      if (!assignmentModalContext || !subjectId || !physicalRoomId || !gradeLevelId) {
        setConflictError("Subject, Grade Level, and Physical Room are required for Student-Only slots.");
        return;
      }
    } else {
      if (!assignmentModalContext || !subjectId || !teacherIds || teacherIds.length === 0 || !physicalRoomId || !gradeLevelId) {
        setConflictError("All fields (Grade Level, Subject, Teacher(s), PhysicalRoom) are required, and at least one teacher must be selected.");
        return;
      }
    }
    
    if (gradeLevelId && isParentGrade(gradeLevelId, gradeLevels) && !permissions.canPerformManagerActions) {
        setConflictError("Only managers can create or modify entries for parent grade levels.");
        return;
    }

    const targetDay = assignmentModalContext.day;
    const targetPeriod = assignmentModalContext.period;

    if (currentSubjectDetails?.teachingMode === 'single' && !currentSubjectDetails.isHomeroomAdvisorySubject && teacherIds && teacherIds.length > 1) {
        setConflictError(`Subject '${currentSubjectDetails?.name}' is set to single teacher mode. Please select only one teacher.`);
        return;
    }
    if (currentSubjectDetails?.isBroadAssignment && isParentGrade(gradeLevelId, gradeLevels) && (!teacherIds || teacherIds.length === 0)) {
        setConflictError(`Broad assignment subject '${currentSubjectDetails?.name}' for parent grade ${gradeLevels.find(gl => gl.id === gradeLevelId)?.name} requires at least one teacher.`);
        return;
    }


    if (currentSubjectDetails && currentSubjectDetails.periodsPerWeek !== undefined && gradeLevelId) {
        let scheduledPeriodsForSubject = 0;
        const editingBlockId = editingEntryId ? scheduleEntries.find(e => e.id === editingEntryId)?.blockId : null;
        
        const gradesToCheckForPpw = isParentGrade(gradeLevelId, gradeLevels) && currentSubjectDetails.isBroadAssignment
            ? [gradeLevelId] 
            : isParentGrade(gradeLevelId, gradeLevels)
                ? [gradeLevelId, ...getChildGradeLevelIds(gradeLevelId, gradeLevels)] 
                : [gradeLevelId];

        scheduleEntries.forEach(e => {
            if (gradesToCheckForPpw.includes(e.gradeLevelId) && e.subjectId === subjectId) {
                 if (!editingEntryId || (editingBlockId ? e.blockId !== editingBlockId : e.id !== editingEntryId)) {
                    scheduledPeriodsForSubject +=1;
                 }
            }
        });

        if (!editingEntryId && (scheduledPeriodsForSubject + assignmentDuration > currentSubjectDetails.periodsPerWeek)) {
            const gradeLevelName = gradeLevels.find(gl => gl.id === gradeLevelId)?.name || 'this grade';
            setConflictError(`Adding ${assignmentDuration} period(s) for '${currentSubjectDetails.name}' would exceed its max ${currentSubjectDetails.periodsPerWeek} periods for ${gradeLevelName} (and its sub-grades if applicable).`);
            return;
        }
    }
    
    const newEntries: ScheduleEntry[] = [];
    const editingEntry = editingEntryId ? scheduleEntries.find(e => e.id === editingEntryId) : null;
    const blockIdToUse = editingEntry?.blockId || (assignmentDuration > 1 ? crypto.randomUUID() : undefined);

    const affectedConflictCheckGradeIds = (currentSubjectDetails?.isBroadAssignment && isParentGrade(gradeLevelId, gradeLevels))
        ? getChildGradeLevelIds(gradeLevelId, gradeLevels)
        : [gradeLevelId]; 

    if (editingEntryId && editingEntry) {
        const entriesInBlock = editingEntry.blockId 
            ? scheduleEntries.filter(e => e.blockId === editingEntry.blockId)
            : [editingEntry];
        
        for (const entryInBlock of entriesInBlock) {
            const baseConflictGrade = currentSubjectDetails?.isBroadAssignment && isParentGrade(gradeLevelId, gradeLevels) ? gradeLevelId : entryInBlock.gradeLevelId;
            const conflict = checkConflicts(entryInBlock.day, entryInBlock.period, teacherIds, physicalRoomId, baseConflictGrade, subjectId, entryInBlock.id, entryInBlock.totalInBlock || 1, cohort);
             if (conflict && (
                entryInBlock.subjectId !== subjectId || 
                JSON.stringify(entryInBlock.teacherIds.sort()) !== JSON.stringify((teacherIds || []).sort()) || 
                entryInBlock.physicalRoomId !== physicalRoomId ||
                entryInBlock.gradeLevelId !== gradeLevelId ||
                entryInBlock.cohort !== cohort
             ) ){
                setConflictError(`Error updating block: ${conflict} for period P${entryInBlock.period}`);
                return;
             }
            newEntries.push({
                ...entryInBlock,
                gradeLevelId: gradeLevelId!, 
                subjectId: subjectId!,
                teacherIds: [...(teacherIds || [])], 
                physicalRoomId: placingSubjectType === 'TEACHER_ONLY' ? '' : (currentAssignment.physicalRoomId || physicalRoomId!),
                cohort: placingSubjectType === 'TEACHER_ONLY' ? '' : cohort,
            });
        }

    } else { 
        for (let i = 0; i < assignmentDuration; i++) {
            const currentPeriod = targetPeriod + i;
            if (currentPeriod >= periodSettings.length) {
                setConflictError(`Cannot create block: Exceeds available periods for the day.`);
                return;
            }
            
            const gradesToLoopForConflict = currentSubjectDetails?.isBroadAssignment && isParentGrade(gradeLevelId, gradeLevels)
                                          ? [gradeLevelId, ...getChildGradeLevelIds(gradeLevelId, gradeLevels)] 
                                          : [gradeLevelId];
            
            let mainConflict: string | null = null;
            for (const conflictCheckGradeId of gradesToLoopForConflict) {
                 const conflict = checkConflicts(targetDay, currentPeriod, teacherIds, physicalRoomId, conflictCheckGradeId, subjectId, null, assignmentDuration, cohort);
                 if (conflict) {
                    mainConflict = conflict + (assignmentDuration > 1 ? ` (for period ${i + 1} of the block)`: "");
                    if (gradesToLoopForConflict.length > 1 && conflictCheckGradeId !== gradeLevelId) { 
                        mainConflict += ` (in ${gradeLevels.find(gl=>gl.id === conflictCheckGradeId)?.name || 'sub-grade'})`;
                    }
                    break; 
                 }
            }
            if(mainConflict){
                setConflictError(mainConflict);
                return;
            }

            newEntries.push({
                id: crypto.randomUUID(),
                gradeLevelId: gradeLevelId!, 
                day: targetDay,
                period: currentPeriod,
                subjectId: subjectId!,
                teacherIds: [...(teacherIds || [])], 
                physicalRoomId: placingSubjectType === 'TEACHER_ONLY' ? '' : (currentAssignment.physicalRoomId || physicalRoomId!),
                blockId: blockIdToUse,
                blockIndex: assignmentDuration > 1 ? i : undefined,
                totalInBlock: assignmentDuration > 1 ? assignmentDuration : undefined,
                cohort: placingSubjectType === 'TEACHER_ONLY' ? '' : cohort,
            });
        }
    }


    setAppData(prevData => {
      let finalEntries;
      if (editingEntryId) {
        const oldBlockId = prevData.scheduleEntries.find(e => e.id === editingEntryId)?.blockId;
        const entriesNotBeingEdited = oldBlockId 
            ? prevData.scheduleEntries.filter(e => e.blockId !== oldBlockId)
            : prevData.scheduleEntries.filter(e => e.id !== editingEntryId);
        finalEntries = [...entriesNotBeingEdited, ...newEntries];
      } else {
        finalEntries = [...prevData.scheduleEntries, ...newEntries];
      }
      
      const log = createActivityLog(editingEntryId ? 'Updated' : 'Added', newEntries[0] || editingEntry, prevData);
      const newLogs = [log, ...(prevData.activityLogs || [])].slice(0, 5);
      
      return { ...prevData, scheduleEntries: finalEntries, activityLogs: newLogs };
    });
    closeAssignmentModal();
  };

  const confirmClearAssignment = useCallback(() => {
    if (!entryToClearId) return;
    const idToProcess = entryToClearId; 

    setAppData(prevData => {
      const entryToClear = prevData.scheduleEntries.find(e => e.id === idToProcess);
      if (!entryToClear) return prevData; 

      const newScheduleEntries = entryToClear.blockId 
        ? prevData.scheduleEntries.filter(e => e.blockId !== entryToClear.blockId)
        : prevData.scheduleEntries.filter(e => e.id !== entryToClear.id);
      
      const log = createActivityLog('Cleared', entryToClear, prevData);
      const newLogs = [log, ...(prevData.activityLogs || [])].slice(0, 5);

      return { ...prevData, scheduleEntries: newScheduleEntries, activityLogs: newLogs };
    });
    setIsConfirmClearModalOpen(false);
    setEntryToClearId(null);
  }, [entryToClearId, setAppData, setIsConfirmClearModalOpen, setEntryToClearId]);
  
  const handleDragStartInternal = (event: DragEvent<HTMLDivElement>, entryId: string, entryData: ScheduleEntry) => {
    if (appData.organizationSettings?.isLocked) {
        event.preventDefault();
        return;
    }

    const entryGradeIsParent = isParentGrade(entryData.gradeLevelId, gradeLevels);
    if (entryGradeIsParent && !permissions.canPerformManagerActions) {
        event.preventDefault(); 
        return;
    }
    if (!entryGradeIsParent && !permissions.canModifyScheduleEntries) {
        event.preventDefault(); 
        return;
    }
    if (appData.currentUser?.role === 'assistant') {
      const assignedDepts = appData.currentUser?.assignedDepartments || [];
      const entryTeachers = entryData.teacherIds.map(tid => appData.teachers.find(t => t.id === tid));
      const hasAccess = entryTeachers.some(t => t?.department && assignedDepts.includes(t.department));
      if (!hasAccess) {
        event.preventDefault(); 
        return;
      }
    }

    const bundledEntries = scheduleEntries.filter(e => 
        e.day === entryData.day && 
        e.period === entryData.period && 
        e.gradeLevelId === entryData.gradeLevelId
    );
    const bundledEntryIds = bundledEntries.map(e => e.id);

    const dataToTransfer = { 
        entryId,
        blockId: entryData.blockId,
        blockIndex: entryData.blockIndex,
        totalInBlock: entryData.totalInBlock,
        bundledEntryIds
    };
    event.dataTransfer.setData("application/json", JSON.stringify(dataToTransfer));
    event.dataTransfer.effectAllowed = "move";
    setDraggedEntryId(entryId); 
    event.currentTarget.classList.add('opacity-50', 'ring-2', 'ring-blue-500', 'shadow-2xl');
  };

  const handleDropEntryInternal = (targetDay: DayOfWeek, targetPeriodIndex: number, targetContext: {gradeLevelId?: string, teacherId?: string, physicalRoomId?: string }) => {
    if (appData.organizationSettings?.isLocked) {
        alert("ตารางเรียนถูกล็อค ไม่สามารถแก้ไขได้");
        setDraggedEntryId(null);
        return;
    }

    const transferDataString = (window as any)._tempDragData; 
    if (!transferDataString) {
        console.error("No drag data found on drop.");
        setDraggedEntryId(null);
        return;
    }
    const transferData = JSON.parse(transferDataString);
    const { entryId: droppedEntryId, blockId, blockIndex: draggedEntryBlockIndex = 0, bundledEntryIds } = transferData;


    if (!droppedEntryId) {
      setDraggedEntryId(null);
      return;
    }
    
    const mainEntryToMove = scheduleEntries.find(e => e.id === droppedEntryId);
    if (!mainEntryToMove) {
      setDraggedEntryId(null);
      return;
    }
    
    const movedEntryIsParentGrade = isParentGrade(mainEntryToMove.gradeLevelId, gradeLevels);
    if (movedEntryIsParentGrade && !permissions.canPerformManagerActions) {
        alert("Only managers can move entries for parent grade levels.");
        (window as any)._tempDragData = null; 
        setDraggedEntryId(null);
        return;
    }
    if (targetContext.gradeLevelId && isParentGrade(targetContext.gradeLevelId, gradeLevels) && !permissions.canPerformManagerActions) {
        alert("Only managers can assign entries to parent grade levels.");
        (window as any)._tempDragData = null; 
        setDraggedEntryId(null);
        return;
    }


    const entriesToMoveActual: ScheduleEntry[] = [];
    if (bundledEntryIds && bundledEntryIds.length > 0) {
        for (const id of bundledEntryIds) {
           const bEntry = scheduleEntries.find(e => e.id === id);
           if (bEntry) {
              if (bEntry.blockId) {
                 const blockEntries = scheduleEntries.filter(e => e.blockId === bEntry.blockId).sort((a,b) => (a.blockIndex || 0) - (b.blockIndex || 0));
                 for (const be of blockEntries) {
                    if (!entriesToMoveActual.find(e => e.id === be.id)) entriesToMoveActual.push(be);
                 }
              } else {
                 if (!entriesToMoveActual.find(e => e.id === bEntry.id)) entriesToMoveActual.push(bEntry);
              }
           }
        }
    } else if (blockId) {
        const blockEntries = scheduleEntries.filter(e => e.blockId === blockId).sort((a,b) => (a.blockIndex || 0) - (b.blockIndex || 0));
        if (blockEntries.length > 0) {
            entriesToMoveActual.push(...blockEntries);
        } else {
            entriesToMoveActual.push(mainEntryToMove); 
        }
    } else {
        entriesToMoveActual.push(mainEntryToMove);
    }


    const updatedEntriesBlock: ScheduleEntry[] = [];
    let blockConflict: string | null = null;

    for (let i = 0; i < entriesToMoveActual.length; i++) {
        const currentEntryInBlock = entriesToMoveActual[i];
        const periodDiffOffset = currentEntryInBlock.period - mainEntryToMove.period;
        const newPeriodForThisEntry = targetPeriodIndex + periodDiffOffset;

        if (newPeriodForThisEntry < 0 || newPeriodForThisEntry >= periodSettings.length) {
            blockConflict = "Block would go out of schedule bounds.";
            break;
        }
        
        let finalGradeLevelId = currentEntryInBlock.gradeLevelId;
        let finalTeacherIds = [...currentEntryInBlock.teacherIds];
        let finalPhysicalRoomId = currentEntryInBlock.physicalRoomId;
        const subjectDetails = subjects.find(s => s.id === currentEntryInBlock.subjectId);

        const activeView = assignmentModalContext?.viewType || activeScheduleView; // Prefer modal context if available

        if (activeView === 'gradeLevelPlanner' && targetContext.gradeLevelId) {
            finalGradeLevelId = targetContext.gradeLevelId;
            const gradeDetails = gradeLevels.find(gl => gl.id === finalGradeLevelId);
            if (subjectDetails?.isHomeroomAdvisorySubject) {
                if (isParentGrade(finalGradeLevelId, gradeLevels)) {
                    const childGradeIds = getChildGradeLevelIds(finalGradeLevelId, gradeLevels);
                    const teacherSet = new Set<string>();
                    teachers.forEach(t => {
                        if (t.homeroomGradeLevelIds?.some(hgId => childGradeIds.includes(hgId))) {
                            teacherSet.add(t.id);
                        }
                    });
                    finalTeacherIds = Array.from(teacherSet);
                } else {
                    finalTeacherIds = teachers.filter(t => t.homeroomGradeLevelIds?.includes(finalGradeLevelId)).map(t => t.id);
                }
                 if (!isSharable(subjectDetails) && gradeDetails && !isParentGrade(finalGradeLevelId, gradeLevels) && gradeDetails.homeroomPhysicalRoomId) {
                    finalPhysicalRoomId = gradeDetails.homeroomPhysicalRoomId;
                } 
            } else if (subjectDetails?.isBroadAssignment && isParentGrade(finalGradeLevelId, gradeLevels)) {
                const childIds = getChildGradeLevelIds(finalGradeLevelId, gradeLevels);
                const relevantGradeIdsForTeachers = [finalGradeLevelId, ...childIds];
                const autoTeachers = new Set<string>();
                teacherSubjectAssignments.forEach(tsa => {
                    if (tsa.subjectId === subjectDetails.id && relevantGradeIdsForTeachers.includes(tsa.gradeLevelId)) {
                        autoTeachers.add(tsa.teacherId);
                    }
                });
                finalTeacherIds = Array.from(autoTeachers);
                if (finalTeacherIds.length === 0) {
                    blockConflict = `No teachers linked for broad subject '${subjectDetails.name}' in new grade scope ${gradeLevels.find(gl => gl.id === finalGradeLevelId)?.name}.`;
                    break;
                }
            }

        } else if (activeView === 'teacherSchedules' && targetContext.teacherId) {
            if (subjectDetails?.isHomeroomAdvisorySubject && finalGradeLevelId) {
            } else if (subjectDetails?.teachingMode === 'single') {
                finalTeacherIds = [targetContext.teacherId];
            } else if (!finalTeacherIds.includes(targetContext.teacherId)) { 
                finalTeacherIds = [targetContext.teacherId]; 
            }
        } else if (activeView === 'roomUsage' && targetContext.physicalRoomId) {
            finalPhysicalRoomId = targetContext.physicalRoomId;
        }
        
        const conflictCheckBaseGrade = subjectDetails?.isBroadAssignment && isParentGrade(finalGradeLevelId, gradeLevels)
                                    ? finalGradeLevelId 
                                    : finalGradeLevelId;

        const conflict = checkConflicts(targetDay, newPeriodForThisEntry, finalTeacherIds, finalPhysicalRoomId, conflictCheckBaseGrade, currentEntryInBlock.subjectId, currentEntryInBlock.id, currentEntryInBlock.totalInBlock || 1, currentEntryInBlock.cohort);
        if (conflict) {
          blockConflict = conflict + ` (for P${newPeriodForThisEntry} of the block)`;
          break;
        }
        updatedEntriesBlock.push({
            ...currentEntryInBlock,
            day: targetDay,
            period: newPeriodForThisEntry,
            gradeLevelId: finalGradeLevelId,
            teacherIds: finalTeacherIds,
            physicalRoomId: finalPhysicalRoomId,
        });
    }
    
    (window as any)._tempDragData = null; 

    if (blockConflict) {
        alert(`Cannot move: ${blockConflict}`);
        setDraggedEntryId(null);
        return;
    }
    
    if (updatedEntriesBlock.length > 0) {
        setAppData(prevData => {
          const otherEntries = prevData.scheduleEntries.filter(e => !entriesToMoveActual.some(movedE => movedE.id === e.id));
          const log = createActivityLog('Updated', updatedEntriesBlock[0], prevData);
          const newLogs = [log, ...(prevData.activityLogs || [])].slice(0, 5);
          return { ...prevData, scheduleEntries: [...otherEntries, ...updatedEntriesBlock], activityLogs: newLogs };
        });
    }
    setDraggedEntryId(null); 
  };

  const handleDragEndInternal = (event: DragEvent<HTMLDivElement> | React.TouchEvent) => {
    if ('currentTarget' in event && event.currentTarget) {
      (event.currentTarget as Element).classList.remove('opacity-50', 'ring-2', 'ring-blue-500', 'shadow-2xl');
    }
    setDraggedEntryId(null);
    (window as any)._tempDragData = null; 
  };

  const { startTouchDrag, handleTouchMove, handleTouchEnd: finishTouchDrag } = useTouchDrag({
    onDragStartInternal: handleDragStartInternal as any,
    onDropInternal: handleDropEntryInternal,
    onDragEndInternal: handleDragEndInternal
  });


  const handleSlotClickForSharedAvailability = useCallback((day: DayOfWeek, periodIndex: number) => {
    const clickedSlot = { day, period: periodIndex };
    if (selectedAvailabilitySlot && selectedAvailabilitySlot.day === day && selectedAvailabilitySlot.period === periodIndex) {
      setSelectedAvailabilitySlot(null); 
    } else {
      setSelectedAvailabilitySlot(clickedSlot);
    }
  }, [selectedAvailabilitySlot]);
  
  const clearAvailabilitySlotFilter = () => {
    setSelectedAvailabilitySlot(null);
  };

  const renderAvailabilityTableForSlot = useCallback((
    type: 'teacher' | 'physicalRoom',
    itemsToDisplay: (Teacher | PhysicalRoom)[],
    slot: { day: DayOfWeek; period: number }
  ) => {
    const periodFullLabel = periodSettings[slot.period] ? 
        `${periodSettings[slot.period].label} (${periodSettings[slot.period].startTime} - ${periodSettings[slot.period].endTime})` 
        : `P${slot.period}`;
    const title = type === 'teacher' ? `Teacher Availability` : `PhysicalRoom Availability`;
    
    let currentContextEntityId: string | undefined = undefined; 
    
    if (selectedBlock) {
        if (type === 'teacher') currentContextEntityId = selectedBlock.teacherId;
        else if (type === 'physicalRoom') currentContextEntityId = selectedBlock.physicalRoomId;
    }



    return (
      <div className="mt-6 bg-white p-4 shadow-md rounded-lg border border-slate-200">
        <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-semibold text-slate-700">
            {title} for {slot.day}, {periodFullLabel}
            </h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse border border-slate-300">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-2 border border-slate-300 text-left">{type === 'teacher' ? 'Teacher Name' : 'PhysicalRoom Name'}</th>
                <th className="p-2 border border-slate-300 text-left">Status</th>
                <th className="p-2 border border-slate-300 text-left">Details (Grade, Subject, {type === 'teacher' ? 'PhysicalRoom' : 'Teacher(s)'})</th>
              </tr>
            </thead>
            <tbody>
              {itemsToDisplay.length === 0 ? (
                 <tr><td colSpan={3} className="p-2 text-center text-slate-500">No {type}s available.</td></tr>
              ) : itemsToDisplay.map(item => {
                const entry = scheduleEntries.find(e => {
                  if (e.day !== slot.day || e.period !== slot.period) return false;
                  if (type === 'teacher' && e.teacherIds.includes(item.id)) return true;
                  if (type === 'physicalRoom' && e.physicalRoomId === item.id) return true;
                  return false;
                });

                let occupancyDetails: OccupancyInfo | null = null;
                if (entry) {
                  const gradeLevel = gradeLevels.find(gl => gl.id === entry.gradeLevelId);
                  const subject = subjects.find(s => s.id === entry.subjectId);
                  const assignedTeachers = type === 'physicalRoom' ? entry.teacherIds.map(tid => teachers.find(t => t.id === tid)?.name).filter(Boolean) as string[] : undefined;
                  const physicalRoom = type === 'teacher' ? (physicalRooms || []).find(c => c.id === entry.physicalRoomId) : undefined;
                  
                  let isCurrentContextHighlight = false;
                  if (type === 'teacher' && item.id === currentContextEntityId) isCurrentContextHighlight = true;
                  else if (type === 'physicalRoom' && item.id === currentContextEntityId) isCurrentContextHighlight = true;

                  occupancyDetails = {
                      gradeLevelName: gradeLevel?.name || 'N/A',
                      subjectName: subject?.name || 'N/A',
                      teacherNames: assignedTeachers,
                      physicalRoomName: physicalRoom?.name,
                      isCurrentContextEntity: isCurrentContextHighlight,
                  };
                }
                
                return (
                  <tr key={item.id} className={`hover:bg-slate-50 ${entry ? (occupancyDetails?.isCurrentContextEntity ? 'bg-sky-50' : 'bg-red-50') : 'bg-green-50'}`}>
                    <td className="p-2 border border-slate-300 font-medium text-slate-600">{item.name}</td>
                    <td className={`p-2 border border-slate-300 font-semibold ${entry ? (occupancyDetails?.isCurrentContextEntity ? 'text-sky-700' : 'text-red-700') : 'text-green-700'}`}>
                      {entry ? 'Busy' : 'Free'}
                    </td>
                    <td className="p-2 border border-slate-300 text-xs">
                      {entry && occupancyDetails ? (
                        <div>
                          <div><span className="font-medium">Grade:</span> {occupancyDetails.gradeLevelName}</div>
                          <div><span className="font-medium">Subject:</span> {occupancyDetails.subjectName}</div>
                          {type === 'teacher' && occupancyDetails.physicalRoomName && <div><span className="font-medium">PhysicalRoom:</span> {occupancyDetails.physicalRoomName}</div>}
                          {type === 'physicalRoom' && occupancyDetails.teacherNames && occupancyDetails.teacherNames.length > 0 && <div><span className="font-medium">Teacher(s):</span> {occupancyDetails.teacherNames.join(', ')}</div>}
                        </div>
                      ) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }, [scheduleEntries, periodSettings, teachers, physicalRooms, gradeLevels, subjects, activeScheduleView]);

  const renderScheduleTabs = () => {
    const tabs: { type: ScheduleViewType; label: string; icon: React.ElementType }[] = [
      { type: 'gradeLevelPlanner', label: 'Grade Level Schedule', icon: Icons.Schedule },
      { type: 'teacherSchedules', label: 'Teacher Schedules', icon: Icons.TeacherSchedules },
      { type: 'roomUsage', label: 'Room Usage', icon: Icons.RoomUsage },
    ];

    return (
      <div className="mb-4 border-b border-slate-300 flex flex-wrap space-x-1 non-printable">
        {tabs.map(tab => (
          <button
            key={tab.type}
            onClick={() => {
              setActiveScheduleView(tab.type);
              setSelectedAvailabilitySlot(null); 
              closeContextMenu();
            }}
            className={`flex items-center px-4 py-2.5 border-b-2 -mb-px transition-all duration-150 ease-in-out
                        ${activeScheduleView === tab.type 
                          ? 'border-blue-600 text-blue-600 font-semibold' 
                          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-400'}`}
            aria-current={activeScheduleView === tab.type ? 'page' : undefined}
          >
            <tab.icon size={18} className="mr-2" />
            {tab.label}
          </button>
        ))}
      </div>
    );
  };

  const modalGradeLevels = useMemo(() => {
    return [...gradeLevels].sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }, [gradeLevels]);
  
  const modalSubjects = useMemo(() => {
    if (!assignmentModalContext) return subjects;
    const { day: targetDay, period: targetPeriod, viewType, fixedTeacherId } = assignmentModalContext;
    const currentSelectedGradeId = currentAssignment.gradeLevelId;

    if (currentSelectedGradeId === 'Non-Student') {
        return subjects.filter(s => s.type === 'TEACHER_ONLY');
    }

    let resultSubjects: Subject[] = [];

    if (currentSelectedGradeId) {
        const currentGradeDetails = gradeLevels.find(gl => gl.id === currentSelectedGradeId);
        if (!currentGradeDetails) return subjects; 

        let relevantGradeIdsForSubjectLinks: string[] = [currentSelectedGradeId];
        const parentIdOfCurrent = getParentGradeLevelId(currentSelectedGradeId, gradeLevels);
        if (parentIdOfCurrent) {
            relevantGradeIdsForSubjectLinks.push(parentIdOfCurrent);
        }
        if (isParentGrade(currentSelectedGradeId, gradeLevels)) { 
             const childIdsOfCurrent = getChildGradeLevelIds(currentSelectedGradeId, gradeLevels);
             relevantGradeIdsForSubjectLinks = [...new Set([...relevantGradeIdsForSubjectLinks, ...childIdsOfCurrent])];
        }

        const subjectIdsFromLinks = new Set<string>();
        teacherSubjectAssignments.forEach(tsa => {
            if (relevantGradeIdsForSubjectLinks.includes(tsa.gradeLevelId)) {
                if (viewType === 'teacherSchedules' && fixedTeacherId && tsa.teacherId !== fixedTeacherId) {
                    // Skip if in teacher view and this link is not for the fixed teacher
                } else {
                    subjectIdsFromLinks.add(tsa.subjectId);
                }
            }
        });
        
        const isActualParentGrade = isParentGrade(currentSelectedGradeId, gradeLevels); // e.g. M.1 and has M.1/x children
        const isChildGradeByName = currentGradeDetails.name.includes('/'); // e.g. M.1/1

        if (isActualParentGrade) { // True Parent Grade (e.g., M.1 which has M.1/X children)
            resultSubjects = subjects.filter(s => 
                (!!isSharable(s) || !!s.isBroadAssignment || !!s.isHomeroomAdvisorySubject) &&
                subjectIdsFromLinks.has(s.id)
            );
        } else if (isChildGradeByName) { // Child Grade (e.g., M.1/1)
            resultSubjects = subjects.filter(s => 
                !isSharable(s) && // Must NOT share for child grades
                subjectIdsFromLinks.has(s.id)
            );
            if (parentIdOfCurrent) { 
                const parentEntryInSlot = scheduleEntries.find(e => 
                    e.gradeLevelId === parentIdOfCurrent && 
                    e.day === targetDay && 
                    e.period === targetPeriod
                );
                if (parentEntryInSlot) {
                    resultSubjects = resultSubjects.filter(s => s.id !== parentEntryInSlot.subjectId);
                }
            }
        } else { // Standalone Top-Level Grade (e.g., "ทีมบริหาร" or M.3 if no M.3/X)
            resultSubjects = subjects.filter(s => subjectIdsFromLinks.has(s.id));
        }

        // Add all STUDENT_ONLY and TEACHER_ONLY subjects as they are always selectable for any grade level
        const specialSubjects = subjects.filter(s => s.type === 'STUDENT_ONLY' || s.type === 'TEACHER_ONLY');
        const existingIds = new Set(resultSubjects.map(s => s.id));
        specialSubjects.forEach(s => {
            if (!existingIds.has(s.id)) {
                resultSubjects.push(s);
            }
        });

    } else {
        return subjects; 
    }

    if (!editingEntryId && currentSelectedGradeId) {
        resultSubjects = resultSubjects.filter(subject => {
            if (subject.periodsPerWeek === undefined) return true; 
            
            let gradesToCheckPpw: string[];
            const targetGradeIsParentForPPW = isParentGrade(currentSelectedGradeId, gradeLevels);
            if (targetGradeIsParentForPPW) {
                if (subject.isBroadAssignment) { 
                    gradesToCheckPpw = [currentSelectedGradeId]; 
                } else { 
                    gradesToCheckPpw = [currentSelectedGradeId, ...getChildGradeLevelIds(currentSelectedGradeId, gradeLevels)];
                }
            } else { 
                gradesToCheckPpw = [currentSelectedGradeId]; 
            }
            
            let scheduledCount = 0;
            scheduleEntries.forEach(e => {
                if (gradesToCheckPpw.includes(e.gradeLevelId) && e.subjectId === subject.id) {
                    scheduledCount++;
                }
            });
            return scheduledCount < subject.periodsPerWeek;
        });
    }
    
    return resultSubjects;
  }, [
    assignmentModalContext, 
    currentAssignment.gradeLevelId, 
    subjects, 
    teacherSubjectAssignments, 
    editingEntryId, 
    scheduleEntries,
    gradeLevels 
  ]);

  const modalTeachers = useMemo(() => {
    if (!assignmentModalContext || !currentAssignment.subjectId || !currentAssignment.gradeLevelId) return [];
    
    const subjectDetails = subjects.find(s => s.id === currentAssignment.subjectId);
    const targetGradeId = currentAssignment.gradeLevelId;

    const sortMatchedTeachers = (subset: Teacher[]) => {
      return [...subset].sort((a, b) => {
        const codeA = a.teacherCode || '';
        const codeB = b.teacherCode || '';
        if (codeA !== codeB) {
          return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
        }
        return ((a?.name) || '').localeCompare((b?.name) || '', undefined, { sensitivity: 'base' });
      });
    };

    if (subjectDetails?.type === 'STUDENT_ONLY') {
        return [];
    }

    if (subjectDetails?.type === 'TEACHER_ONLY') {
        let eligible = [...teachers];
        if (appData.currentUser?.role === 'assistant') {
            const assignedDepts = appData.currentUser?.assignedDepartments || [];
            eligible = eligible.filter(t => t.department && assignedDepts.includes(t.department));
        }
        return sortMatchedTeachers(eligible);
    }

    if (subjectDetails?.isHomeroomAdvisorySubject && targetGradeId) {
        let advisoryTeachers: Teacher[] = [];
        if (isParentGrade(targetGradeId, gradeLevels)) {
            const childGradeIds = getChildGradeLevelIds(targetGradeId, gradeLevels);
            const teacherSet = new Set<string>(); 
            teachers.forEach(t => {
                if (t.homeroomGradeLevelIds?.some(hgId => childGradeIds.includes(hgId))) {
                    teacherSet.add(t.id);
                }
            });
            advisoryTeachers = teachers.filter(t => teacherSet.has(t.id));
        } else { 
            advisoryTeachers = teachers.filter(t => t.homeroomGradeLevelIds?.includes(targetGradeId));
        }

        if (appData.currentUser?.role === 'assistant') {
            const assignedDepts = appData.currentUser?.assignedDepartments || [];
            advisoryTeachers = advisoryTeachers.filter(t => t.department && assignedDepts.includes(t.department));
        }
        return sortMatchedTeachers(advisoryTeachers);
    }

    if (subjectDetails?.isBroadAssignment && isParentGrade(targetGradeId, gradeLevels)) {
        const childIds = getChildGradeLevelIds(targetGradeId, gradeLevels);
        const relevantGradeIds = [targetGradeId, ...childIds];
        const autoTeacherIds = new Set<string>();
        teacherSubjectAssignments.forEach(tsa => {
            if (tsa.subjectId === subjectDetails.id && relevantGradeIds.includes(tsa.gradeLevelId)) {
                autoTeacherIds.add(tsa.teacherId);
            }
        });
        let broadTeachers = teachers.filter(t => autoTeacherIds.has(t.id));
        if (appData.currentUser?.role === 'assistant') {
            const assignedDepts = appData.currentUser?.assignedDepartments || [];
            broadTeachers = broadTeachers.filter(t => t.department && assignedDepts.includes(t.department));
        }
        return sortMatchedTeachers(broadTeachers);
    }

    if (assignmentModalContext.fixedTeacherId) {
        const fixedTeacher = teachers.find(t => t.id === assignmentModalContext.fixedTeacherId);
        const isLinked = teacherSubjectAssignments.some(
            tsa => tsa.teacherId === assignmentModalContext.fixedTeacherId &&
                   tsa.subjectId === currentAssignment.subjectId &&
                   (tsa.gradeLevelId === targetGradeId || isChildOf(targetGradeId, tsa.gradeLevelId, gradeLevels)) 
        );
        if (fixedTeacher && isLinked) return [fixedTeacher]; 
    }
    
    let relevantGradeIdsForLinks: string[];
    if (isParentGrade(targetGradeId, gradeLevels)) {
        relevantGradeIdsForLinks = [targetGradeId, ...getChildGradeLevelIds(targetGradeId, gradeLevels)];
    } else {
        const parentOfTarget = getParentGradeLevelId(targetGradeId, gradeLevels);
        relevantGradeIdsForLinks = [targetGradeId];
        if (parentOfTarget) {
            relevantGradeIdsForLinks.push(parentOfTarget);
        }
    }

    const relevantAssignments = teacherSubjectAssignments.filter(
        tsa => tsa.subjectId === currentAssignment.subjectId &&
               relevantGradeIdsForLinks.includes(tsa.gradeLevelId)
    );
    const teacherIdsFromLinks = new Set(relevantAssignments.map(tsa => tsa.teacherId));
    let eligibleTeachers = teachers.filter(t => teacherIdsFromLinks.has(t.id));

    if (appData.currentUser?.role === 'assistant') {
        const assignedDepts = appData.currentUser?.assignedDepartments || [];
        eligibleTeachers = eligibleTeachers.filter(t => t.department && assignedDepts.includes(t.department));
    }
    return sortMatchedTeachers(eligibleTeachers);

  }, [assignmentModalContext, currentAssignment.subjectId, currentAssignment.gradeLevelId, teachers, subjects, teacherSubjectAssignments, gradeLevels]);

  const modalPhysicalRooms = useMemo(() => {
    return [...(physicalRooms || [])].sort((a, b) => {
      return ((a?.code) || '').localeCompare((b?.code) || '', undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [physicalRooms]);
  
  const getModalTitle = () => {
    if (!assignmentModalContext) return "Assign Slot";
    const { day, period } = assignmentModalContext;
    
    const periodDetail = periodSettings[period];
    const periodFullLabel = periodDetail ? `${periodDetail.label} (${periodDetail.startTime} - ${periodDetail.endTime})` : `P${period}`;

    let baseTitle = editingEntryId ? `Edit Assignment: ` : `Assign Slot: `;
    baseTitle += `${day}, ${periodFullLabel}`;

    if (assignmentModalContext.viewType === 'gradeLevelPlanner' && currentAssignment.gradeLevelId) {
      baseTitle = `${gradeLevels.find(gl => gl.id === currentAssignment.gradeLevelId)?.name || ''} - ${baseTitle}`;
    } else if (assignmentModalContext.viewType === 'teacherSchedules' && assignmentModalContext.fixedTeacherId) {
      baseTitle = `For ${teachers.find(t => t.id === assignmentModalContext.fixedTeacherId)?.name || ''} - ${baseTitle}`;
    } else if (assignmentModalContext.viewType === 'roomUsage' && assignmentModalContext.fixedPhysicalRoomId) {
      baseTitle = `In ${formatRoomDisplay((physicalRooms || []).find(c => c.id === assignmentModalContext.fixedPhysicalRoomId)) || ''} - ${baseTitle}`;
    }
    return baseTitle;
  };
  
  const currentSubjectDetailsForModal = currentAssignment.subjectId ? subjects.find(s => s.id === currentAssignment.subjectId) : null;
  const isModalGradeParentForBroadSubject = currentSubjectDetailsForModal?.isBroadAssignment && currentAssignment.gradeLevelId && isParentGrade(currentAssignment.gradeLevelId, gradeLevels);
  
  const isTeacherSelectDisabledInModal = (
      !!currentSubjectDetailsForModal?.isHomeroomAdvisorySubject ||
      (!!assignmentModalContext?.fixedTeacherId && currentSubjectDetailsForModal?.teachingMode === 'single' && !isModalGradeParentForBroadSubject) ||
      !currentAssignment.subjectId ||
      !currentAssignment.gradeLevelId
    ) && !assignmentModalContext?.editingFromChildPerspectiveOfParentEntry;


  const isPhysicalRoomSelectDisabledInModal = useMemo(() => {
    if (assignmentModalContext?.fixedPhysicalRoomId) return true;
    if (assignmentModalContext?.editingFromChildPerspectiveOfParentEntry) return false;

    if (currentSubjectDetailsForModal?.isHomeroomAdvisorySubject && !isSharable(currentSubjectDetailsForModal)) {
      if (currentAssignment.gradeLevelId) {
        const gradeDetails = gradeLevels.find(gl => gl.id === currentAssignment.gradeLevelId);
        if (gradeDetails && !isParentGrade(gradeDetails.id, gradeLevels) && gradeDetails.homeroomPhysicalRoomId) {
          return true; 
        }
      }
    }
    return false;
  }, [assignmentModalContext, currentAssignment, currentSubjectDetailsForModal, gradeLevels]);


  const scheduledPeriodsForSubjectInModal = useMemo(() => {
    if (!currentAssignment.gradeLevelId || !currentSubjectDetailsForModal) return 0;
    
    const targetGradeId = currentAssignment.gradeLevelId;
    let gradesToCheckPpw: string[];

    if (currentSubjectDetailsForModal.isBroadAssignment && isParentGrade(targetGradeId, gradeLevels)) {
        gradesToCheckPpw = [targetGradeId]; 
    } else if (isParentGrade(targetGradeId, gradeLevels)) {
        gradesToCheckPpw = [targetGradeId, ...getChildGradeLevelIds(targetGradeId, gradeLevels)];
    } else {
        gradesToCheckPpw = [targetGradeId];
    }
    
    let count = 0;
    scheduleEntries.forEach(e => {
        if (e.subjectId === currentSubjectDetailsForModal.id && gradesToCheckPpw.includes(e.gradeLevelId)) {
             if (e.id !== editingEntryId) { 
                const editingEntryDetails = editingEntryId ? scheduleEntries.find(se => se.id === editingEntryId) : null;
                if (editingEntryDetails?.blockId && e.blockId === editingEntryDetails.blockId) {
                } else {
                    count++;
                }
            }
        }
    });
    return count;
  }, [currentAssignment.gradeLevelId, currentSubjectDetailsForModal, scheduleEntries, editingEntryId, gradeLevels]);


  const commonPlannerProps = {
    appData,
    periodSettings,
    openAssignmentModal: openAssignmentModalFromContext,
    handleDragStart: handleDragStartInternal,
    handleDropEntry: handleDropEntryInternal,
    handleDragEnd: handleDragEndInternal,
    startTouchDrag,
    handleTouchMove,
    finishTouchDrag,
    draggedEntryId,
    onSlotSelect: handleSlotClickForSharedAvailability,
    getEntryDisplay: (entry: ScheduleEntry) => { 
        const subject = subjects.find(s => s.id === entry.subjectId);
        const entryTeachers = entry.teacherIds.map(tid => teachers.find(t => t.id === tid)).filter(Boolean) as Teacher[];
        const physicalRoom = appData.physicalRooms?.find(r => r.id === entry.physicalRoomId);
        const gradeLevel = gradeLevels.find(gl => gl.id === entry.gradeLevelId);
        return { subject, teachers: entryTeachers, physicalRoom, gradeLevel };
    },
    handleSlotContextMenu,
    gradeHierarchyHelpers: gradeHierarchyHelpers,
    permissions, 
    setAppData, 
    checkConflicts,
    isScheduleVisible,
    setIsScheduleVisible,
    openPrintOptionsModal, // Pass this down
  };


  return (
    <div className="p-4 md:p-6 flex flex-col xl:flex-row gap-6 items-start">
      <div className="flex-1 space-y-6 min-w-0 w-full">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-lg shadow-md p-4 text-white flex flex-col md:flex-row justify-between items-center non-printable">
          <div className="flex items-center gap-3">
            <Icons.Landmark size={28} className="opacity-90" />
            <h1 className="text-xl md:text-2xl font-bold tracking-wide">
              {appData.organizationSettings?.name ? `ระบบจัดตารางสอน: ${appData.organizationSettings.name}` : 'ระบบจัดตารางสอน'}
            </h1>
          </div>
          <div className="mt-2 md:mt-0 flex items-center gap-3">
             <button 
               onClick={() => setIsAuditModalOpen(true)} 
               className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded-full border border-indigo-400 shadow-sm transition-colors flex items-center gap-2"
             >
                🔍 ตรวจสอบความถูกต้อง (Audit)
             </button>
             <div className="text-indigo-100 text-sm font-medium bg-white/10 px-3 py-1.5 rounded-full border border-white/20">
               ภาคเรียนที่ {appData.organizationSettings?.semester || '-'} / {appData.organizationSettings?.academicYear || '-'}
             </div>
          </div>
        </div>

        {appData.organizationSettings?.isLocked && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-center gap-2 text-amber-700 shadow-sm non-printable">
                <Lock size={20} />
                <span className="font-semibold text-sm">ตารางเรียนถูกล็อกไว้ (Read-Only Mode) - ไม่สามารถแก้ไขข้อมูลได้ในขณะนี้</span>
            </div>
        )}

        {discrepancies.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 text-rose-800 shadow-sm non-printable">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <span className="font-semibold text-sm">พบการเปลี่ยนแปลงข้อมูลหลัก {discrepancies.length} รายการ ที่ยังไม่ได้อัปเดตลงตารางสอน</span>
            </div>
            <button
              onClick={() => setIsReviewModalOpen(true)}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition-all duration-200 whitespace-nowrap"
            >
              ตรวจสอบรายการ (Review Changes)
            </button>
          </div>
        )}
        {/* We no longer render tabs to switch views. Instead we render all 3 views. */}
        <GradeLevelPlannerView 
            {...commonPlannerProps}
            onGradeBlockSelect={(blockInfo) => {
                if (blockInfo) {
                    setSelectedBlock({
                        day: blockInfo.day,
                        period: blockInfo.period,
                        gradeLevelId: blockInfo.gradeLevelId,
                        teacherId: blockInfo.teacherIds.length > 0 ? blockInfo.teacherIds[0] : undefined,
                        physicalRoomId: blockInfo.physicalRoomId
                    });
                    if (blockInfo.teacherIds.length > 0) setViewingTeacherId(blockInfo.teacherIds[0]);
                    if (blockInfo.physicalRoomId) setViewingPhysicalRoomId(blockInfo.physicalRoomId);
                } else {
                    setSelectedBlock(null);
                }
            }}
        />
        
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
            <TeacherScheduleView
                {...commonPlannerProps}
                selectedTeacherId={viewingTeacherId}
                onTeacherIdChange={setViewingTeacherId}
            />
            <RoomUsageView
                {...commonPlannerProps}
                selectedPhysicalRoomId={viewingPhysicalRoomId}
                onPhysicalRoomIdChange={setViewingPhysicalRoomId}
            />
        </div>

        {selectedAvailabilitySlot && (
          <div className="space-y-6 mt-6 non-printable">
               <div className="flex justify-end">
                  <button 
                      onClick={clearAvailabilitySlotFilter}
                      className="text-sm text-blue-600 hover:text-blue-800 underline"
                  >
                      Clear Slot Filter & Hide Availability
                  </button>
              </div>
              {renderAvailabilityTableForSlot('teacher', teachers, selectedAvailabilitySlot)}
              {renderAvailabilityTableForSlot('physicalRoom', physicalRooms, selectedAvailabilitySlot)}
          </div>
        )}
      </div>

      {appData.currentUser?.role === 'admin' && (
      <div className="w-full xl:w-72 shrink-0 space-y-4 non-printable sticky top-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center mb-4">
            <History className="w-4 h-4 mr-2" />
            Recent Activity
          </h3>
          <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-2">
            {appData.activityLogs && appData.activityLogs.length > 0 ? (
              appData.activityLogs.map(log => (
                <div key={log.id} className="text-sm pb-3 border-b border-gray-100 last:border-0 last:pb-0">
                  <div className="flex justify-between items-center mb-1">
                    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${
                      log.action === 'Added' ? 'bg-green-100 text-green-700' :
                      (log.action === 'Removed' || log.action === 'Cleared') ? 'bg-red-100 text-red-700' :
                      log.action === 'Logged In' ? 'bg-indigo-100 text-indigo-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {log.action}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-gray-700 leading-tight text-xs mt-1">
                    {log.user ? <span className="font-medium text-slate-900 border-r border-slate-300 pr-1 mr-1">{log.user}</span> : null}
                    {log.description}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-gray-500 text-center py-6">No recent changes.</p>
            )}
          </div>
        </div>
      </div>
      )}

      {isAssignmentModalOpen && assignmentModalContext && (
        <Modal
          isOpen={isAssignmentModalOpen}
          onClose={closeAssignmentModal}
          title={getModalTitle()}
          size="lg"
        >
          <div className="space-y-4">
            {editingEntryId && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setEditingEntryId(null);
                    setCurrentAssignment({
                        ...currentAssignment,
                        subjectId: undefined,
                        teacherIds: [],
                        physicalRoomId: undefined,
                        cohort: '',
                        assignmentDuration: 1
                    });
                    setConflictError(null);
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-md shadow-sm transition-colors flex items-center"
                >
                  <Icons.Add size={16} className="mr-1" /> เพิ่มวิชาแยกกลุ่มเรียนย่อย (Add Split Cohort Assignment)
                </button>
              </div>
            )}
            {conflictError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">{conflictError}</p>}
            
            <div>
              <label htmlFor="subjectId_modal" className="block text-sm font-medium text-slate-700 mb-1">Subject (รายวิชา)</label>
              <select
                id="subjectId_modal"
                name="subjectId"
                value={currentAssignment.subjectId || ''}
                onChange={handleAssignmentChange}
                className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                required
              >
                <option value="" disabled>Select Subject</option>
                {modalSubjects.map(s => (
                  <option key={s.id} value={s.id} style={{ color: s.color }}>
                    {s.name} {s.subjectCode && `(${s.subjectCode})`} 
                    {s.type && s.type !== 'STANDARD' && ` [${s.type}]`}
                    {s.isBroadAssignment && "(Broad)"}
                    {s.isHomeroomAdvisorySubject && "(Advisory)"}
                  </option>
                ))}
              </select>
              {currentAssignment.gradeLevelId && modalSubjects.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                    No subjects found based on current criteria or all subjects have met their weekly period limit for {gradeLevels.find(gl=>gl.id===currentAssignment.gradeLevelId)?.name || 'this grade'}.
                </p>
              )}
              {currentSubjectDetailsForModal && currentSubjectDetailsForModal.periodsPerWeek !== undefined && (
                <p className="text-xs text-slate-500 mt-1">
                  Scheduled: {scheduledPeriodsForSubjectInModal} / {currentSubjectDetailsForModal.periodsPerWeek} periods for this grade scope (excluding current if editing).
                </p>
              )}
              {currentSubjectDetailsForModal?.schedulingPattern && (
                <p className="text-xs text-slate-500 mt-1">
                  Pattern: {currentSubjectDetailsForModal.schedulingPattern}
                </p>
              )}
            </div>

            {currentSubjectDetailsForModal?.type === 'TEACHER_ONLY' ? (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Grade Level</label>
                <div className="p-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600 text-sm">
                  Non-Student (Teacher-Only Slot)
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="gradeLevelId_modal" className="block text-sm font-medium text-slate-700 mb-1">Grade Level</label>
                <select
                  id="gradeLevelId_modal"
                  name="gradeLevelId"
                  value={currentAssignment.gradeLevelId || ''}
                  onChange={handleAssignmentChange}
                  className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                  required
                  disabled={!!assignmentModalContext.fixedGradeLevelId || (!!currentAssignment.gradeLevelId && isParentGrade(currentAssignment.gradeLevelId, gradeLevels) && !permissions.canPerformManagerActions && !!editingEntryId)}
                >
                  <option value="" disabled>Select Grade Level</option>
                  {modalGradeLevels.map(gl => (
                    <option key={gl.id} value={gl.id}>{gl.name}</option>
                  ))}
                </select>
              </div>
            )}
            
            {currentSubjectDetailsForModal?.type !== 'TEACHER_ONLY' && (
              <div>
                <label htmlFor="cohort_modal" className="block text-sm font-medium text-slate-700 mb-1">Student Cohort (กลุ่มเรียน) <span className="text-xs font-normal text-slate-500">(Optional for split classes)</span></label>
                <input
                  type="text"
                  id="cohort_modal"
                  name="cohort"
                  placeholder="e.g., กลุ่มภาษาจีน, กลุ่มภาษาญี่ปุ่น"
                  value={currentAssignment.cohort || ''}
                  onChange={handleAssignmentChange}
                  className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                />
              </div>
            )}

            {!editingEntryId && (
              <div>
                <label htmlFor="assignmentDuration_modal" className="block text-sm font-medium text-slate-700 mb-1">Duration (periods)</label>
                <input
                  type="number"
                  id="assignmentDuration_modal"
                  name="assignmentDuration"
                  value={currentAssignment.assignmentDuration || 1}
                  onChange={handleAssignmentChange}
                  min="1"
                  max={periodSettings.length - (assignmentModalContext.period || 0) } 
                  className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Set to 1 for a single period, or more for a consecutive block.</p>
              </div>
            )}

            {currentSubjectDetailsForModal?.type === 'STUDENT_ONLY' ? (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Teacher(s)</label>
                <div className="p-2 bg-slate-100 border border-slate-300 rounded-md text-slate-600 text-sm">
                  No Teacher Assigned (Student-Only Slot)
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="teacherIds_modal" className="block text-sm font-medium text-slate-700 mb-1">Teacher(s)</label>
                <select
                  id="teacherIds_modal"
                  name="teacherIds"
                  value={
                    currentSubjectDetailsForModal?.teachingMode === 'multiple' || 
                    isModalGradeParentForBroadSubject || 
                    currentSubjectDetailsForModal?.isHomeroomAdvisorySubject ||
                    currentSubjectDetailsForModal?.type === 'TEACHER_ONLY'
                    ? (currentAssignment.teacherIds || [])
                    : (currentAssignment.teacherIds?.[0] || '')
                  }
                  onChange={handleAssignmentChange}
                  multiple={
                    currentSubjectDetailsForModal?.teachingMode === 'multiple' || 
                    isModalGradeParentForBroadSubject || 
                    currentSubjectDetailsForModal?.isHomeroomAdvisorySubject ||
                    currentSubjectDetailsForModal?.type === 'TEACHER_ONLY'
                  }
                  className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                  required
                  disabled={isTeacherSelectDisabledInModal}
                  size={
                    (currentSubjectDetailsForModal?.teachingMode === 'multiple' || 
                     isModalGradeParentForBroadSubject || 
                     currentSubjectDetailsForModal?.isHomeroomAdvisorySubject ||
                     currentSubjectDetailsForModal?.type === 'TEACHER_ONLY') 
                    ? Math.min(5, modalTeachers.length || 1) 
                    : 1
                  }
                >
                  {(!currentAssignment.subjectId || !currentAssignment.gradeLevelId) && modalTeachers.length === 0 && <option value="" disabled>Select Grade & Subject First</option>}
                  {(currentAssignment.subjectId && currentAssignment.gradeLevelId && modalTeachers.length === 0) && <option value="" disabled>No teachers for this subject/grade combination</option>}
                  
                  {currentSubjectDetailsForModal?.teachingMode !== 'multiple' && 
                   !isModalGradeParentForBroadSubject && 
                   !currentSubjectDetailsForModal?.isHomeroomAdvisorySubject && 
                   currentSubjectDetailsForModal?.type !== 'TEACHER_ONLY' && 
                   (!currentAssignment.teacherIds || currentAssignment.teacherIds.length === 0) && (
                      <option value="" disabled>Select Teacher</option>
                  )}

                  {modalTeachers.map(t => (
                    <option key={t.id} value={t.id}>{t.name} {t.teacherCode && `(${t.teacherCode})`}</option>
                  ))}
                </select>
                {currentAssignment.subjectId && currentAssignment.gradeLevelId && modalTeachers.length === 0 && !currentSubjectDetailsForModal?.isHomeroomAdvisorySubject &&
                  <p className="text-xs text-amber-600 mt-1">
                      No teachers are linked to teach {subjects.find(s=>s.id === currentAssignment.subjectId)?.name || 'this subject'} to {gradeLevels.find(gl=>gl.id===currentAssignment.gradeLevelId)?.name || 'this grade scope'}.
                  </p>
                 }
                 {(currentSubjectDetailsForModal?.teachingMode === 'multiple' || isModalGradeParentForBroadSubject || currentSubjectDetailsForModal?.isHomeroomAdvisorySubject) && 
                  <p className="text-xs text-slate-500 mt-1">
                    {currentSubjectDetailsForModal?.isHomeroomAdvisorySubject 
                      ? "Teachers auto-assigned based on homeroom duties."
                      : (isModalGradeParentForBroadSubject 
                          ? "Teachers pre-selected for broad assignments; selection can be adjusted." 
                          : "Hold Ctrl/Cmd to select multiple teachers."
                        )
                    }
                  </p>
                 }
              </div>
            )}

            {currentSubjectDetailsForModal?.type !== 'TEACHER_ONLY' && (
              <>
                <div>
                  <label htmlFor="physicalRoomId_modal" className="block text-sm font-medium text-slate-700 mb-1">Student Cohort (กลุ่มเรียน)</label>
                  <select
                    id="physicalRoomId_modal"
                    name="physicalRoomId"
                    value={currentAssignment.physicalRoomId || ''}
                    onChange={handleAssignmentChange}
                    className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                    required
                    disabled={isPhysicalRoomSelectDisabledInModal}
                  >
                    <option value="" disabled>Select Student Cohort</option>
                    {modalPhysicalRooms.map(c => (
                      <option key={c.id} value={c.id}>{formatRoomDisplay(c)}</option>
                    ))}
                  </select>
                  {isPhysicalRoomSelectDisabledInModal && currentAssignment.physicalRoomId && currentSubjectDetailsForModal?.isHomeroomAdvisorySubject && !isSharable(currentSubjectDetailsForModal) &&
                    !assignmentModalContext?.editingFromChildPerspectiveOfParentEntry && currentAssignment.gradeLevelId && !isParentGrade(currentAssignment.gradeLevelId, gradeLevels) &&
                    <p className="text-xs text-slate-500 mt-1">Cohort auto-assigned based on grade's homeroom for this advisory subject.</p>
                  }
                </div>
                
                <div>
                  <label htmlFor="physicalRoomId_modal_actual" className="block text-sm font-medium text-slate-700 mb-1">Physical Room (สถานที่เรียน)</label>
                  <select
                    id="physicalRoomId_modal_actual"
                    name="physicalRoomId"
                    value={currentAssignment.physicalRoomId || ''}
                    onChange={handleAssignmentChange}
                    className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                  >
                    <option value="">Select Room (Optional)</option>
                    {appData.physicalRooms?.map(r => (
                      <option key={r.id} value={r.id}>{formatRoomDisplay(r)} ({r.type})</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={closeAssignmentModal}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAssignment}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
              >
                {editingEntryId ? 'Save Changes' : 'Assign Slot'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {contextMenu && contextMenu.isOpen && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isOpen={contextMenu.isOpen}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}
       <ConfirmationModal
        isOpen={isConfirmClearModalOpen}
        onClose={() => {
            setIsConfirmClearModalOpen(false);
            setEntryToClearId(null);
        }}
        onConfirm={confirmClearAssignment}
        title="Confirm Clear Entry"
        message={"Are you sure you want to clear this schedule entry?\nIf it's part of a block, the entire block will be removed."}
        confirmButtonText="Clear Entry"
        icon={Icons.Warning}
      />
      {isSlotInspectorModalOpen && slotInspectorModalContext && (
        <SlotAvailabilityInspectorModal
            isOpen={isSlotInspectorModalOpen}
            onClose={() => setIsSlotInspectorModalOpen(false)}
            appData={appData}
            periodSettings={periodSettings}
            day={slotInspectorModalContext.day}
            period={slotInspectorModalContext.period}
            currentGradeLevelId={slotInspectorModalContext.currentGradeLevelId}
        />
      )}

      {completionToast?.isVisible && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
           <div className="bg-white border-l-4 border-green-500 rounded-lg shadow-xl p-4 flex items-start gap-4 max-w-sm">
              <div className="bg-green-100 text-green-600 rounded-full p-2 flex-shrink-0 mt-0.5">
                  <span className="text-xl">✅</span>
              </div>
              <div className="flex-1">
                  <h4 className="text-green-800 font-bold text-sm mb-1 flex items-center justify-between">
                     🎉 จัดตารางสอนครบถ้วน!
                     <button onClick={() => setCompletionToast(prev => prev ? {...prev, isVisible: false} : null)} className="text-slate-400 hover:text-slate-600">
                         <Icons.Close size={14} />
                     </button>
                  </h4>
                  <p className="text-xs text-slate-600 leading-tight">
                     คุณจัดกลุ่มสาระฯ ให้ <strong className="text-slate-800">{completionToast.teacherName} {completionToast.teacherCode && `(${completionToast.teacherCode})`}</strong>
                     <br/>วิชา <strong className="text-slate-800">{completionToast.subjectName}</strong> ในห้อง <strong className="text-slate-800">{completionToast.roomName}</strong>
                     <br/><span className="text-green-700 font-medium">สำเร็จครบ {completionToast.required}/{completionToast.required} คาบแล้ว</span>
                  </p>
              </div>
           </div>
        </div>
      )}

      <AuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        appData={appData}
        currentUser={appData.currentUser}
      />

      <ReviewWizardModal
        isOpen={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        discrepancies={discrepancies}
        onAccept={handleAcceptDiscrepancy}
        onReject={handleRejectDiscrepancy}
        onAcceptAllNonConflicting={handleAcceptAllNonConflicting}
      />
    </div>
  );
};

export default ScheduleScreen;
