import React, { useMemo, useState } from 'react';
import { AppData, WalkAck } from '../types';
import { analyzeWalking, DEFAULT_WALK_OPTIONS, WalkOptions, Severity, DayResult, AckInfo, effectiveSeverity } from '../utils/walkingCheck';
import { gridFromStored } from '../utils/buildings';
import { thaiGradeName } from '../utils/subjectCode';

const DAY_TH: Record<string, string> = {
  Monday: 'จันทร์', Tuesday: 'อังคาร', Wednesday: 'พุธ', Thursday: 'พฤหัสบดี', Friday: 'ศุกร์', Saturday: 'เสาร์', Sunday: 'อาทิตย์',
};
const SEV_TH: Record<Severity, string> = { ok: 'ปกติ', watch: 'ควรดู', risk: 'เสี่ยง' };
// Colour AND word, so a black-and-white printout or colour-blind reader still tells them apart.
const BADGE_CLASS: Record<Severity, string> = {
  ok: 'bg-emerald-100 text-emerald-800 border-emerald-300', watch: 'bg-amber-100 text-amber-900 border-amber-400', risk: 'bg-red-600 text-white border-red-700',
};
const EDGE_CLASS: Record<Severity, string> = { ok: 'border-l-emerald-500', watch: 'border-l-amber-400', risk: 'border-l-red-600' };
const DOT: Record<Severity, string> = { ok: '🟢', watch: '🟡', risk: '🔴' };
const OPT_KEY = 'tt.walkOptions';

