import React, { useState, useMemo } from 'react';
import { AppData, User } from '../types';
import Modal from './Modal';
import { Icons } from '../constants';

interface AuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  appData: AppData;
  currentUser: User | null;
}

export const AuditModal: React.FC<AuditModalProps> = ({ isOpen, onClose, appData, currentUser }) => {
  const [activeTab, setActiveTab] = useState<'incomplete' | 'completed' | 'over'>('incomplete');

  const auditData = useMemo(() => {
    const results = [];
    
    // Create a map to quickly count allocations and last physicalRoom used
    const allocationCounts = new Map<string, { count: number, lastPhysicalRoomId: string | null }>();
    const scheduleEntries = Array.isArray(appData.scheduleEntries) ? appData.scheduleEntries : [];
    
    scheduleEntries.forEach(entry => {
      entry.teacherIds.forEach(tId => {
        const key = `${tId}-${entry.subjectId}-${entry.gradeLevelId}`;
        const current = allocationCounts.get(key) || { count: 0, lastPhysicalRoomId: null };
        allocationCounts.set(key, { count: current.count + 1, lastPhysicalRoomId: entry.physicalRoomId });
      });
    });

    const isAssistant = currentUser?.role === 'assistant';
    const assignedDepts = currentUser?.assignedDepartments || [];

    // Filter teacher assignments if assistant
    let relevantLinks = appData.teacherSubjectAssignments;
    if (isAssistant) {
       relevantLinks = relevantLinks.filter(link => {
           // We also check if the assignment has a department. Alternatively we check teacher.department
           const t = appData.teachers.find(t => t.id === link.teacherId);
           return t && t.department && assignedDepts.includes(t.department);
       });
    }

    relevantLinks.forEach(link => {
       const key = `${link.teacherId}-${link.subjectId}-${link.gradeLevelId}`;
       const stats = allocationCounts.get(key) || { count: 0, lastPhysicalRoomId: null };
       
       const subject = appData.subjects.find(s => s.id === link.subjectId);
       const required = link.periodsPerWeek || subject?.periodsPerWeek || 0;
       
       const teacher = appData.teachers.find(t => t.id === link.teacherId);
       const gradeLevel = appData.gradeLevels.find(g => g.id === link.gradeLevelId);
       const physicalRoom = stats.lastPhysicalRoomId ? appData.physicalRooms.find(c => c.id === stats.lastPhysicalRoomId) : null;
       
       results.push({
           linkId: link.id,
           teacherName: teacher?.name || 'Unknown Teacher',
           teacherCode: teacher?.teacherCode || '',
           subjectName: subject?.name || 'Unknown Subject',
           subjectCode: subject?.subjectCode || '',
           gradeLevelName: gradeLevel?.name || '',
           roomName: physicalRoom?.name || '-',
           allocated: stats.count,
           required,
           status: stats.count < required ? 'incomplete' : stats.count === required ? 'completed' : 'over'
       });
    });
    
    return results;
  }, [appData, currentUser]);

  const incomplete = auditData.filter(d => d.status === 'incomplete');
  const completed = auditData.filter(d => d.status === 'completed');
  const over = auditData.filter(d => d.status === 'over');

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🔍 ตรวจสอบความถูกต้องของตารางสอน (Global Audit)">
      <div className="flex flex-col space-y-4 font-sans text-slate-800" style={{ maxHeight: '70vh', minWidth: '600px' }}>
        
        {/* Tabs */}
        <div className="flex space-x-2 border-b border-slate-200">
           <button 
             onClick={() => setActiveTab('incomplete')}
             className={`px-4 py-2 font-medium text-sm transition-all border-b-2 ${activeTab === 'incomplete' ? 'border-red-500 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
           >
              🔴 ยังไม่ครบ ({incomplete.length})
           </button>
           <button 
             onClick={() => setActiveTab('completed')}
             className={`px-4 py-2 font-medium text-sm transition-all border-b-2 ${activeTab === 'completed' ? 'border-green-500 text-green-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
           >
              🟢 ครบถ้วนแล้ว ({completed.length})
           </button>
           <button 
             onClick={() => setActiveTab('over')}
             className={`px-4 py-2 font-medium text-sm transition-all border-b-2 ${activeTab === 'over' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
           >
              ⚠️ จัดเกินโควตา ({over.length})
           </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 pr-2 space-y-3 pb-4">
           {activeTab === 'incomplete' && (
              incomplete.length === 0 ? <p className="text-sm text-slate-500 p-4 text-center">ไม่มีรายการที่ยังจัดไม่ครบ</p> :
              incomplete.map((d, idx) => (
                 <div key={idx} className="bg-red-50 border border-red-200 p-3 rounded-lg flex justify-between items-center">
                    <div>
                        <div className="font-semibold text-slate-800">{d.teacherName} {d.teacherCode && `(${d.teacherCode})`}</div>
                        <div className="text-sm text-slate-600">{d.subjectName} {d.subjectCode && `[${d.subjectCode}]`} • ระดับชั้น: {d.gradeLevelName} • ห้อง: {d.roomName}</div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                        <span className="bg-white border border-red-200 text-red-600 px-3 py-1 rounded-full text-xs font-bold shadow-sm">
                            จัดแล้ว {d.allocated}/{d.required} คาบ (ขาดอีก {d.required - d.allocated} คาบ)
                        </span>
                    </div>
                 </div>
              ))
           )}

           {activeTab === 'completed' && (
              completed.length === 0 ? <p className="text-sm text-slate-500 p-4 text-center">ไม่มีรายการที่จัดครบถ้วน</p> :
              completed.map((d, idx) => (
                 <div key={idx} className="bg-green-50 border border-green-200 p-3 rounded-lg flex justify-between items-center">
                    <div>
                        <div className="font-semibold text-slate-800 flex items-center gap-2">
                           {d.teacherName} {d.teacherCode && `(${d.teacherCode})`}
                        </div>
                        <div className="text-sm text-slate-600">{d.subjectName} {d.subjectCode && `[${d.subjectCode}]`} • ระดับชั้น: {d.gradeLevelName} • ห้อง: {d.roomName}</div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                        <span className="bg-white border border-green-200 text-green-600 px-3 py-1 rounded-full text-xs font-bold shadow-sm flex items-center gap-1">
                            ✅ สมบูรณ์ {d.allocated}/{d.required} คาบ
                        </span>
                    </div>
                 </div>
              ))
           )}

           {activeTab === 'over' && (
              over.length === 0 ? <p className="text-sm text-slate-500 p-4 text-center">ไม่มีรายการจัดเกินโควตา</p> :
              over.map((d, idx) => (
                 <div key={idx} className="bg-amber-50 border border-amber-300 p-3 rounded-lg flex justify-between items-center">
                    <div>
                        <div className="font-semibold text-slate-800">{d.teacherName} {d.teacherCode && `(${d.teacherCode})`}</div>
                        <div className="text-sm text-slate-600">{d.subjectName} {d.subjectCode && `[${d.subjectCode}]`} • ระดับชั้น: {d.gradeLevelName} • ห้อง: {d.roomName}</div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                        <span className="bg-white border border-amber-300 text-amber-700 px-3 py-1 rounded-full text-xs font-bold shadow-sm">
                            จัดเกิน {d.allocated}/{d.required} คาบ (เกินมา {d.allocated - d.required} คาบ)
                        </span>
                    </div>
                 </div>
              ))
           )}
        </div>
      </div>
    </Modal>
  );
};
