import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AppData } from '../types';
import { formatRoomDisplay } from '../utils/stringUtils';
import { thaiGradeName, SUBJECT_GROUP_LABELS, UNKNOWN_GROUP } from '../utils/subjectCode';
import {
  computeWorkload, lowerTotal, upperTotal, LoadMetrics, LoadSource,
} from '../utils/teacherWorkload';

interface InformationScreenProps {
  appData: AppData;
}

type Tab = 'homeroom' | 'workload';

const fmt = (n: number) => (n === 0 ? '–' : Number.isInteger(n) ? String(n) : n.toFixed(1));
const avg = (sum: number, count: number) => (count > 0 ? sum / count : 0);

const InformationScreen: React.FC<InformationScreenProps> = ({ appData }) => {
  const { teachers, subjects, gradeLevels, physicalRooms, scheduleEntries, teacherSubjectAssignments } = appData;
  const [tab, setTab] = useState<Tab>('homeroom');
  const hasEntries = (scheduleEntries || []).length > 0;
  const [source, setSource] = useState<LoadSource>(hasEntries ? 'schedule' : 'links');
  const [deptFilter, setDeptFilter] = useState('');
  const [showLegend, setShowLegend] = useState(false);

  /* ---------- Homeroom roster ---------- */
  const roster = useMemo(() => {
    const roomById = new Map((physicalRooms || []).map(r => [r.id, r]));
    const classRooms = (gradeLevels || []).filter(g => g.name.includes('/'));
    const byLevel = new Map<string, { id: string; name: string; room: string; advisors: { name: string; code?: string; dept?: string }[] }[]>();
    classRooms.forEach(g => {
      const parent = g.name.split('/')[0];
      const advisors = (teachers || [])
        .filter(t => (t.homeroomGradeLevelIds || []).includes(g.id))
        .sort((a, b) => (a.teacherCode || '').localeCompare(b.teacherCode || '', undefined, { numeric: true }))
        .map(t => ({ name: t.name, code: t.teacherCode, dept: t.department }));
      const room = g.homeroomPhysicalRoomId ? roomById.get(g.homeroomPhysicalRoomId) : undefined;
      if (!byLevel.has(parent)) byLevel.set(parent, []);
      byLevel.get(parent)!.push({ id: g.id, name: g.name, room: room ? formatRoomDisplay(room as any) : '', advisors });
    });
    const levels = [...byLevel.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([level, rooms]) => ({
        level,
        rooms: rooms.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      }));
    const withoutAdvisor = levels.reduce((n, l) => n + l.rooms.filter(r => r.advisors.length === 0).length, 0);
    const advisorIdsInRooms = new Set<string>();
    (teachers || []).forEach(t => { if ((t.homeroomGradeLevelIds || []).length) advisorIdsInRooms.add(t.id); });
    return { levels, withoutAdvisor, advisorCount: advisorIdsInRooms.size };
  }, [teachers, gradeLevels, physicalRooms]);

  /* ---------- Workload ---------- */
  const workload = useMemo(() => computeWorkload({
    teachers: teachers || [], subjects: subjects || [], gradeLevels: gradeLevels || [],
    scheduleEntries: scheduleEntries || [], assignments: teacherSubjectAssignments || [], source,
  }), [teachers, subjects, gradeLevels, scheduleEntries, teacherSubjectAssignments, source]);

  const departments = useMemo(() => workload.byDepartment.map(d => d.department), [workload]);
  const teacherRows = workload.perTeacher.filter(r => !deptFilter || (r.teacher.department || '(ไม่ระบุกลุ่มสาระฯ)') === deptFilter);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const head = ['ม.ต้น พื้นฐาน', 'ม.ต้น เพิ่มเติม', 'ม.ปลาย พื้นฐาน', 'ม.ปลาย เพิ่มเติม', 'กิจกรรม', 'อื่นๆ', 'รวม'];
    const mrow = (m: LoadMetrics) => [m.lowerBasic, m.lowerExtra, m.upperBasic, m.upperExtra, m.activity, m.other, m.total];
    const deptRows = [
      ['กลุ่มสาระฯ', 'จำนวนครู', ...head, 'เฉลี่ย ม.ต้น/คน', 'เฉลี่ย ม.ปลาย/คน', 'เฉลี่ยรวม/คน'],
      ...workload.byDepartment.map(d => [d.department, d.teacherCount, ...mrow(d.metrics),
        +avg(lowerTotal(d.metrics), d.teacherCount).toFixed(2), +avg(upperTotal(d.metrics), d.teacherCount).toFixed(2), +avg(d.metrics.total, d.teacherCount).toFixed(2)]),
      ['รวมทั้งหมด', workload.overall.teacherCount, ...mrow(workload.overall.metrics),
        +avg(lowerTotal(workload.overall.metrics), workload.overall.teacherCount).toFixed(2),
        +avg(upperTotal(workload.overall.metrics), workload.overall.teacherCount).toFixed(2),
        +avg(workload.overall.metrics.total, workload.overall.teacherCount).toFixed(2)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deptRows), 'รายกลุ่มสาระ');
    const tRows = [
      ['กลุ่มสาระฯ', 'รหัสครู', 'ชื่อ-สกุล', ...head],
      ...workload.perTeacher.map(r => [r.teacher.department || '', r.teacher.teacherCode || '', r.teacher.name, ...mrow(r.metrics)]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tRows), 'รายคน');
    const gRows: (string | number)[][] = [['อักษร', 'กลุ่มวิชา', 'กลุ่มย่อย', 'จำนวนวิชา', ...head]];
    workload.byGroup.forEach(g => {
      const gl = g.group === UNKNOWN_GROUP ? 'ไม่ระบุ' : (SUBJECT_GROUP_LABELS[g.group] || `กลุ่มอื่น (${g.group})`);
      gRows.push([g.group === UNKNOWN_GROUP ? '-' : g.group, gl, 'รวม', g.subjectCount, ...mrow(g.metrics)]);
      if (g.subGroups.length > 1) g.subGroups.forEach(sg => gRows.push(['', gl, sg.label, sg.subjectCount, ...mrow(sg.metrics)]));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gRows), 'ตามกลุ่มวิชา');
    const hRows: (string | number)[][] = [['ห้อง', 'ครูที่ปรึกษา', 'รหัสครู', 'ห้องประจำชั้น']];
    roster.levels.forEach(l => l.rooms.forEach(r => {
      if (r.advisors.length === 0) hRows.push([thaiGradeName(r.name), '(ยังไม่มีครูที่ปรึกษา)', '', r.room]);
      r.advisors.forEach(a => hRows.push([thaiGradeName(r.name), a.name, a.code || '', r.room]));
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hRows), 'ครูที่ปรึกษา');
    XLSX.writeFile(wb, 'สารสนเทศ_ครูและภาระงานสอน.xlsx');
  };

  const th = 'px-2 py-2 text-xs font-semibold text-slate-600 text-center border border-slate-200 bg-slate-50';
  const td = 'px-2 py-1.5 text-sm text-center border border-slate-200 tabular-nums';
  const tdl = 'px-2 py-1.5 text-sm text-left border border-slate-200';

  const MetricCells = ({ m, bold }: { m: LoadMetrics; bold?: boolean }) => (
    <>
      <td className={td}>{fmt(m.lowerBasic)}</td>
      <td className={td}>{fmt(m.lowerExtra)}</td>
      <td className={`${td} bg-sky-50/60`}>{fmt(lowerTotal(m))}</td>
      <td className={td}>{fmt(m.upperBasic)}</td>
      <td className={td}>{fmt(m.upperExtra)}</td>
      <td className={`${td} bg-violet-50/60`}>{fmt(upperTotal(m))}</td>
      <td className={td}>{fmt(m.activity)}</td>
      <td className={td}>{fmt(m.other)}</td>
      <td className={`${td} ${bold ? 'font-bold' : 'font-semibold'} bg-emerald-50/60`}>{fmt(m.total)}</td>
    </>
  );

  return (
    <div className="p-4 md:p-6 bg-white shadow-lg rounded-lg w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-semibold text-slate-800">สารสนเทศ</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-300 overflow-hidden text-sm">
            <button type="button" onClick={() => setTab('homeroom')}
              className={`px-4 py-2 ${tab === 'homeroom' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              ครูที่ปรึกษาตามห้องประจำชั้น
            </button>
            <button type="button" onClick={() => setTab('workload')}
              className={`px-4 py-2 border-l border-slate-300 ${tab === 'workload' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              สรุปภาระงานสอน
            </button>
          </div>
          <button type="button" onClick={exportExcel}
            className="px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm">
            Export Excel
          </button>
        </div>
      </div>

      {tab === 'homeroom' && (
        <div>
          <p className="text-sm text-slate-600 mb-3">
            บัญชีรายชื่อครูที่ปรึกษา เรียงตามห้องประจำชั้น — ครูที่ปรึกษา {roster.advisorCount} คน
            {roster.withoutAdvisor > 0 && <span className="ml-2 text-amber-700">· ห้องที่ยังไม่มีครูที่ปรึกษา {roster.withoutAdvisor} ห้อง</span>}
          </p>
          {roster.levels.length === 0 ? (
            <p className="text-slate-500 py-8 text-center">ยังไม่มีห้องเรียน — สร้างได้ที่ "กำหนดโครงสร้างระดับชั้นและห้องเรียน"</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 items-start">
              {roster.levels.map(l => (
                <div key={l.level} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-800">{thaiGradeName(l.level)}</div>
                  <ul className="divide-y divide-slate-100">
                    {l.rooms.map(r => (
                      <li key={r.id} className="px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-800">{thaiGradeName(r.name)}</span>
                          {r.room && <span className="text-[11px] text-slate-500 truncate" title="ห้องประจำชั้น">{r.room}</span>}
                        </div>
                        {r.advisors.length === 0 ? (
                          <div className="text-xs text-amber-600">ยังไม่มีครูที่ปรึกษา</div>
                        ) : r.advisors.map((a, i) => (
                          <div key={i} className="text-xs text-slate-700 leading-snug">
                            {a.name}{a.code ? <span className="text-slate-400"> ({a.code})</span> : null}
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'workload' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-slate-600">นับจาก</span>
              <select value={source} onChange={e => setSource(e.target.value as LoadSource)}
                className="p-2 border border-slate-300 rounded-md bg-white">
                <option value="schedule">ตารางสอนที่จัดแล้ว (คาบจริง)</option>
                <option value="links">ลิงก์ครู-วิชา (คาบตามหลักสูตร)</option>
              </select>
            </label>
            <button type="button" onClick={() => setShowLegend(v => !v)} className="text-blue-600 hover:underline">
              {showLegend ? 'ซ่อน' : 'ดู'}โครงสร้างรหัสวิชา
            </button>
            {source === 'schedule' && !hasEntries && <span className="text-amber-700">ยังไม่มีรายการในตารางสอน — ลองเลือก "ลิงก์ครู-วิชา"</span>}
          </div>

          {showLegend && (
            <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-4 text-sm text-slate-700 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="font-semibold mb-1">โครงสร้างรหัสวิชา เช่น ค33102</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>ตัวอักษร (ค) = กลุ่มสาระการเรียนรู้</li>
                  <li>หลักที่ 1 (3) = ระดับการศึกษา (1 ประถม, 2 ม.ต้น, 3 ม.ปลาย)</li>
                  <li>หลักที่ 2 (3) = ชั้นปีในระดับ (ม.ปลาย: 1=ม.4, 2=ม.5, 3=ม.6 / ม.ต้น: 1=ม.1, 2=ม.2, 3=ม.3)</li>
                  <li>หลักที่ 3 (1) = ประเภทรายวิชา (1 พื้นฐาน, 2 เพิ่มเติม, 9 กิจกรรม)</li>
                  <li>หลักที่ 4-5 (02) = ลำดับรายวิชา</li>
                  <li>ค33102 = คณิตศาสตร์ ม.6 พื้นฐาน วิชาที่ 2</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold mb-1">อักษรกลุ่มสาระฯ</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  {Object.entries(SUBJECT_GROUP_LABELS).map(([k, v]) => <div key={k}><b>{k}</b> {v}</div>)}
                </div>
                <p className="mt-2 text-xs text-slate-500">"กิจกรรม" รวมวิชาโฮมรูม/ลูกเสือ/ชุมนุม/PLC · "อื่นๆ" = วิชาที่รหัสไม่เป็นไปตามโครงสร้าง หรือระดับประถม</p>
              </div>
            </div>
          )}

          {/* 1) By department */}
          <section>
            <h3 className="font-semibold text-slate-800 mb-2">สรุปรายกลุ่มสาระการเรียนรู้ (จำนวนคาบ/สัปดาห์)</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr>
                    <th rowSpan={2} className={`${th} text-left`}>กลุ่มสาระฯ</th>
                    <th rowSpan={2} className={th}>ครู (คน)</th>
                    <th colSpan={3} className={`${th} bg-sky-50`}>ม.ต้น</th>
                    <th colSpan={3} className={`${th} bg-violet-50`}>ม.ปลาย</th>
                    <th rowSpan={2} className={th}>กิจกรรม</th>
                    <th rowSpan={2} className={th}>อื่นๆ</th>
                    <th rowSpan={2} className={`${th} bg-emerald-50`}>รวมคาบ</th>
                    <th colSpan={3} className={`${th} bg-amber-50`}>คาบเฉลี่ยต่อคน</th>
                  </tr>
                  <tr>
                    <th className={th}>พื้นฐาน</th><th className={th}>เพิ่มเติม</th><th className={`${th} bg-sky-50`}>รวม</th>
                    <th className={th}>พื้นฐาน</th><th className={th}>เพิ่มเติม</th><th className={`${th} bg-violet-50`}>รวม</th>
                    <th className={`${th} bg-amber-50`}>ม.ต้น</th><th className={`${th} bg-amber-50`}>ม.ปลาย</th><th className={`${th} bg-amber-50`}>รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {[...workload.byDepartment.map(d => ({ key: d.department, label: d.department, count: d.teacherCount, m: d.metrics, bold: false })),
                    { key: '__all', label: 'รวมทั้งหมด', count: workload.overall.teacherCount, m: workload.overall.metrics, bold: true }].map(row => (
                    <tr key={row.key} className={row.bold ? 'bg-slate-100 font-semibold' : 'hover:bg-slate-50'}>
                      <td className={tdl}>{row.label}</td>
                      <td className={td}>{row.count}</td>
                      <MetricCells m={row.m} bold={row.bold} />
                      <td className={`${td} bg-amber-50/60`}>{fmt(+avg(lowerTotal(row.m), row.count).toFixed(1))}</td>
                      <td className={`${td} bg-amber-50/60`}>{fmt(+avg(upperTotal(row.m), row.count).toFixed(1))}</td>
                      <td className={`${td} bg-amber-50/60 font-semibold`}>{fmt(+avg(row.m.total, row.count).toFixed(1))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-1">คาบเฉลี่ย = จำนวนคาบรวมของกลุ่ม ÷ จำนวนครูทั้งหมดในกลุ่ม · พื้นฐาน/เพิ่มเติมดูจากหลักที่ 3 ของรหัสวิชา</p>
          </section>

          {/* 2) By subject group letter */}
          <section>
            <h3 className="font-semibold text-slate-800 mb-2">สรุปตามกลุ่มวิชา (ตามอักษรรหัสวิชา)</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr>
                    <th rowSpan={2} className={th}>อักษร</th>
                    <th rowSpan={2} className={`${th} text-left`}>กลุ่มวิชา</th>
                    <th rowSpan={2} className={th}>จำนวนวิชา</th>
                    <th colSpan={3} className={`${th} bg-sky-50`}>ม.ต้น</th>
                    <th colSpan={3} className={`${th} bg-violet-50`}>ม.ปลาย</th>
                    <th rowSpan={2} className={th}>กิจกรรม</th>
                    <th rowSpan={2} className={th}>อื่นๆ</th>
                    <th rowSpan={2} className={`${th} bg-emerald-50`}>รวมคาบ</th>
                  </tr>
                  <tr><MetricHeadsSub th={th} /></tr>
                </thead>
                <tbody>
                  {workload.byGroup.map(g => (
                    <React.Fragment key={g.group}>
                      <tr className="bg-slate-50 font-semibold">
                        <td className={td}>{g.group === UNKNOWN_GROUP ? '-' : g.group}</td>
                        <td className={tdl}>{g.group === UNKNOWN_GROUP ? 'ไม่ระบุ/รหัสไม่ตามโครงสร้าง' : (SUBJECT_GROUP_LABELS[g.group] || `กลุ่มอื่น (${g.group})`)}</td>
                        <td className={td}>{g.subjectCount}</td>
                        <MetricCells m={g.metrics} />
                      </tr>
                      {g.subGroups.length > 1 && g.subGroups.map(sg => (
                        <tr key={g.group + sg.label} className="hover:bg-slate-50 text-slate-700">
                          <td className={td}></td>
                          <td className={`${tdl} pl-6`}>└ {sg.label}</td>
                          <td className={td}>{sg.subjectCount}</td>
                          <MetricCells m={sg.metrics} />
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-1">กลุ่มย่อย (เช่น ฟิสิกส์ เคมี ดนตรีไทย คหกรรม) จำแนกจากชื่อวิชา · คาบรวมของทุกครูที่สอน (วิชาที่สอนร่วมกันหลายคนนับตามจำนวนครู)</p>
          </section>

          {/* 3) Per teacher */}
          <section>
            <div className="flex items-center justify-between mb-2 gap-3">
              <h3 className="font-semibold text-slate-800">สรุปรายบุคคล</h3>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
                className="p-2 text-sm border border-slate-300 rounded-md bg-white">
                <option value="">ทุกกลุ่มสาระฯ</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="overflow-auto max-h-[60vh] border border-slate-200 rounded-md">
              <table className="min-w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th rowSpan={2} className={`${th} text-left`}>กลุ่มสาระฯ</th>
                    <th rowSpan={2} className={th}>รหัสครู</th>
                    <th rowSpan={2} className={`${th} text-left`}>ชื่อ-สกุล</th>
                    <th colSpan={3} className={`${th} bg-sky-50`}>ม.ต้น</th>
                    <th colSpan={3} className={`${th} bg-violet-50`}>ม.ปลาย</th>
                    <th rowSpan={2} className={th}>กิจกรรม</th>
                    <th rowSpan={2} className={th}>อื่นๆ</th>
                    <th rowSpan={2} className={`${th} bg-emerald-50`}>รวมคาบ</th>
                  </tr>
                  <tr><MetricHeadsSub th={th} /></tr>
                </thead>
                <tbody>
                  {teacherRows.map(({ teacher, metrics }) => (
                    <tr key={teacher.id} className="hover:bg-slate-50">
                      <td className={tdl}>{teacher.department || '-'}</td>
                      <td className={td}>{teacher.teacherCode || '-'}</td>
                      <td className={tdl}>{teacher.name}</td>
                      <MetricCells m={metrics} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const MetricHeadsSub: React.FC<{ th: string }> = ({ th }) => (
  <>
    <th className={th}>พื้นฐาน</th><th className={th}>เพิ่มเติม</th><th className={`${th} bg-sky-50`}>รวม</th>
    <th className={th}>พื้นฐาน</th><th className={th}>เพิ่มเติม</th><th className={`${th} bg-violet-50`}>รวม</th>
  </>
);

export default InformationScreen;
