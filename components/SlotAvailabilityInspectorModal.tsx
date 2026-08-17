import { formatRoomDisplay } from "../utils/stringUtils";

import React, { useMemo } from 'react';
import { AppData, DayOfWeek, PeriodSetting, Teacher, PhysicalRoom, SlotAvailabilityInspectorModalProps, GradeLevel } from '../types';
import Modal from './Modal';
import { Icons } from '../constants';

const SlotAvailabilityInspectorModal: React.FC<SlotAvailabilityInspectorModalProps> = ({
  isOpen,
  onClose,
  appData,
  day,
  period,
  periodSettings,
  currentGradeLevelId,
}) => {
  const { teachers, physicalRooms, scheduleEntries, gradeLevels } = appData;

  const periodDetail = periodSettings[period];
  const periodLabel = periodDetail ? `${periodDetail.label} (${periodDetail.startTime} - ${periodDetail.endTime})` : `P${period}`;
  const currentGradeLevel = currentGradeLevelId ? gradeLevels.find(gl => gl.id === currentGradeLevelId) : null;

  const availableTeachers = useMemo(() => {
    const busyTeacherIds = new Set<string>();
    scheduleEntries.forEach(entry => {
      if (entry.day === day && entry.period === period) {
        entry.teacherIds.forEach(tid => busyTeacherIds.add(tid));
      }
    });
    return teachers.filter(teacher => !busyTeacherIds.has(teacher.id));
  }, [teachers, scheduleEntries, day, period]);

  const availablePhysicalRooms = useMemo(() => {
    const busyPhysicalRoomIds = new Set<string>();
    scheduleEntries.forEach(entry => {
      if (entry.day === day && entry.period === period && entry.physicalRoomId) {
        busyPhysicalRoomIds.add(entry.physicalRoomId);
      }
    });
    return (physicalRooms || []).filter(physicalRoom => !busyPhysicalRoomIds.has(physicalRoom.id));
  }, [physicalRooms, scheduleEntries, day, period]);

  const modalTitle = `Availability for: ${day}, ${periodLabel}${currentGradeLevel ? ` (Context: ${currentGradeLevel.name})` : ''}`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="lg">
      <div className="space-y-6 p-2">
        <div>
          <h4 className="text-lg font-semibold text-slate-800 mb-2 flex items-center">
            <Icons.Teacher size={20} className="mr-2 text-blue-600" /> Available Teachers ({availableTeachers.length})
          </h4>
          {availableTeachers.length > 0 ? (
            <ul className="list-disc list-inside pl-2 space-y-1 max-h-48 overflow-y-auto bg-slate-50 p-3 rounded-md border border-slate-200">
              {availableTeachers.map(teacher => (
                <li key={teacher.id} className="text-sm text-slate-700">
                  {teacher.name} {teacher.teacherCode && `(${teacher.teacherCode})`}
                  {teacher.department && <span className="text-xs text-slate-500 ml-1"> - {teacher.department}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 italic bg-slate-50 p-3 rounded-md border border-slate-200">No teachers available in this slot.</p>
          )}
        </div>

        <div>
          <h4 className="text-lg font-semibold text-slate-800 mb-2 flex items-center">
            <Icons.Classroom size={20} className="mr-2 text-green-600" /> Available Physical Rooms ({availablePhysicalRooms.length})
          </h4>
          {availablePhysicalRooms.length > 0 ? (
            <ul className="list-disc list-inside pl-2 space-y-1 max-h-48 overflow-y-auto bg-slate-50 p-3 rounded-md border border-slate-200">
              {availablePhysicalRooms.map(physicalRoom => (
                <li key={physicalRoom.id} className="text-sm text-slate-700">
                  {formatRoomDisplay(physicalRoom)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 italic bg-slate-50 p-3 rounded-md border border-slate-200">No physical rooms available in this slot.</p>
          )}
        </div>
        
        <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SlotAvailabilityInspectorModal;
