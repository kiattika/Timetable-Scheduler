
import React, { useState } from 'react';
import { PeriodSetting, ScreenAccessProps } from '../types';
import Modal from './Modal';
import ConfirmationModal from './ConfirmationModal';
import { Icons } from '../constants';

interface PeriodSettingsManagementScreenProps extends ScreenAccessProps {
  periodSettings: PeriodSetting[];
  setPeriodSettings: React.Dispatch<React.SetStateAction<PeriodSetting[]>>;
  deletePeriodSetting: (periodId: string) => void;
}

const PeriodSettingsManagementScreen: React.FC<PeriodSettingsManagementScreenProps> = ({
  periodSettings,
  setPeriodSettings,
  deletePeriodSetting,
  permissions,
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


    if (editingId) {
      setPeriodSettings(prev =>
        prev.map(p => (p.id === editingId ? { ...p, ...currentPeriod, id: editingId } as PeriodSetting : p))
      );
    } else {
      const newPeriod: PeriodSetting = {
        id: crypto.randomUUID(),
        label: currentPeriod.label!,
        startTime: currentPeriod.startTime!,
        endTime: currentPeriod.endTime!,
      };
      setPeriodSettings(prev => [...prev, newPeriod]);
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
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {periodSettings.map(period => (
                <tr key={period.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{period.label}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{period.startTime}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">{period.endTime}</td>
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