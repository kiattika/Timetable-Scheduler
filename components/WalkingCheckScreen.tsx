import React, { useMemo, useState } from 'react';
import { AppData } from '../types';
import { analyzeWalking, DEFAULT_WALK_OPTIONS, WalkOptions, Severity, DayResult } from '../utils/walkingCheck';
import { gridFromStored } from '../utils/buildings';
import { thaiGradeName } from '../utils/subjectCode';

const DAY_TH: Record<string, string> = {
  Monday: 'จันทร์', Tuesday: 'อังคาร', Wednesday: 'พุธ', Thursday: 'พฤหัสบดี', Friday: 'ศุกร์', Saturday: 'เสาร์', Sunday: 'อาทิตย์',
};
const SEV_TH: Record<Severity, string> = { ok: 'ปกติ', watch: 'ควรดู', risk: 'เสี่ยง' };
const SEV_CLASS: Record<Severity, string> = {
  ok: 'bg-slate-100 text-slate-600', watch: 'bg-amber-100 text-amber-800', risk: 'bg-red-100 text-red-700',
};
const OPT_KEY = 'tt.walkOptions';

const loadOptions = (): WalkOptions => {
  try {
    const raw = localStorage.getItem(OPT_KEY);
    if (raw) return { ...DEFAULT_WALK_OPTIONS, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_WALK_OPTIONS };
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

interface Props { appData: AppData; onOpenCampusMap?: () => void }

export const WalkingCheckScreen: React.FC<Props> = ({ appData, onOpenCampusMap }) => {
  const isAssistant = appData.currentUser?.role === 'assistant';
  const [tab, setTab] = useState<'teachers' | 'classes'>('teachers');
  const [group, setGroup] = useState('');
  const [minSev, setMinSev] = useState<Severity>('watch');
  const [options, setOptions] = useState<WalkOptions>(loadOptions);
  const [showOpts, setShowOpts] = useState(false);

  const role = appData.currentUser?.role;
  const assigned = appData.currentUser?.assignedDepartments || [];
  const grid = useMemo(() => gridFromStored((appData.organizationSettings as any)?.buildingGrid), [appData.organizationSettings]);

  const report = useMemo(() => grid.length === 0 ? null : analyzeWalking({
    entries: appData.scheduleEntries || [],
    rooms: (appData.physicalRooms || []) as any,
    teachers: appData.teachers || [],
    gradeLevels: appData.gradeLevels || [],
    subjects: appData.subjects || [],
    periods: appData.periodSettings || [],
    grid,
    options,
  }), [appData.scheduleEntries, appData.physicalRooms, appData.teachers, appData.gradeLevels, appData.subjects, appData.periodSettings, grid, options]);

  const setOpt = (k: keyof WalkOptions, v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return;
    const next = { ...options, [k]: n };
    setOptions(next);
    try { localStorage.setItem(OPT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const resetOpts = () => {
    setOptions({ ...DEFAULT_WALK_OPTIONS });
    try { localStorage.removeItem(OPT_KEY); } catch { /* ignore */ }
  };

  if (!report) {
    return (
      <div className="p-6 max-w-2xl space-y-3">
        <h2 className="text-xl font-bold text-slate-800">ตรวจการเดินระหว่างคาบ</h2>
        <p className="text-slate-600">ยังไม่มีผังอาคาร กรุณากรอกผังอาคารและอาคาร/ชั้นของห้องก่อน จึงจะตรวจระยะเดินได้</p>
        {onOpenCampusMap && <button onClick={onOpenCampusMap} className="px-4 py-2 rounded-lg bg-blue-600 text-white">ไปหน้าผังอาคาร</button>}
      </div>
    );
  }

  const isTeacherTab = tab === 'teachers' || isAssistant;
  let rows: (DayResult & { name: string; group: string })[] = isTeacherTab ? report.teacherDays : report.classDays;
  if (isTeacherTab && role === 'assistant') rows = rows.filter((r) => assigned.includes(r.group)); // department heads see their own department
  const groups = [...new Set(rows.map((r) => r.group))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  const rank = { ok: 0, watch: 1, risk: 2 } as const;
  const shown = rows.filter((r) => rank[r.severity] >= rank[minSev] && (!group || r.group === group));
  const counts = { risk: rows.filter((r) => r.severity === 'risk').length, watch: rows.filter((r) => r.severity === 'watch').length };
  const displayName = (n: string) => (isTeacherTab ? n : thaiGradeName(n));
  const groupLabel = (g: string) => (isTeacherTab ? g : thaiGradeName(g));

  const printReport = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const title = `${isTeacherTab ? 'ครู' : 'ห้องเรียน'} — ตรวจการเดินระหว่างคาบ${group ? ` (${groupLabel(group)})` : ''}`;
    const body = shown.map((r) => `<tr><td>${esc(displayName(r.name))}</td><td>${esc(groupLabel(r.group))}</td><td>${DAY_TH[r.day] || r.day}</td>
      <td>${SEV_TH[r.severity]}</td><td>${r.segments.map((seg) => seg.map((s) => `${s.pl ?? `P${s.period}`} ${esc(s.label)}`).join(' → ')).join(' ┃พักกลางวัน┃ ')}</td><td>${r.reasons.map(esc).join('<br>')}</td></tr>`).join('');
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font-family:sans-serif;font-size:12px;padding:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;vertical-align:top}th{background:#eee}</style>
      <h3>${esc(title)}</h3><p>รายการที่ระดับ "${SEV_TH[minSev]}" ขึ้นไป: ${shown.length} รายการ · พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</p>
      <table><thead><tr><th>${isTeacherTab ? 'ครู' : 'ห้อง'}</th><th>${isTeacherTab ? 'กลุ่มสาระฯ' : 'ระดับ'}</th><th>วัน</th><th>ระดับ</th><th>ลำดับสถานที่</th><th>เหตุผล</th></tr></thead><tbody>${body}</tbody></table>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h2 className="text-xl font-bold text-slate-800">ตรวจการเดินระหว่างคาบ</h2>
        <p className="text-sm text-slate-500 mt-1">
          ตรวจจากผังอาคารและตารางที่จัดไว้ เป็นการเตือนเพื่อประกอบการพิจารณาเท่านั้น ไม่ได้ห้ามจัด ระยะนับเป็น "ช่องในผัง" รวมค่าบันไดตามชั้น
          ชื่อคาบตรงกับหัวตาราง (P0, P1 ...) · ใช้เฉพาะคาบที่ติดกัน (คาบว่างคั่นถือว่ามีเวลาเดิน) และแยกช่วงก่อน/หลังพักกลางวันออกจากกัน · คาบที่ไม่ระบุห้องถือว่าอยู่ห้องประจำชั้น
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {(isAssistant ? ['teachers'] as const : ['teachers', 'classes'] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setGroup(''); }}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}>
            {t === 'teachers' ? 'ครู (หัวหน้ากลุ่มสาระฯ)' : 'ห้องเรียน/นักเรียน (หัวหน้าระดับ)'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select value={group} onChange={(e) => setGroup(e.target.value)} className="border rounded-lg px-2 py-1.5">
          <option value="">{isTeacherTab ? 'ทุกกลุ่มสาระฯ' : 'ทุกระดับ'}</option>
          {groups.map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}
        </select>
        <select value={minSev} onChange={(e) => setMinSev(e.target.value as Severity)} className="border rounded-lg px-2 py-1.5">
          <option value="risk">เฉพาะ เสี่ยง</option>
          <option value="watch">ควรดู ขึ้นไป</option>
          <option value="ok">ทั้งหมด</option>
        </select>
        <span className="text-slate-500">เสี่ยง {counts.risk} · ควรดู {counts.watch} · แสดง {shown.length}</span>
        <button onClick={() => setShowOpts((v) => !v)} className="ml-auto px-3 py-1.5 border rounded-lg hover:bg-slate-50">เกณฑ์</button>
        <button onClick={printReport} disabled={!shown.length} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50 disabled:opacity-40">พิมพ์รายงาน</button>
      </div>

      {showOpts && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {([
            ['floorWeight', 'ค่าบันไดต่อชั้น'], ['watch', 'ควรดู (ระยะ ≥)'], ['risk', 'เสี่ยง (ระยะ ≥)'],
            ['switchWatch', 'ย้ายอาคาร/วัน ควรดู'], ['switchRisk', 'ย้ายอาคาร/วัน เสี่ยง'],
          ] as [keyof WalkOptions, string][]).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-slate-600">{label}</span>
              <input type="number" step="0.5" min="0" value={options[k]} onChange={(e) => setOpt(k, e.target.value)} className="border rounded-lg px-2 py-1" />
            </label>
          ))}
          <button onClick={resetOpts} className="col-span-2 md:col-span-5 text-left text-blue-600 hover:underline">คืนค่าเริ่มต้น (บันทึกในเครื่องนี้เท่านั้น)</button>
        </div>
      )}

      {(report.stats.noLocation > 0 || report.stats.notOnGrid > 0 || report.stats.splitSkipped > 0) && (
        <p className="text-xs text-slate-500">
          ข้าม: คาบที่ไม่มีอาคาร {report.stats.noLocation} · อาคารที่ไม่อยู่ในผัง {report.stats.notOnGrid} · คาบที่แบ่งกลุ่มไปคนละที่ {report.stats.splitSkipped}
          (จากทั้งหมด {report.stats.entries} คาบ)
        </p>
      )}

      <div className="space-y-2">
        {shown.length === 0 && <p className="p-6 text-center text-slate-500">ไม่พบรายการตามเงื่อนไขที่เลือก</p>}
        {shown.slice(0, 300).map((r, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-800">{displayName(r.name)}</span>
              <span className="text-xs text-slate-500">{groupLabel(r.group)}</span>
              <span className="text-slate-600">วัน{DAY_TH[r.day] || r.day}</span>
              <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-semibold ${SEV_CLASS[r.severity]}`}>{SEV_TH[r.severity]}</span>
            </div>
            <div className="mt-1 text-slate-600 break-words">
              {r.segments.map((seg, k) => (
                <React.Fragment key={k}>
                  {k > 0 && <span className="mx-2 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-xs">พักกลางวัน</span>}
                  {seg.map((s) => `${s.pl ?? `P${s.period}`} ${s.label}`).join(' → ')}
                </React.Fragment>
              ))}
            </div>
            {r.reasons.length > 0 && <ul className="mt-1 text-xs text-slate-500 list-disc pl-5">{r.reasons.map((x, j) => <li key={j}>{x}</li>)}</ul>}
          </div>
        ))}
        {shown.length > 300 && <p className="text-xs text-slate-500">แสดง 300 รายการแรกจาก {shown.length} กรุณาเลือกกรองตามกลุ่ม</p>}
      </div>
    </div>
  );
};

/** Count of risky teacher/class days for the badge on the schedule page (same rules as the screen). */
export const countWalkingRisks = (appData: AppData): number | null => {
  const grid = gridFromStored((appData.organizationSettings as any)?.buildingGrid);
  if (grid.length === 0) return null;
  let options = DEFAULT_WALK_OPTIONS;
  try { const raw = localStorage.getItem(OPT_KEY); if (raw) options = { ...DEFAULT_WALK_OPTIONS, ...JSON.parse(raw) }; } catch { /* ignore */ }
  const r = analyzeWalking({
    entries: appData.scheduleEntries || [], rooms: (appData.physicalRooms || []) as any, teachers: appData.teachers || [],
    gradeLevels: appData.gradeLevels || [], subjects: appData.subjects || [], periods: appData.periodSettings || [], grid, options,
  });
  const role = appData.currentUser?.role;
  const assigned = appData.currentUser?.assignedDepartments || [];
  // assistants: only their own departments' teachers; managers and above: the whole school
  if (role === 'assistant') return r.teacherDays.filter((x) => assigned.includes(x.group) && x.severity === 'risk').length;
  return r.teacherDays.filter((x) => x.severity === 'risk').length + r.classDays.filter((x) => x.severity === 'risk').length;
};
