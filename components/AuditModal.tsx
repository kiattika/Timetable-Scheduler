import React, { useState, useMemo } from 'react';
import { AppData, User } from '../types';
import Modal from './Modal';
import { Icons } from '../constants';
import SearchableSelect from './SearchableSelect';
import { thaiGradeName } from '../utils/subjectCode';

interface AuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  appData: AppData;
  currentUser: User | null;
}

export const AuditModal: React.FC<AuditModalProps> = ({ isOpen, onClose, appData, currentUser }) => {
  const [activeTab, setActiveTab] = useState<'incomplete' | 'completed' | 'over'>('incomplete');
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

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
       // The subject is the source of truth; the link only keeps an older snapshot
       const required = subject?.periodsPerWeek ?? link.periodsPerWeek ?? 0;
       
       const teacher = appData.teachers.find(t => t.id === link.teacherId);
       const gradeLevel = appData.gradeLevels.find(g => g.id === link.gradeLevelId);
       const physicalRoom = stats.lastPhysicalRoomId ? appData.physicalRooms.find(c => c.id === stats.lastPhysicalRoomId) : null;
       
       results.push({
           linkId: link.id,
           teacherName: teacher?.name || 'Unknown Teacher',
           teacherCode: teacher?.teacherCode || '',
           subjectName: subject?.name || 'Unknown Subject',
           subjectCode: subject?.subjectCode || '',
           department: teacher?.department || subject?.department || '',
           gradeLevelName: gradeLevel?.name || '',
           gradeLevelThai: thaiGradeName(gradeLevel?.name || ''),
           roomName: physicalRoom?.name || '-',
           allocated: stats.count,
           required,
           status: stats.count < required ? 'incomplete' : stats.count === required ? 'completed' : 'over'
       });
    });
    
    results.sort((a, b) =>
      a.teacherName.localeCompare(b.teacherName, 'th') ||
      a.subjectName.localeCompare(b.subjectName, 'th') ||
      a.gradeLevelName.localeCompare(b.gradeLevelName, 'th', { numeric: true })
    );
    return results;
  }, [appData, currentUser]);

  const departments = useMemo(
    () => (Array.from(new Set(auditData.map(d => d.department as string).filter(Boolean))) as string[]).sort((x, y) => x.localeCompare(y, 'th')),
    [auditData]
  );

  // Every typed word must match somewhere: teacher name/code, department, subject name/code, grade, room
  const filteredData = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return auditData.filter(d => {
      if (deptFilter && d.department !== deptFilter) return false;
      if (tokens.length === 0) return true;
      const hay = `${d.teacherName} ${d.teacherCode} ${d.department} ${d.subjectName} ${d.subjectCode} ${d.gradeLevelName} ${d.gradeLevelThai} ${d.roomName}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }, [auditData, query, deptFilter]);

  const incomplete = filteredData.filter(d => d.status === 'incomplete');
  const completed = filteredData.filter(d => d.status === 'completed');
  const over = filteredData.filter(d => d.status === 'over');
  const isFiltering = !!query.trim() || !!deptFilter;

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🔍 ตรวจสอบความถูกต้องของตารางสอน (Global Audit)" size="2xl">
      <div className="flex flex-col space-y-4 font-sans text-slate-800 w-full max-w-full min-w-0 overflow-x-hidden" style={{ maxHeight: '70vh' }}>
        
        {/* Search + department filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="พิมพ์ค้นหา: ชื่อครู, กลุ่มสาระฯ, ห้อง/ระดับชั้น (เช่น ม.5/9), รหัสหรือชื่อวิชา"
              className="w-full p-2 pl-9 pr-8 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="ล้างคำค้นหา">✕</button>
            )}
          </div>
          <div className="sm:w-60">
            <SearchableSelect
              value={deptFilter}
              onChange={setDeptFilter}
              placeholder="ค้นหากลุ่มสาระฯ"
              options={[{ value: '', label: 'ทุกกลุ่มสาระฯ' }, ...departments.map(d => ({ value: d, label: d }))]}
            />
          </div>
        </div>
        {isFiltering && (
          <p className="text-xs text-slate-500 -mt-2">
            พบ {filteredData.length} จากทั้งหมด {auditData.length} รายการ
            <button type="button" onClick={() => { setQuery(''); setDeptFilter(''); }} className="ml-2 text-blue-600 hover:underline">ล้างตัวกรอง</button>
          </p>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-x-1 border-b border-slate-200">
           <button 
             onClick={() => setActiveTab('incomplete')}
             className={`px-3 py-2 font-medium text-sm transition-all whitespace-nowrap border-b-2 ${activeTab === 'incomplete' ? 'border-red-500 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
           >
              🔴 ยังไม่ครบ ({incomplete.length})
           </button>
           <button 
             onClick={() => setActiveTab('completed')}
             className={`px-3 py-2 font-medium text-sm transition-all whitespace-nowrap border-b-2 ${activeTab === 'completed' ? 'border-green-500 text-green-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
           >
              🟢 ครบถ้วนแล้ว ({completed.length})
           </button>
           <button 
             onClick={() => setActiveTab('over')}
             className={`px-3 py-2 font-medium text-sm transition-all whitespace-nowrap border-b-2 ${activeTab === 'over' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
           >
              ⚠️ จัดเกินโควตา ({over.length})
           </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto overflow-x-hidden flex-1 min-w-0 pr-2 space-y-3 pb-4">
           {activeTab === 'incomplete' && (
              incomplete.length === 0 ? <p className="text-sm text-slate-500 p-4 text-center">ไม่มีรายการที่ยังจัดไม่ครบ</p> :
              incomplete.map((d, idx) => (
                 <div key={idx} className="bg-red-50 border border-red-200 p-3 rounded-lg flex flex-wrap justify-between items-center gap-2">
                    <div className="min-w-0 flex-1 break-words">
                        <div className="font-semibold text-slate-800">{d.teacherName} {d.teacherCode && `(${d.teacherCode})`}{d.department && <span className="ml-2 text-xs font-normal text-slate-500">· {d.department}</span>}</div>
                        <div className="text-sm text-slate-600">{d.subjectName} {d.subjectCode && `[${d.subjectCode}]`} • ระดับชั้น: {d.gradeLevelThai || d.gradeLevelName} • ห้อง: {d.roomName}</div>
                    </div>
                    <div className="text-right shrink-0">
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
                 <div key={idx} className="bg-green-50 border border-green-200 p-3 rounded-lg flex flex-wrap justify-between items-center gap-2">
                    <div className="min-w-0 flex-1 break-words">
                        <div className="font-semibold text-slate-800 flex items-center gap-2">
                           {d.teacherName} {d.teacherCode && `(${d.teacherCode})`}{d.department && <span className="ml-2 text-xs font-normal text-slate-500">· {d.department}</span>}
                        </div>
                        <div className="text-sm text-slate-600">{d.subjectName} {d.subjectCode && `[${d.subjectCode}]`} • ระดับชั้น: {d.gradeLevelThai || d.gradeLevelName} • ห้อง: {d.roomName}</div>
                    </div>
                    <div className="text-right shrink-0">
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
                 <div key={idx} className="bg-amber-50 border border-amber-300 p-3 rounded-lg flex flex-wrap justify-between items-center gap-2">
                    <div className="min-w-0 flex-1 break-words">
                        <div className="font-semibold text-slate-800">{d.teacherName} {d.teacherCode && `(${d.teacherCode})`}{d.department && <span className="ml-2 text-xs font-normal text-slate-500">· {d.department}</span>}</div>
                        <div className="text-sm text-slate-600">{d.subjectName} {d.subjectCode && `[${d.subjectCode}]`} • ระดับชั้น: {d.gradeLevelThai || d.gradeLevelName} • ห้อง: {d.roomName}</div>
                    </div>
                    <div className="text-right shrink-0">
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
