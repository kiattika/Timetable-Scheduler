
import React, { useState } from 'react';
import { PeriodSetting, GradeLevel, ScreenAccessProps, Subject, Teacher, TeacherSubjectAssignment, ScheduleEntry, FixedActivity, DayOfWeek } from '../types';
import { planFixedActivityEntries, FixedActivityPlan } from '../lib/fixedActivities';
import { subjectOfferedInSemester } from './scheduleUtils';
import { thaiGradeName } from '../utils/subjectCode';
import Modal from './Modal';
import ConfirmationModal from './ConfirmationModal';
import { Icons } from '../constants';

interface PeriodSettingsManagementScreenProps extends ScreenAccessProps {
  periodSettings: PeriodSetting[];
  gradeLevels: GradeLevel[];
  setPeriodSettings: React.Dispatch<React.SetStateAction<PeriodSetting[]>>;
  deletePeriodSetting: (periodId: string) => void;
  // For fixed activities (reserve a subject in a period and generate timetable entries from it)
  subjects?: Subject[];
  teachers?: Teacher[];
  teacherSubjectAssignments?: TeacherSubjectAssignment[];
  scheduleEntries?: ScheduleEntry[];
  setScheduleEntries?: (updater: (prev: ScheduleEntry[]) => ScheduleEntry[]) => void;
  currentSemester?: string;
  operatingDays?: DayOfWeek[];
}

const ALL_DAYS: DayOfWeek[] = [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday];
const DAY_TH: Record<string, string> = { Monday: 'จ.', Tuesday: 'อ.', Wednesday: 'พ.', Thursday: 'พฤ.', Friday: 'ศ.', Saturday: 'ส.', Sunday: 'อา.' };
const SKIP_TH: Record<string, string> = {
  no_teacher: 'ยังไม่มีครูที่เชื่อมโยงกับวิชานี้',
  slot_taken: 'คาบนี้มีรายการอื่นอยู่แล้ว',
  teachers_busy: 'ครูติดสอนคาบอื่น',
  subject_missing: 'ไม่พบวิชา',
};