const loadOptions = (): WalkOptions => {
  try {
    const raw = localStorage.getItem(OPT_KEY);
    if (raw) return { ...DEFAULT_WALK_OPTIONS, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_WALK_OPTIONS };
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

interface Props {
  appData: AppData;
  setAppData?: React.Dispatch<React.SetStateAction<AppData | null>>;
  onOpenCampusMap?: () => void;
}

export const WalkingCheckScreen: React.FC<Props> = ({ appData, setAppData, onOpenCampusMap }) => {
  const isAssistant = appData.currentUser?.role === 'assistant';
  const [tab, setTab] = useState<'teachers' | 'classes'>('teachers');
  const [group, setGroup] = useState('');
  const [filter, setFilter] = useState<'risk' | 'watch' | 'accepted' | 'all'>('watch');
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
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
  type Row = DayResult & AckInfo & { name: string; group: string; teacherId?: string; gradeLevelId?: string };
  let rows: Row[] = isTeacherTab ? report.teacherDays : report.classDays;
  if (isTeacherTab && role === 'assistant') rows = rows.filter((r) => assigned.includes(r.group)); // department heads see their own department
  const groups = [...new Set(rows.map((r) => r.group))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  const rank = { ok: 0, watch: 1, risk: 2 } as const;
  const matchesFilter = (r: Row) =>
    filter === 'accepted' ? r.accepted : filter === 'all' ? true : rank[effectiveSeverity(r)] >= rank[filter];
  const shown = rows.filter((r) => matchesFilter(r) && (!group || r.group === group));
  const counts = {
    risk: rows.filter((r) => effectiveSeverity(r) === 'risk').length,
    watch: rows.filter((r) => effectiveSeverity(r) === 'watch').length,
    accepted: rows.filter((r) => r.accepted).length,
  };
  const FILTER_TH = { risk: 'เฉพาะเสี่ยง', watch: 'ควรดูขึ้นไป', accepted: 'ที่รับแล้ว', all: 'ทั้งหมด' } as const;
  const canAccept = !!setAppData && (role === 'admin' || role === 'manager' || role === 'assistant');
  const whoAmI = appData.currentUser?.name || appData.currentUser?.email || 'ไม่ทราบชื่อ';

  /** Record (or withdraw) an acceptance on the teacher / class itself. Stale acceptances of that entity are dropped on the way. */
  const writeAck = (r: Row, ack: WalkAck | null) => {
    if (!setAppData) return;
    const liveKeys = new Set((isTeacherTab ? report.teacherDays : report.classDays)
      .filter((x) => (isTeacherTab ? x.teacherId === r.teacherId : x.gradeLevelId === r.gradeLevelId)).map((x) => x.key));
    const next = (old?: WalkAck[]) => {
      const kept = (old || []).filter((a) => liveKeys.has(a.key) && a.key !== r.key);
      return ack ? [...kept, ack] : kept;
    };
    setAppData((prev) => {
      if (!prev) return prev;
      return isTeacherTab
        ? { ...prev, teachers: prev.teachers.map((t) => (t.id === r.teacherId ? { ...t, walkAcks: next(t.walkAcks) } : t)) }
        : { ...prev, gradeLevels: prev.gradeLevels.map((g) => (g.id === r.gradeLevelId ? { ...g, walkAcks: next(g.walkAcks) } : g)) };
    });
  };
  const needsNote = (r: Row) => r.severity === 'risk';
  const confirmAccept = (r: Row) => {
    const note = noteDraft.trim();
    if (needsNote(r) && !note) return;
    writeAck(r, { key: r.key, level: r.severity === 'risk' ? 'risk' : 'watch', by: whoAmI, at: new Date().toISOString(), ...(note ? { note } : {}) });
    setAcceptingKey(null); setNoteDraft('');
  };
  const statusText = (r: Row) => (r.accepted ? `รับได้ (เดิม: ${SEV_TH[r.severity]})` : SEV_TH[r.severity]);
  const displayName = (n: string) => (isTeacherTab ? n : thaiGradeName(n));
  const groupLabel = (g: string) => (isTeacherTab ? g : thaiGradeName(g));

  const printReport = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const title = `${isTeacherTab ? 'ครู' : 'ห้องเรียน'} — ตรวจการเดินระหว่างคาบ${group ? ` (${groupLabel(group)})` : ''}`;
    const body = shown.map((r) => `<tr><td>${esc(displayName(r.name))}</td><td>${esc(groupLabel(r.group))}</td><td>${DAY_TH[r.day] || r.day}</td>
      <td>${DOT[effectiveSeverity(r)]} ${esc(statusText(r))}</td><td>${r.segments.map((seg) => seg.map((s) => `${s.pl ?? `คาบ${s.period}`} ${esc(s.label)}`).join(' → ')).join(' ┃พักกลางวัน┃ ')}</td><td>${r.reasons.map(esc).join('<br>')}${r.ack ? `<br><b>ผู้สอนรับได้</b> โดย ${esc(r.ack.by)} (${new Date(r.ack.at).toLocaleDateString('th-TH')})${r.ack.note ? ` — ${esc(r.ack.note)}` : ''}` : ''}</td></tr>`).join('');
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font-family:sans-serif;font-size:12px;padding:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;vertical-align:top}th{background:#eee}</style>
      <h3>${esc(title)}</h3><p>แสดง: ${FILTER_TH[filter]} · ${shown.length} รายการ · พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</p>
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
          เลขคาบตรงกับหัวตาราง (P0 = คาบ0) · ใช้เฉพาะคาบที่ติดกัน (คาบว่างคั่นถือว่ามีเวลาเดิน) และแยกช่วงก่อน/หลังพักกลางวันออกจากกัน · คาบที่ไม่ระบุห้องถือว่าอยู่ห้องประจำชั้น
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
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="border rounded-lg px-2 py-1.5">
          {(Object.keys(FILTER_TH) as (keyof typeof FILTER_TH)[]).map((k) => <option key={k} value={k}>{FILTER_TH[k]}</option>)}
        </select>
        <span className="text-slate-500">
          <span className="font-semibold text-red-700">🔴 เสี่ยง {counts.risk}</span> · <span className="font-semibold text-amber-700">🟡 ควรดู {counts.watch}</span> · <span className="font-semibold text-emerald-700">🟢 รับแล้ว {counts.accepted}</span> · แสดง {shown.length}
        </span>
        <button onClick={() => setShowOpts((v) => !v)} className="ml-auto px-3 py-1.5 border rounded-lg hover:bg-slate-50">เกณฑ์</button>
        <button onClick={printReport} disabled={!shown.length} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50 disabled:opacity-40">พิมพ์รายงาน</button>
      </div>

      {showOpts && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {([
            ['floorWeight', 'ค่าบันไดต่อชั้น'], ['watch', 'ควรดู (ระยะ ≥)'], ['risk', 'เสี่ยง (ระยะ ≥)'],
            ['switchWatch', 'ย้ายอาคารคาบติดกัน ควรดู (ครั้ง/ช่วง)'], ['switchRisk', 'ย้ายอาคารคาบติดกัน เสี่ยง (ครั้ง/ช่วง)'],
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
        {shown.slice(0, 300).map((r) => {
          const eff = effectiveSeverity(r);
          return (
            <div key={r.key} className={`bg-white border border-slate-200 border-l-4 ${EDGE_CLASS[eff]} rounded-lg p-3 text-sm`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800">{displayName(r.name)}</span>
                <span className="text-xs text-slate-500">{groupLabel(r.group)}</span>
                <span className="text-slate-600">วัน{DAY_TH[r.day] || r.day}</span>
                <span className={`ml-auto px-2.5 py-0.5 rounded-full text-xs font-semibold border ${BADGE_CLASS[eff]}`}>
                  {DOT[eff]} {r.accepted ? `✓ รับได้ (เดิม: ${SEV_TH[r.severity]})` : SEV_TH[r.severity]}
                </span>
              </div>
              <div className="mt-1 text-slate-600 break-words">
                {r.segments.map((seg, k) => (
                  <React.Fragment key={k}>
                    {k > 0 && <span className="mx-2 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-xs">พักกลางวัน</span>}
                    {seg.map((s) => `${s.pl ?? `คาบ${s.period}`} ${s.label}`).join(' → ')}
                  </React.Fragment>
                ))}
              </div>
              {r.reasons.length > 0 && <ul className="mt-1 text-xs text-slate-500 list-disc pl-5">{r.reasons.map((x, j) => <li key={j}>{x}</li>)}</ul>}

              {r.accepted && r.ack && (
                <div className="mt-2 text-xs bg-emerald-50 border border-emerald-200 rounded-md p-2 text-emerald-900">
                  <b>ผู้สอนรับได้</b> · บันทึกโดย {r.ack.by} เมื่อ {new Date(r.ack.at).toLocaleString('th-TH')}
                  {r.ack.note && <div className="mt-0.5">เงื่อนไข: {r.ack.note}</div>}
                  <div className="mt-0.5 text-emerald-700">ถ้าตารางของวันนี้เปลี่ยน การรับรองนี้จะหมดอายุเอง</div>
                  {canAccept && <button onClick={() => writeAck(r, null)} className="mt-1 text-blue-700 hover:underline">ยกเลิกการรับ</button>}
                </div>
              )}

              {!r.accepted && r.severity !== 'ok' && canAccept && (
                acceptingKey === r.key ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      rows={2}
                      placeholder={needsNote(r) ? 'เงื่อนไข/เหตุผล (จำเป็นสำหรับรายการเสี่ยง)' : 'เงื่อนไข/เหตุผล (ไม่บังคับ)'}
                      className="w-full border rounded-lg p-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => confirmAccept(r)} disabled={needsNote(r) && !noteDraft.trim()}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40">ยืนยัน ผู้สอนรับได้</button>
                      <button onClick={() => { setAcceptingKey(null); setNoteDraft(''); }} className="px-3 py-1.5 border rounded-lg">ยกเลิก</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setAcceptingKey(r.key); setNoteDraft(''); }} className="mt-2 px-3 py-1 border border-emerald-500 text-emerald-700 rounded-lg hover:bg-emerald-50 text-xs">
                    ผู้สอนรับได้
                  </button>
                )
              )}
            </div>
          );
        })}
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
  if (role === 'assistant') return r.teacherDays.filter((x) => assigned.includes(x.group) && effectiveSeverity(x) === 'risk').length;
  return r.teacherDays.filter((x) => effectiveSeverity(x) === 'risk').length + r.classDays.filter((x) => effectiveSeverity(x) === 'risk').length;
};
