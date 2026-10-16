import React, { useMemo, useState } from 'react';
import { AppData } from '../types';
import {
  BuildingGrid, gridFromStored, gridToStored, parseGridText, buildingPositions, locationCoverage,
  suggestRoomLocations, squareGrid,
} from '../utils/buildings';

interface Props {
  appData: AppData;
  setAppData?: React.Dispatch<React.SetStateAction<AppData | null>>;
}

const EMPTY: BuildingGrid = [['', '', ''], ['', '', ''], ['', '', '']];

export const CampusMapScreen: React.FC<Props> = ({ appData, setAppData }) => {
  const isAdmin = appData.currentUser?.role === 'admin';
  const saved = useMemo(() => gridFromStored((appData.organizationSettings as any)?.buildingGrid), [appData.organizationSettings]);
  const [grid, setGrid] = useState<BuildingGrid>(() => (saved.length ? saved : EMPTY));
  const [pasteText, setPasteText] = useState('');
  const [msg, setMsg] = useState('');

  const rooms = (appData.physicalRooms || []) as any[];
  const { duplicates } = useMemo(() => buildingPositions(grid), [grid]);
  const coverage = useMemo(() => locationCoverage(rooms, grid), [rooms, grid]);
  const suggestions = useMemo(() => suggestRoomLocations(rooms), [rooms]);
  const dirty = JSON.stringify(gridToStored(squareGrid(grid))) !== JSON.stringify(gridToStored(saved));
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);

  const setCell = (r: number, c: number, v: string) =>
    setGrid((g) => g.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const addRow = () => setGrid((g) => [...g, Array(Math.max(width, 1)).fill('')]);
  const addCol = () => setGrid((g) => (g.length ? g : [[]]).map((row) => [...row, '']));
  const delRow = () => setGrid((g) => (g.length > 1 ? g.slice(0, -1) : g));
  const delCol = () => setGrid((g) => (width > 1 ? g.map((row) => row.slice(0, -1)) : g));

  const save = () => {
    if (!isAdmin || !setAppData) return;
    const cleaned = squareGrid(grid);
    setAppData((prev) => prev ? ({ ...prev, organizationSettings: { ...(prev.organizationSettings as any), buildingGrid: gridToStored(cleaned) } }) : prev);
    setGrid(cleaned.length ? cleaned : EMPTY);
    setMsg('บันทึกผังอาคารแล้ว');
  };

  const importPaste = () => {
    const g = parseGridText(pasteText);
    if (!g.length) { setMsg('ไม่พบข้อมูลในข้อความที่วาง'); return; }
    setGrid(g); setPasteText(''); setMsg('นำเข้าแล้ว — ตรวจดูตารางแล้วกด "บันทึก"');
  };

  const autoFill = () => {
    if (!isAdmin || !setAppData || !suggestions.length) return;
    const map = new Map(suggestions.map((s) => [s.id, s]));
    setAppData((prev) => prev ? ({
      ...prev,
      physicalRooms: (prev.physicalRooms || []).map((r: any) => {
        const s = map.get(r.id);
        return s ? { ...r, building: s.building, floor: s.floor } : r;
      }),
    }) : prev);
    setMsg(`เติมอาคาร/ชั้นให้ ${suggestions.length} ห้องแล้ว`);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-slate-800">ผังอาคาร</h2>
        <p className="text-sm text-slate-500 mt-1">
          พิมพ์เลขอาคารลงตารางตามตำแหน่งจริงบนผังโรงเรียน (ช่องว่าง = ไม่มีอาคาร) สนามกีฬาใส่เป็น F (หรือแยก F1, F2, …) และลานกิจกรรมเป็น P ได้ โดยวางได้หลายช่องเพราะใหญ่กว่าอาคาร ใช้คำนวณระยะเดินระหว่างอาคารในการตรวจตาราง
          รหัสห้อง 3 หลักถอดได้ เช่น 931 = อาคาร 9 ชั้น 3 ห้อง 1 F001 = สนามในโซน F, P900 = ลานหน้าอาคาร 9 (โซน P) ส่วนรหัส 4 หลักหรือตัวอักษรอื่นต้องกรอกอาคารและชั้นเองที่หน้า Physical Rooms
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="overflow-x-auto">
          <table className="border-collapse">
            <tbody>
              {grid.map((row, r) => (
                <tr key={r}>
                  {Array.from({ length: width }).map((_, c) => {
                    const v = row[c] ?? '';
                    const isDup = v !== '' && duplicates.includes(v);
                    return (
                      <td key={c} className="p-1">
                        <input
                          value={v}
                          disabled={!isAdmin}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          className={`w-16 h-12 text-center text-lg font-semibold border rounded-lg ${isDup ? 'border-red-400 bg-red-50' : v ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`}
                          aria-label={`แถว ${r + 1} คอลัมน์ ${c + 1}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2 text-sm">
            <button onClick={addRow} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50">+ แถว</button>
            <button onClick={delRow} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50">− แถว</button>
            <button onClick={addCol} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50">+ คอลัมน์</button>
            <button onClick={delCol} className="px-3 py-1.5 border rounded-lg hover:bg-slate-50">− คอลัมน์</button>
            <button onClick={save} disabled={!dirty || duplicates.length > 0} className="ml-auto px-4 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40">
              บันทึก{dirty ? ' *' : ''}
            </button>
          </div>
        )}
        {duplicates.length > 0 && <p className="text-sm text-red-600">อาคารซ้ำในผัง: {duplicates.join(', ')} (อาคารเลขวางได้ช่องเดียว)</p>}
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      </div>

      {isAdmin && (
        <details className="bg-white border border-slate-200 rounded-xl p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">วางจาก Excel / Google Sheets หรือพิมพ์แบบ CSV</summary>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder={'8,4,\n7,3,\n6,2,5\n,1,\n,9,'}
            className="mt-3 w-full border rounded-lg p-2 font-mono text-sm"
          />
          <button onClick={importPaste} className="mt-2 px-3 py-1.5 border rounded-lg text-sm hover:bg-slate-50">นำเข้าลงตาราง</button>
        </details>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-sm">
        <h3 className="font-semibold text-slate-800">ความพร้อมของข้อมูลห้อง</h3>
        <p>ห้องที่ระบุอาคารได้: <b>{coverage.withBuilding}</b> / {coverage.total}</p>
        {isAdmin && suggestions.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-slate-600">{suggestions.length} ห้องยังไม่ได้กรอกอาคาร แต่ถอดจากรหัส 3 หลักได้</span>
            <button onClick={autoFill} className="px-3 py-1.5 rounded-lg bg-slate-800 text-white">เติมอาคาร/ชั้นจากรหัสห้องอัตโนมัติ</button>
          </div>
        )}
        {coverage.buildingsNotOnGrid.length > 0 && (
          <p className="text-amber-700">อาคารที่มีห้องใช้อยู่ แต่ยังไม่อยู่ในผัง: {coverage.buildingsNotOnGrid.join(', ')}</p>
        )}
        {coverage.unresolved.length > 0 && (
          <div>
            <p className="text-amber-700">ต้องกรอกอาคาร/ชั้นเอง ({coverage.unresolved.length} ห้อง — รหัสไม่ใช่เลข 3 หลัก):</p>
            <p className="text-slate-600 mt-1 break-words">{coverage.unresolved.map((u) => u.code || u.name).join(', ')}</p>
          </div>
        )}
        {coverage.unresolved.length === 0 && coverage.buildingsNotOnGrid.length === 0 && coverage.total > 0 && (
          <p className="text-emerald-700">ข้อมูลอาคารครบ พร้อมใช้ตรวจระยะเดิน</p>
        )}
      </div>
    </div>
  );
};