const PeriodSettingsManagementScreen: React.FC<PeriodSettingsManagementScreenProps> = ({
  periodSettings,
  gradeLevels,
  setPeriodSettings,
  deletePeriodSetting,
  permissions,
  subjects = [],
  teachers = [],
  teacherSubjectAssignments = [],
  scheduleEntries = [],
  setScheduleEntries,
  currentSemester,
  operatingDays,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [currentPeriod, setCurrentPeriod] = useState<Partial<PeriodSetting>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const [periodToDeleteId, setPeriodToDeleteId] = useState<string | null>(null);
  const [periodToDeleteName, setPeriodToDeleteName] = useState<string>('');

  // Generator state
  const [genUseP0, setGenUseP0] = useState(false);
  const [genTotalPeriods, setGenTotalPeriods] = useState<number>(8);
  const [genStartTime, setGenStartTime] = useState<string>('08:30');
  const [genPeriodDuration, setGenPeriodDuration] = useState<number>(50);
  const [genBreakDuration, setGenBreakDuration] = useState<number>(60);
  const [genBreakAfter, setGenBreakAfter] = useState<number>(4);

  const IconComponent = Icons.Settings;

  // ---- Fixed activities (subjects reserved in a period) ----
  const days = (operatingDays && operatingDays.length > 0 ? operatingDays : ALL_DAYS);
  const [plan, setPlan] = useState<FixedActivityPlan | null>(null);
  const subjectLabel = (id: string) => {
    const sb = subjects.find(x => x.id === id);
    return sb ? (sb.subjectCode ? `[${sb.subjectCode}] ${sb.name}` : sb.name) : 'ไม่พบวิชา';
  };
  const subjectOptions = subjects.filter(sb => subjectOfferedInSemester(sb, currentSemester));
  const activities: FixedActivity[] = currentPeriod.fixedActivities || [];
  const setActivities = (next: FixedActivity[]) => setCurrentPeriod(prev => ({ ...prev, fixedActivities: next }));
  const addActivity = () => setActivities([...activities, { id: crypto.randomUUID(), subjectId: '', gradeLevelIds: [], days: [] }]);
  const patchActivity = (id: string, patch: Partial<FixedActivity>) => setActivities(activities.map(a => a.id === id ? { ...a, ...patch } : a));
  const toggleIn = <T,>(list: T[], v: T) => list.includes(v) ? list.filter(x => x !== v) : [...list, v];
  const totalActivities = periodSettings.reduce((n, p) => n + (p.fixedActivities || []).length, 0);

  const previewGenerate = () => {
    setPlan(planFixedActivityEntries({
      periodSettings, subjects, teachers, gradeLevels,
      links: teacherSubjectAssignments, existing: scheduleEntries,
    }));
  };
  const applyGenerate = () => {
    if (!plan || !setScheduleEntries) return;
    const gone = new Set(plan.replacedIds);
    setScheduleEntries(prev => [...prev.filter(e => !gone.has(e.id)), ...plan.entries]);
    setPlan(null);
  };

  // Parent grade levels (e.g. M.1) – lunch is set per parent level and applies to all its classrooms
  const parentGrades = React.useMemo(
    () => gradeLevels.filter(g => !g.name.includes('/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [gradeLevels]
  );
  const gradeNameById = (id: string) => thaiGradeName(gradeLevels.find(g => g.id === id)?.name || '');
  const toggleLunchGrade = (gid: string) => {
    setCurrentPeriod(prev => {
      const cur = prev.lunchGradeLevelIds || [];
      return { ...prev, lunchGradeLevelIds: cur.includes(gid) ? cur.filter(x => x !== gid) : [...cur, gid] };
    });
  };
  // Grades already used as lunch by another period (a grade can have only one lunch period)
  const lunchTakenBy = (gid: string): string | null => {
    const other = periodSettings.find(p => p.id !== editingId && (p.lunchGradeLevelIds || []).includes(gid));
    return other ? other.label : null;
  };

  const openModalForNew = () => {
    setCurrentPeriod({ label: '', startTime: '08:00', endTime: '08:50' });
    setEditingId(null);
    setError(null);
    setIsModalOpen(true);
  };

  const openModalForEdit = (period: PeriodSetting) => {
    setCurrentPeriod({ ...period });
    setEditingId(period.id);
    setError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setCurrentPeriod({});
    setEditingId(null);
    setError(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCurrentPeriod(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!currentPeriod.label?.trim()) {
      setError('ชื่อเรียกคาบเรียน (Label) ไม่สามารถเว้นว่างได้');
      return;
    }
    if (!currentPeriod.startTime || !currentPeriod.endTime) {
      setError('กรุณาระบุเวลาเริ่มต้นและสิ้นสุด');
      return;
    }

    // Convert times to comparable values (e.g., minutes from midnight)
    const [startH, startM] = currentPeriod.startTime.split(':').map(Number);
    const [endH, endM] = currentPeriod.endTime.split(':').map(Number);
    const startTimeInMinutes = startH * 60 + startM;
    const endTimeInMinutes = endH * 60 + endM;

    if (startTimeInMinutes >= endTimeInMinutes) {
      setError('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น');
      return;
    }
    
    // Check for overlap with other periods (excluding the one being edited)
    for (const ps of periodSettings) {
        if (editingId && ps.id === editingId) continue; // Skip self when editing

        const [otherStartH, otherStartM] = ps.startTime.split(':').map(Number);
        const [otherEndH, otherEndM] = ps.endTime.split(':').map(Number);
        const otherStartTimeInMinutes = otherStartH * 60 + otherStartM;
        const otherEndTimeInMinutes = otherEndH * 60 + otherEndM;

        // Check for overlap: (StartA < EndB) and (EndA > StartB)
        if (startTimeInMinutes < otherEndTimeInMinutes && endTimeInMinutes > otherStartTimeInMinutes) {
            setError(`คาบเรียนนี้มีช่วงเวลาทับซ้อนกับคาบ '${ps.label}' (${ps.startTime} - ${ps.endTime})`);
            return;
        }
    }


    const lunchIds = currentPeriod.lunchGradeLevelIds || [];
    const acts = (currentPeriod.fixedActivities || []).filter(a => a.subjectId && a.gradeLevelIds.length > 0 && a.days.length > 0);
    if ((currentPeriod.fixedActivities || []).length !== acts.length) {
      setError('วิชาที่กำหนดในคาบ: กรุณาเลือกวิชา ระดับชั้น และวันให้ครบทุกรายการ (หรือลบรายการที่ไม่ใช้)');
      return;
    }
    const withLunch = <T extends PeriodSetting>(obj: T): T => {
      const copy = { ...obj } as T;
      if (acts.length > 0) copy.fixedActivities = acts; else delete copy.fixedActivities;
      if (lunchIds.length > 0) copy.lunchGradeLevelIds = lunchIds; else delete copy.lunchGradeLevelIds;
      return copy;
    };

    if (editingId) {
      setPeriodSettings(prev =>
        prev.map(p => (p.id === editingId ? withLunch({ ...p, ...currentPeriod, id: editingId } as PeriodSetting) : p))
      );
    } else {
      const newPeriod: PeriodSetting = {
        id: crypto.randomUUID(),
        label: currentPeriod.label!,
        startTime: currentPeriod.startTime!,
        endTime: currentPeriod.endTime!,
      };
      setPeriodSettings(prev => [...prev, withLunch(newPeriod)]);
    }
    closeModal();
  };

  const handleGeneratePeriods = (e: React.FormEvent) => {
    e.preventDefault();

    const timeStringToMinutes = (timeStr: string): number => {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };

    const minutesToTimeString = (minutes: number): string => {
      const h = Math.floor(minutes / 60) % 24;
      const m = minutes % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    let currentMinutes = timeStringToMinutes(genStartTime);
    const newPeriods: PeriodSetting[] = [];

    let periodCount = 0;
    const startNum = genUseP0 ? 0 : 1;
    const endNum = genUseP0 ? genTotalPeriods - 1 : genTotalPeriods;

    for (let i = startNum; i <= endNum; i++) {
      periodCount++;
      // Add study period
      const startStr = minutesToTimeString(currentMinutes);
      currentMinutes += genPeriodDuration;
      const endStr = minutesToTimeString(currentMinutes);

      newPeriods.push({
        id: crypto.randomUUID(),
        label: `P${i}`,
        startTime: startStr,
        endTime: endStr,
      });

      // Check if we need to add a break after this study period
      if (genBreakDuration > 0 && periodCount === genBreakAfter && periodCount < genTotalPeriods) {
        const breakStart = minutesToTimeString(currentMinutes);
        currentMinutes += genBreakDuration;
        const breakEnd = minutesToTimeString(currentMinutes);

        newPeriods.push({
          id: crypto.randomUUID(),
          label: 'พัก',
          startTime: breakStart,
          endTime: breakEnd,
        });
      }
    }

    setPeriodSettings(newPeriods);
    setIsGenerateModalOpen(false);
  };

  const requestDelete = (id: string) => {
    if (!permissions.canPerformManagerActions) {
        alert('เฉพาะผู้จัดการเท่านั้นที่สามารถลบการตั้งค่าคาบเรียนได้');
        return;
    }
    const period = periodSettings.find(p => p.id === id);
    if (period) {
        setPeriodToDeleteId(id);
        setPeriodToDeleteName(period.label);
        setIsConfirmDeleteModalOpen(true);
    }
  };

  const confirmDelete = () => {
    if (periodToDeleteId) {
      deletePeriodSetting(periodToDeleteId);
    }
    setIsConfirmDeleteModalOpen(false);
    setPeriodToDeleteId(null);
    setPeriodToDeleteName('');
  };


  return (
    <div className="p-4 md:p-6 bg-white shadow-lg rounded-lg">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center">
          {IconComponent && <IconComponent size={32} className="mr-3 text-blue-600" />}
          <h2 className="text-2xl font-semibold text-slate-800">จัดการการตั้งค่าคาบเรียน</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setIsGenerateModalOpen(true)}
            className="flex items-center bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 px-4 rounded-md shadow-md transition-colors duration-150"
            aria-label="สร้างคาบเรียนอัตโนมัติ"
          >
            <Icons.Sparkles size={20} className="mr-2" /> สร้างคาบเรียนอัตโนมัติ
          </button>
          {setScheduleEntries && totalActivities > 0 && permissions.canPerformManagerActions && (
            <button
              onClick={previewGenerate}
              className="flex items-center bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded-md shadow-md transition-colors duration-150"
              title="สร้างรายการในตารางเรียน/ตารางสอนตามวิชาที่กำหนดไว้ในแต่ละคาบ"
            >
              📌 ลงตารางตามวิชาที่กำหนด ({totalActivities})
            </button>
          )}
          <button
            onClick={openModalForNew}
            className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md shadow-md transition-colors duration-150"
            aria-label="เพิ่มคาบเรียนใหม่"
          >
            <Icons.Add size={20} className="mr-2" /> เพิ่มคาบเรียนใหม่
          </button>
        </div>
      </div>

      {periodSettings.length === 0 ? (
        <p className="text-slate-500 text-center py-8">ยังไม่มีการตั้งค่าคาบเรียน คลิก "เพิ่มคาบเรียนใหม่" เพื่อเริ่มต้น</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">ชื่อเรียก (Label)</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">เวลาเริ่มต้น</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">เวลาสิ้นสุด</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">พักกลางวันของ</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">วิชาที่กำหนดไว้</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {periodSettings.map(period => (
                <tr key={period.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{period.label}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{period.startTime}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{period.endTime}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {(period.lunchGradeLevelIds || []).length > 0
                      ? <span className="inline-flex flex-wrap gap-1">{(period.lunchGradeLevelIds || []).map(id => <span key={id} className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">🍽️ {gradeNameById(id)}</span>)}</span>
                      : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {(period.fixedActivities || []).length > 0
                      ? <span className="flex flex-col gap-1">{(period.fixedActivities || []).map(a => (
                          <span key={a.id} className="inline-block px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-xs font-medium">
                            📌 {subjectLabel(a.subjectId)} · {a.gradeLevelIds.map(gradeNameById).join(', ')} · {a.days.map(d => DAY_TH[d] || d).join(' ')}
                          </span>))}</span>
                      : <span className="text-slate-300">-</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    <button
                      onClick={() => openModalForEdit(period)}
                      className="text-blue-600 hover:text-blue-800 transition-colors"
                      title="แก้ไขคาบเรียน"
                      aria-label={`แก้ไขคาบเรียน ${period.label}`}
                    >
                      <Icons.Edit size={18} />
                    </button>
                    <button
                      onClick={() => requestDelete(period.id)}
                      className={`transition-colors ${permissions.canPerformManagerActions ? 'text-red-600 hover:text-red-800' : 'text-slate-400 cursor-not-allowed'}`}
                      title={permissions.canPerformManagerActions ? "ลบคาบเรียน" : "การลบจำกัดเฉพาะผู้จัดการ"}
                      aria-label={`ลบคาบเรียน ${period.label}`}
                      disabled={!permissions.canPerformManagerActions}
                    >
                      <Icons.Delete size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={`${editingId ? 'แก้ไข' : 'เพิ่ม'}คาบเรียน`}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">{error}</p>}
          <div>
            <label htmlFor="label" className="block text-sm font-medium text-slate-700 mb-1">
              ชื่อเรียกคาบเรียน (Label) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="label"
              name="label"
              value={currentPeriod.label || ''}
              onChange={handleInputChange}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              placeholder="เช่น P0, พักกลางวัน"
              required
            />
          </div>
          <div>
            <label htmlFor="startTime" className="block text-sm font-medium text-slate-700 mb-1">
              เวลาเริ่มต้น <span className="text-red-500">*</span>
            </label>
            <input
              type="time"
              id="startTime"
              name="startTime"
              value={currentPeriod.startTime || ''}
              onChange={handleInputChange}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="endTime" className="block text-sm font-medium text-slate-700 mb-1">
              เวลาสิ้นสุด <span className="text-red-500">*</span>
            </label>
            <input
              type="time"
              id="endTime"
              name="endTime"
              value={currentPeriod.endTime || ''}
              onChange={handleInputChange}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              required
            />
          </div>
          <fieldset className="border border-amber-200 bg-amber-50/50 p-3 rounded-md min-w-0 w-full">
            <legend className="text-sm font-medium text-amber-800 px-1">🍽️ คาบนี้เป็นพักกลางวันของระดับชั้น</legend>
            <p className="text-xs text-slate-500 mb-2">ระดับชั้นที่เลือกจะแสดงข้อความ "พักกลางวัน" ในตารางชั้นเรียนของคาบนี้ และระบบจะไม่อนุญาตให้จัดคาบสอนลงไป (ใช้กับทุกห้อง เช่น เลือก ม.1 = ม.1/1 ถึง ม.1/n)</p>
            <div className="grid grid-cols-3 gap-2">
              {parentGrades.map(g => {
                const taken = lunchTakenBy(g.id);
                const checked = (currentPeriod.lunchGradeLevelIds || []).includes(g.id);
                return (
                  <label key={g.id} className={`flex items-center text-sm ${taken && !checked ? 'text-slate-400' : 'text-slate-700'}`} title={taken && !checked ? `ระดับชั้นนี้ตั้งพักกลางวันที่คาบ ${taken} แล้ว` : undefined}>
                    <input type="checkbox" checked={checked} onChange={() => toggleLunchGrade(g.id)} className="rounded text-amber-600 focus:ring-amber-500 mr-1.5" />
                    {thaiGradeName(g.name)}{taken && !checked ? ` (${taken})` : ''}
                  </label>
                );
              })}
            </div>
            {parentGrades.length === 0 && <p className="text-xs text-slate-400">ยังไม่มีระดับชั้นหลัก (เช่น ม.1) ในโครงสร้างระดับชั้น</p>}
          </fieldset>
          <fieldset className="border border-indigo-200 bg-indigo-50/50 p-3 rounded-md min-w-0 w-full">
            <legend className="text-sm font-medium text-indigo-800 px-1">📌 วิชาที่กำหนดไว้ในคาบนี้</legend>
            <p className="text-xs text-slate-500 mb-2">จองคาบนี้ให้วิชา เช่น กิจกรรมชุมนุม ลูกเสือ-เนตรนารี Cleaning Zone แล้วกดปุ่ม "ลงตารางตามวิชาที่กำหนด" ในหน้านี้เพื่อสร้างรายการในตารางให้อัตโนมัติ (ใช้ครูที่เชื่อมโยงกับวิชาในหน้า Teacher-Subject Links)</p>
            <div className="space-y-3">
              {activities.map(a => (
                <div key={a.id} className="rounded-md border border-indigo-200 bg-white p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={a.subjectId}
                      onChange={e => patchActivity(a.id, { subjectId: e.target.value })}
                      className="flex-1 min-w-0 p-1.5 text-sm border border-slate-300 rounded-md bg-white"
                      aria-label="วิชา"
                    >
                      <option value="">— เลือกวิชา —</option>
                      {subjectOptions.map(sb => <option key={sb.id} value={sb.id}>{sb.subjectCode ? `[${sb.subjectCode}] ` : ''}{sb.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setActivities(activities.filter(x => x.id !== a.id))} className="text-red-600 hover:text-red-800 p-1" title="ลบรายการนี้" aria-label="ลบรายการ">
                      <Icons.Delete size={16} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span className="text-xs text-slate-500">วัน:</span>
                    {days.map(d => (
                      <label key={d} className="flex items-center text-xs text-slate-700">
                        <input type="checkbox" checked={a.days.includes(d)} onChange={() => patchActivity(a.id, { days: toggleIn(a.days, d) })} className="rounded mr-1" />{DAY_TH[d] || d}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <span className="text-xs text-slate-500">ระดับชั้น:</span>
                    {parentGrades.map(g => (
                      <label key={g.id} className="flex items-center text-xs text-slate-700">
                        <input type="checkbox" checked={a.gradeLevelIds.includes(g.id)} onChange={() => patchActivity(a.id, { gradeLevelIds: toggleIn(a.gradeLevelIds, g.id) })} className="rounded mr-1" />{thaiGradeName(g.name)}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={addActivity} className="mt-2 text-sm font-medium text-indigo-700 hover:text-indigo-900">+ เพิ่มวิชาในคาบนี้</button>
          </fieldset>
          <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
            >
              {editingId ? 'บันทึกการเปลี่ยนแปลง' : 'เพิ่มคาบเรียน'}
            </button>
          </div>
        </form>
      </Modal>
      
      <Modal isOpen={plan !== null} onClose={() => setPlan(null)} title="ลงตารางตามวิชาที่กำหนด" size="md">
        {plan && (
          <div className="space-y-3 text-sm text-slate-700">
            <p>จะสร้างรายการในตาราง <b>{plan.entries.length}</b> รายการ
              {plan.replacedIds.length > 0 ? <> (แทนที่รายการที่ระบบเคยสร้างไว้ {plan.replacedIds.length} รายการ)</> : null}
              {plan.skipped.length > 0 ? <> · ข้าม <b>{plan.skipped.length}</b> รายการ</> : null}
            </p>
            {plan.skipped.length > 0 && (
              <ul className="max-h-56 overflow-y-auto list-disc list-inside text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 space-y-0.5">
                {plan.skipped.map((k, i) => (
                  <li key={i}>
                    {subjectLabel(k.subjectId)} · {k.gradeLevelId === 'Non-Student' ? 'เฉพาะครู' : gradeNameById(k.gradeLevelId) || (gradeLevels.find(g => g.id === k.gradeLevelId)?.name ?? '')} · {DAY_TH[k.day] || k.day} {periodSettings[k.period]?.label} — {SKIP_TH[k.reason]}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-500">รายการที่จัดไว้เองแล้วจะไม่ถูกแก้ไข ลบรายการที่สร้างได้จากหน้าตารางตามปกติ</p>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setPlan(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300">ยกเลิก</button>
              <button type="button" onClick={applyGenerate} disabled={plan.entries.length === 0 && plan.replacedIds.length === 0} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md shadow-sm">ยืนยันลงตาราง</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        title="สร้างช่วงเวลาคาบเรียนอัตโนมัติ"
        size="md"
      >
        <form onSubmit={handleGeneratePeriods} className="space-y-4">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
            <p className="font-semibold mb-1">💡 ข้อมูลการจัดเวลาอัตโนมัติ:</p>
            <p>ระบบจะคำนวณและสร้างรายการคาบเรียนใหม่ทั้งหมดตามที่ท่านระบุ โดยสามารถเริ่มนับด้วย <strong>P0</strong> หรือ <strong>P1</strong> และกำหนดเวลาเริ่มต้นกับเวลาต่อคาบได้ตามต้องการ</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                เริ่มนับคาบเรียนด้วย
              </label>
              <div className="flex gap-4 mt-2">
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    name="genUseP0"
                    checked={genUseP0}
                    onChange={() => setGenUseP0(true)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-slate-700">P0</span>
                </label>
                <label className="inline-flex items-center">
                  <input
                    type="radio"
                    name="genUseP0"
                    checked={!genUseP0}
                    onChange={() => setGenUseP0(false)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-slate-700">P1</span>
                </label>
              </div>
            </div>

            <div>
              <label htmlFor="genTotalPeriods" className="block text-sm font-medium text-slate-700 mb-1">
                จำนวนคาบเรียนทั้งหมด <span className="text-red-500">*</span>
              </label>
              <select
                id="genTotalPeriods"
                value={genTotalPeriods}
                onChange={(e) => setGenTotalPeriods(Number(e.target.value))}
                className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              >
                {[...Array(12).keys()].map(x => (
                  <option key={x + 1} value={x + 1}>{x + 1} คาบ</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="genStartTime" className="block text-sm font-medium text-slate-700 mb-1">
                เวลาเริ่มต้นคาบแรก <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                id="genStartTime"
                value={genStartTime}
                onChange={(e) => setGenStartTime(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                required
              />
            </div>

            <div>
              <label htmlFor="genPeriodDuration" className="block text-sm font-medium text-slate-700 mb-1">
                เวลาต่อสองคาบ (นาที) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                id="genPeriodDuration"
                min="5"
                max="180"
                value={genPeriodDuration}
                onChange={(e) => setGenPeriodDuration(Number(e.target.value))}
                className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                required
              />
            </div>
          </div>

          <fieldset className="border border-slate-200 p-3 rounded-md space-y-3 min-w-0 w-full shrink">
            <legend className="text-sm font-medium text-slate-700 px-1">เวลาพัก / พักกลางวัน</legend>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="hasBreak"
                checked={genBreakDuration > 0}
                onChange={(e) => {
                  if (e.target.checked) {
                    setGenBreakDuration(50);
                    setGenBreakAfter(4);
                  } else {
                    setGenBreakDuration(0);
                  }
                }}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="hasBreak" className="text-sm text-slate-700">แทรกเวลาพักคาบเรียนโดยอัตโนมัติ</label>
            </div>

            {genBreakDuration > 0 && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="genBreakAfter" className="block text-xs font-medium text-slate-600 mb-1">
                    พักจบควิก/คาบที่
                  </label>
                  <select
                    id="genBreakAfter"
                    value={genBreakAfter}
                    onChange={(e) => setGenBreakAfter(Number(e.target.value))}
                    className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm text-sm"
                  >
                    {[...Array(genTotalPeriods - 1).keys()].map(x => (
                      <option key={x + 1} value={x + 1}>คาบที่ {x + 1}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="genBreakDuration" className="block text-xs font-medium text-slate-600 mb-1">
                    ระยะเวลาพัก (นาที)
                  </label>
                  <input
                    type="number"
                    id="genBreakDuration"
                    min="5"
                    max="180"
                    value={genBreakDuration}
                    onChange={(e) => setGenBreakDuration(Number(e.target.value))}
                    className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm text-sm"
                  />
                </div>
              </div>
            )}
          </fieldset>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
            <strong>⚠️ คำเตือน:</strong> การกดยืนยันจะเขียนทับและบันทึกรายการคาบเรียนใหม่ทั้งหมด โดยแทนที่ชุดตารางคาบเรียนแบบเดิมที่มีอยู่ขณะนี้
          </div>

          <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10">
            <button
              type="button"
              onClick={() => setIsGenerateModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-md shadow-sm transition-colors flex items-center"
            >
              <Icons.Sparkles size={16} className="mr-1.5" /> ยืนยันและสร้าง
            </button>
          </div>
        </form>
      </Modal>
      
      <ConfirmationModal
        isOpen={isConfirmDeleteModalOpen}
        onClose={() => setIsConfirmDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title={`ยืนยันการลบคาบเรียน '${periodToDeleteName}'`}
        message={
          `คำเตือน: การลบคาบเรียน '${periodToDeleteName}' จะส่งผลกระทบต่อตารางสอนปัจจุบัน:\n\n` +
          `1. รายการสอนทั้งหมดที่อยู่ในคาบนี้จะถูกลบออก\n` +
          `2. คาบเรียนอื่นๆ ที่อยู่หลังจากคาบนี้จะถูกเลื่อนลำดับขึ้นมา\n\n` +
          `คุณแน่ใจหรือไม่ว่าต้องการลบคาบเรียนนี้?`
        }
        confirmButtonText="ลบคาบเรียน"
        icon={Icons.Warning}
      />
    </div>
  );
};

export default PeriodSettingsManagementScreen;