import React from 'react';
import { X, Check, ArrowRight, AlertCircle, Sparkles, AlertTriangle } from 'lucide-react';
import { ScheduleEntry } from '../types';

export interface DetailRow {
  label: string;
  value: string;
}

export interface Discrepancy {
  id: string;
  entry: ScheduleEntry;
  type: 'homeroom_changed' | 'subject_updated' | 'room_changed';
  title: string;
  component: string;
  currentGridData: string;
  pendingUpdateData: string;
  status: 'green' | 'red';
  statusDescription: string;
  proposedChange: Partial<ScheduleEntry>;
  // Full before/after picture of the slot (subject, teachers, class, room, day/time). Rows whose value differs are highlighted.
  currentDetails?: DetailRow[];
  pendingDetails?: DetailRow[];
  // Plain-language result of each button, shown under the buttons.
  acceptHint?: string;
  rejectHint?: string;
  // Applied when the user rejects: keeps the entry as is but records that the change was seen,
  // so the same alert does not come back after a reload.
  acknowledgeChange?: Partial<ScheduleEntry>;
}

interface ReviewWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  discrepancies: Discrepancy[];
  onAccept: (discrepancy: Discrepancy) => void;
  onReject: (discrepancy: Discrepancy) => void;
  onAcceptAllNonConflicting: () => void;
}

const DetailList: React.FC<{ rows?: DetailRow[]; other?: DetailRow[]; tone: 'old' | 'new'; fallback: string }> = ({ rows, other, tone, fallback }) => {
  if (!rows || rows.length === 0) {
    return (
      <span className={tone === 'old'
        ? 'line-through text-slate-400 bg-slate-100/70 px-2 py-1 rounded'
        : 'bg-amber-50 text-amber-900 px-2 py-1 rounded border border-amber-100'}>
        {fallback}
      </span>
    );
  }
  const otherByLabel = new Map((other || []).map(r => [r.label, r.value]));
  return (
    <div className={tone === 'old'
      ? 'rounded-lg border border-slate-200 bg-slate-100/70 px-3 py-2 space-y-1'
      : 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1'}>
      {rows.map(r => {
        const changed = otherByLabel.has(r.label) && otherByLabel.get(r.label) !== r.value;
        return (
          <div key={r.label} className="flex gap-2 text-xs leading-snug">
            <span className="w-16 flex-shrink-0 text-slate-500">{r.label}</span>
            <span className={
              tone === 'old'
                ? (changed ? 'text-slate-500 line-through font-semibold' : 'text-slate-500')
                : (changed ? 'text-amber-900 font-bold' : 'text-slate-600 font-medium')
            }>
              {r.value}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const ReviewWizardModal: React.FC<ReviewWizardModalProps> = ({
  isOpen,
  onClose,
  discrepancies,
  onAccept,
  onReject,
  onAcceptAllNonConflicting,
}) => {
  if (!isOpen) return null;

  const nonConflictingCount = discrepancies.filter(d => d.status === 'green').length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" id="review-wizard-modal">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="relative w-full max-w-6xl rounded-xl bg-white shadow-2xl transition-all border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
          
          {/* Header */}
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-amber-50 rounded-lg text-amber-600 border border-amber-200">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  เครื่องมือปรับแต่งและทบทวนข้อมูลตารางสอน (Timetable Data Sync & Review Wizard)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ตรวจพบความไม่สอดคล้องระหว่างข้อมูลตารางสอนกับข้อมูลหลัก (Master Data) ทั้งหมด {discrepancies.length} รายการ
                </p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Description & Global Actions Bar */}
          <div className="px-6 py-4 bg-amber-50/50 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="text-sm text-slate-600 max-w-2xl leading-relaxed">
              <span className="font-semibold text-slate-800">คำชี้แจง:</span> การเปลี่ยนข้อมูลหลัก (ครูประจำชั้น, ข้อมูลวิชา, หรือห้องเรียน) อาจมีผลกระทบต่อคาบเรียนเดิมบนตาราง 
              
              <b className="text-emerald-700"> ยอมรับ</b> = เปลี่ยนคาบนั้นตามข้อมูลใหม่ (กรอบสีเหลือง) ·
              <b className="text-slate-700"> ไม่ยอมรับ</b> = คงข้อมูลเดิมบนตาราง (กรอบสีเทา) ไว้ตามเดิม
            </div>
            
            <button
              onClick={onAcceptAllNonConflicting}
              disabled={nonConflictingCount === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-all duration-200 whitespace-nowrap ${
                nonConflictingCount > 0
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white hover:shadow'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
              }`}
            >
              <Sparkles size={16} />
              ยอมรับรายการที่ไม่มีการชนทั้งหมด ({nonConflictingCount})
            </button>
          </div>

          {/* Table Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {discrepancies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <div className="p-3 bg-emerald-50 rounded-full text-emerald-500 border border-emerald-100 mb-3">
                  <Check size={28} />
                </div>
                <p className="font-semibold text-slate-800">ไม่พบความไม่สอดคล้องของข้อมูล!</p>
                <p className="text-sm text-slate-400 mt-1">ตารางสอนของคุณสอดคล้องกับข้อมูลหลัก (Master Data) ล่าสุดแล้ว</p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 font-semibold text-xs border-b border-slate-200 uppercase tracking-wider">
                      <th className="px-4 py-3 font-bold text-slate-800">ประเภทข้อมูลหลัก</th>
                      <th className="px-4 py-3 font-bold text-slate-800">คาบเรียนที่ได้รับผลกระทบ</th>
                      <th className="px-4 py-3 font-bold text-slate-800">ข้อมูลปัจจุบันบนตาราง (สีเทา)</th>
                      <th className="px-4 py-3 font-bold text-slate-800"></th>
                      <th className="px-4 py-3 font-bold text-slate-800">ข้อมูลใหม่ตาม Master Data (สีเหลือง)</th>
                      <th className="px-4 py-3 font-bold text-slate-800">สถานะการชน (Conflict)</th>
                      <th className="px-4 py-3 font-bold text-slate-800 text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {discrepancies.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                        {/* Type Tag */}
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                            d.type === 'homeroom_changed'
                              ? 'bg-purple-50 text-purple-700 border border-purple-100'
                              : d.type === 'room_changed'
                                ? 'bg-blue-50 text-blue-700 border border-blue-100'
                                : 'bg-amber-50 text-amber-700 border border-amber-100'
                          }`}>
                            {d.type === 'homeroom_changed' ? 'ครูประจำชั้นเปลี่ยน' : d.type === 'room_changed' ? 'ห้องเรียนเปลี่ยน' : 'ข้อมูลวิชาอัปเดต'}
                          </span>
                        </td>

                        {/* Affected Slot */}
                        <td className="px-4 py-4">
                          <div className="font-semibold text-slate-900">{d.component}</div>
                          <div className="text-xxs text-slate-400 font-mono mt-0.5">ID: {d.id.substring(0, 8)}...</div>
                        </td>

                        {/* Current Grid Data */}
                        <td className="px-4 py-4 text-slate-600 font-medium">
                          <DetailList rows={d.currentDetails} other={d.pendingDetails} tone="old" fallback={d.currentGridData} />
                        </td>

                        {/* Arrow indicator */}
                        <td className="px-1 py-4 text-slate-400">
                          <ArrowRight size={16} />
                        </td>

                        {/* Pending Update Data */}
                        <td className="px-4 py-4 text-slate-800 font-bold">
                          <DetailList rows={d.pendingDetails} other={d.currentDetails} tone="new" fallback={d.pendingUpdateData} />
                        </td>

                        {/* Conflict Status Badge */}
                        <td className="px-4 py-4">
                          {d.status === 'green' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100 text-xs">
                              <Check size={14} />
                              ไม่มีปัญหาการชน
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-bold bg-rose-50 px-2.5 py-1 rounded-md border border-rose-100 text-xs">
                              <AlertCircle size={14} className="flex-shrink-0" />
                              {d.statusDescription}
                            </span>
                          )}
                        </td>

                        {/* Action Buttons */}
                        <td className="px-4 py-4 text-right whitespace-nowrap">
                          <div className="inline-flex gap-2">
                            <button
                              onClick={() => onAccept(d)}
                              className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border shadow-sm transition-all duration-150 ${
                                d.status === 'green'
                                  ? 'bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-700 border-emerald-200'
                                  : 'bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-700 border-rose-200'
                              }`}
                            >
                              <Check size={14} />
                              ยอมรับ (Accept)
                            </button>
                            <button
                              onClick={() => onReject(d)}
                              className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 shadow-sm transition-all duration-150"
                            >
                              <X size={14} />
                              ไม่ยอมรับ (Reject)
                            </button>
                          </div>
                          {(d.acceptHint || d.rejectHint) && (
                            <div className="mt-2 max-w-[260px] ml-auto whitespace-normal text-left text-xs leading-snug space-y-1">
                              {d.acceptHint && (
                                <p className="text-emerald-700"><b>ยอมรับ:</b> {d.acceptHint}</p>
                              )}
                              {d.rejectHint && (
                                <p className="text-slate-500"><b>ไม่ยอมรับ:</b> {d.rejectHint}</p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end">
            <button
              onClick={onClose}
              className="bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold px-4 py-2 rounded-lg border border-slate-200 shadow-sm transition-all"
            >
              ปิดหน้าต่าง (Close)
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
