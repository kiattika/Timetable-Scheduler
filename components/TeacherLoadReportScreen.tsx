import { formatRoomDisplay } from "../utils/stringUtils";
import React, { useMemo } from 'react';
import { AppData, Subject, GradeLevel, ScheduleEntry, PhysicalRoom, DayOfWeek } from '../types';
import * as XLSX from 'xlsx';
import { Icons } from '../constants';

interface TeacherLoadReportScreenProps {
  appData: AppData;
  onClose?: () => void;
}

export const TeacherLoadReportScreen: React.FC<TeacherLoadReportScreenProps> = ({ appData, onClose }) => {
  const { teachers, subjects, gradeLevels, scheduleEntries, physicalRooms } = appData;
  const [reportError, setReportError] = React.useState<string | null>(null);

  const reportData = useMemo(() => {
    try {
      setReportError(null);
      // 1. Group schedule entries by teacher
      const teacherSchedules: Record<string, ScheduleEntry[]> = {};
      (scheduleEntries || []).forEach(entry => {
        (entry.teacherIds || []).forEach(tid => {
          if (!teacherSchedules[tid]) teacherSchedules[tid] = [];
          teacherSchedules[tid].push(entry);
        });
      });

      const isActivitySubject = (subject?: Subject) => {
        if (!subject || !subject.name) return false;
        if (subject.isHomeroomAdvisorySubject) return true;
        const lowerName = subject.name.toLowerCase();
        const keywords = ['กิจกรรม', 'ลูกเสือ', 'เนตรนารี', 'ยุวกาชาด', 'แนะแนว', 'ชุมนุม', 'สาธารณประโยชน์', 'บำเพ็ญประโยชน์', 'โฮมรูม', 'homeroom', 'plc', 'ป้องกันการทุจริต', 'ทุจริต', 'จริยธรรม'];
        return keywords.some(kw => lowerName.includes(kw));
      };

      const sortedTeachers = [...(teachers || [])].sort((a, b) => {
        const deptA = a.department || '';
        const deptB = b.department || '';
        const deptCompare = deptA.localeCompare(deptB, 'th', { sensitivity: 'base' });
        if (deptCompare !== 0) return deptCompare;
        
        const nameA = a.name || '';
        const nameB = b.name || '';
        return nameA.localeCompare(nameB, 'th', { sensitivity: 'base' });
      });

      return sortedTeachers.map((teacher, index) => {
        const entries = teacherSchedules[teacher.id] || [];
        
        // Group by subject and physicalRoom
        const loadGroups: Record<string, { subject: Subject | undefined, physicalRoom: PhysicalRoom | undefined, gradeLevel: GradeLevel | undefined, periods: number, slots: {day: DayOfWeek, period: number}[] }> = {};
        
        entries.forEach(entry => {
          const key = `${entry.subjectId}-${entry.physicalRoomId}`;
          if (!loadGroups[key]) {
            loadGroups[key] = {
              subject: (subjects || []).find(s => s.id === entry.subjectId),
              physicalRoom: (physicalRooms || []).find(c => c.id === entry.physicalRoomId),
              gradeLevel: entry.gradeLevelId === 'Non-Student'
                ? { id: 'Non-Student', name: 'Non-Student' } as GradeLevel
                : (gradeLevels || []).find(g => g.id === entry.gradeLevelId),
              periods: 0,
              slots: []
            };
          }
          loadGroups[key].periods += 1;
          loadGroups[key].slots.push({ day: entry.day, period: entry.period });
        });

        // Format periods string function
        const formatTeachingSlots = (slots: { day: DayOfWeek, period: number }[]) => {
          if (!slots || slots.length === 0) return '';
          
          const dayMap: Record<DayOfWeek, string> = {
            [DayOfWeek.Monday]: 'จ',
            [DayOfWeek.Tuesday]: 'อ',
            [DayOfWeek.Wednesday]: 'พ',
            [DayOfWeek.Thursday]: 'ฤ',
            [DayOfWeek.Friday]: 'ศ',
          } as any;
          const dayOrder = [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday] as any;
          
          const byDay: Record<string, number[]> = {};
          slots.forEach(s => {
             if (!byDay[s.day]) byDay[s.day] = [];
             byDay[s.day].push(s.period);
          });

          const getPeriodLabel = (p: number) => {
             const label = (appData.periodSettings && appData.periodSettings[p]) ? appData.periodSettings[p].label : String(p);
             const num = label.replace(/\D/g, '');
             return num ? num : String(p);
          };
          
          const parts: string[] = [];
          dayOrder.forEach((day: DayOfWeek) => {
            if (byDay[day]) {
              const periods = [...new Set(byDay[day])].sort((a, b) => a - b);
              const dayStr = dayMap[day] || day;
              let i = 0;
              const seqs: string[] = [];
              while (i < periods.length) {
                let start = i;
                while (i + 1 < periods.length && periods[i + 1] === periods[i] + 1) {
                  i++;
                }
                if (start === i) {
                  seqs.push(getPeriodLabel(periods[start]));
                } else {
                  seqs.push(`${getPeriodLabel(periods[start])}-${getPeriodLabel(periods[i])}`);
                }
                i++;
              }
              parts.push(`${dayStr}${seqs.join(',')}`);
            }
          });
          
          return parts.join(', ');
        };

        const allGroups = Object.values(loadGroups).filter(g => g.subject).map(g => ({
          ...g,
          formattedSlots: formatTeachingSlots(g.slots)
        }));

        const mainSubjects = allGroups.filter(g => !isActivitySubject(g.subject));
        const activitySubjects = allGroups.filter(g => isActivitySubject(g.subject));

        // Calculate totals
        const totalMain = mainSubjects.reduce((sum, g) => sum + g.periods, 0);
        const totalActivity = activitySubjects.reduce((sum, g) => sum + g.periods, 0);
        const grandTotal = totalMain + totalActivity;

        // Homeroom info
        let homeroomStr = '-';
        if (teacher.homeroomGradeLevelIds && teacher.homeroomGradeLevelIds.length > 0) {
          homeroomStr = teacher.homeroomGradeLevelIds.map(gid => {
            const g = (gradeLevels || []).find(gl => gl.id === gid);
            return g ? g.name : '';
          }).filter(Boolean).join(', ') || '-';
        }

        return {
          no: index + 1,
          department: teacher.department || '-',
          name: teacher.name,
          email: teacher.email || '-',
          homeroom: homeroomStr,
          mainSubjects,
          activitySubjects,
          totalMain,
          totalActivity,
          grandTotal
        };
      });
    } catch (err: any) {
      console.error("Error generating teacher load report data:", err);
      setReportError(err.message || 'เกิดข้อผิดพลาดในการประมวลผลข้อมูล โปรดตรวจสอบความสมบูรณ์ของข้อมูลวิชา หรือห้องเรียน');
      return [];
    }
  }, [teachers, subjects, physicalRooms, gradeLevels, scheduleEntries, physicalRooms]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    const wsData: any[][] = [];
    
    // Set column headers with formal names
    wsData.push(['กลุ่มสาระ', 'ที่', 'ชื่อ-สกุล', 'อีเมล', 'ประจำชั้น', 'ลำดับวิชา', 'รหัสวิชา', 'ชื่อรายวิชา', 'คาบ/ห้อง', 'วัน-คาบที่สอน', 'ระดับ', 'สรุปคาบ']);
    
    reportData.forEach((row) => {
      let subjectIndex = 1;
      
      const addSubjectRow = (group: any, isActivity: boolean, isFirstOfTeacher: boolean) => {
        wsData.push([
          isFirstOfTeacher ? row.department : '',
          isFirstOfTeacher ? row.no : '',
          isFirstOfTeacher ? row.name : '',
          isFirstOfTeacher ? row.email : '',
          isFirstOfTeacher ? row.homeroom : '',
          subjectIndex++,
          group.subject.subjectCode || '-',
          group.subject.name + (isActivity ? ' (กิจกรรม)' : ''),
          `${group.periods} / ${formatRoomDisplay(group.physicalRoom) || '-'}`,
          group.formattedSlots,
          group.gradeLevel?.name || '-',
          group.periods
        ]);
      };

      if (row.mainSubjects.length === 0 && row.activitySubjects.length === 0) {
        wsData.push([row.department, row.no, row.name, row.email, row.homeroom, '', '-', '- ไม่มีภาระงานสอน -', '-', '-', '-', 0]);
      } else {
        row.mainSubjects.forEach((g, i) => addSubjectRow(g, false, i === 0));
        row.activitySubjects.forEach((g, i) => addSubjectRow(g, true, row.mainSubjects.length === 0 && i === 0));
      }

      // Summary row for teacher
      wsData.push([
        '', '', '', '', '', '', '', `รวมคาบสอน (วิชาหลัก: ${row.totalMain}, กิจกรรม: ${row.totalActivity})`, '', '', '', { t: 'n', v: row.grandTotal, f: `SUM(L${wsData.length - (row.mainSubjects.length + row.activitySubjects.length - 1)}:L${wsData.length})` } 
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    
    // Styling the header row to be formal blue
    for (let i = 0; i < 12; i++) {
        const cellRef = XLSX.utils.encode_cell({c: i, r: 0});
        if (!ws[cellRef]) continue;
        ws[cellRef].s = {
            fill: { fgColor: { rgb: "D9EAD3" } }, 
            font: { bold: true, color: { rgb: "000000" } },
            alignment: { horizontal: "center", vertical: "center" },
            border: {
              top: { style: "thin", color: { auto: 1} },
              bottom: { style: "thin", color: { auto: 1} },
              left: { style: "thin", color: { auto: 1} },
              right: { style: "thin", color: { auto: 1} }
            }
        };
    }

    XLSX.utils.book_append_sheet(wb, ws, "ภาระงานสอน");
    XLSX.writeFile(wb, "Teacher_Load_Report.xlsx");
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 print:block print:h-auto">
      <div className="flex-none p-4 bg-white border-b border-slate-200 flex justify-between items-center print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">รายงานสรุปภาระงานสอน (คำสั่งปฏิบัติงานสอน)</h1>
          <p className="text-slate-500">ข้อมูลสรุปภาระงานสอนรายบุคคล จัดกลุ่มตามวิชาหลักและกิจกรรม</p>
        </div>
        <div className="flex space-x-3">
          <button 
            onClick={handleExportExcel}
            className="flex items-center bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md shadow-sm transition-colors text-sm font-medium"
          >
            <Icons.Download className="w-4 h-4 mr-2" />
            ดาวน์โหลดไฟล์ Excel (.xlsx)
          </button>
          <button 
            onClick={handlePrint}
            className="flex items-center bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md shadow-sm transition-colors text-sm font-medium"
          >
            <Icons.Printer className="w-4 h-4 mr-2" />
            พิมพ์คำสั่งปฏิบัติงานสอน
          </button>
          {onClose && (
            <button 
              onClick={onClose}
              className="flex items-center bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-md shadow-sm transition-colors text-sm font-medium ml-4"
            >
              ปิดหน้าต่าง
            </button>
          )}
        </div>
      </div>

      <div className="flex-grow overflow-auto p-4 print:p-0 print:overflow-visible bg-slate-50 print:bg-white text-sm">
        {reportError && (
          <div className="max-w-7xl mx-auto mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md print:hidden flex items-center">
            <Icons.Warning className="w-5 h-5 mr-3 flex-shrink-0" />
            <div>
              <p className="font-semibold">ไม่สามารถประมวลผลรายงานได้</p>
              <p className="text-sm">{reportError}</p>
            </div>
          </div>
        )}
        <div id="teacher-load-printable-area" className="max-w-7xl mx-auto bg-white p-6 shadow-sm border border-slate-200 print:border-none print:shadow-none print:p-0">
          <style>{`
            @media print {
              @page { size: landscape; margin: 1cm; }
              body { background-color: white; }              
              #teacher-load-printable-area { width: 100%; margin: 0; padding: 0; }
              table { width: 100%; border-collapse: collapse; }
              th, td { border: 1px solid #000 !important; }
              th { background-color: #f1f5f9 !important; -webkit-print-color-adjust: exact; text-align: center; }
              .page-break { page-break-after: always; }
              .print\\:hidden { display: none !important; }
            }
          `}</style>
          
          <div className="text-center mb-6 hidden print:block">
            <h2 className="text-xl font-bold">สรุปภาระงานสอนรายบุคคล</h2>
            <p>ประจำภาคเรียนที่ {appData.organizationSettings?.semester || '-'} ปีการศึกษา {appData.organizationSettings?.academicYear || '-'} โรงเรียน{appData.organizationSettings?.name || '.......'}</p>
          </div>

          <table className="w-full border-collapse border border-slate-300 text-[13px] print:table-auto print:text-[11px] print:leading-tight">
            <thead className="bg-slate-100 print:bg-white text-slate-700">
              <tr>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center w-28 print:whitespace-nowrap print:w-auto">กลุ่มสาระ</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center w-12 print:whitespace-nowrap print:w-auto">ที่</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-left w-48 print:whitespace-nowrap print:w-auto">ชื่อ-สกุล</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-left w-48 print:whitespace-nowrap print:w-auto">อีเมล</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center w-24 print:whitespace-nowrap print:w-auto">ประจำชั้น</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center w-20 print:whitespace-nowrap print:w-auto">ลำดับวิชา</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center w-24 print:whitespace-nowrap print:w-auto">รหัสวิชา</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-left print:whitespace-nowrap print:w-auto">ชื่อรายวิชา</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center w-24 print:whitespace-nowrap print:w-auto">คาบ/ห้อง</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center w-24 print:whitespace-nowrap print:w-auto">วัน-คาบที่สอน</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center w-24 print:whitespace-nowrap print:w-auto">ระดับ</th>
                <th className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center w-20 print:whitespace-nowrap print:w-auto">สรุปคาบ</th>
              </tr>
            </thead>
            <tbody>
              {reportData.map((row, teacherIdx) => {
                const totalRows = Math.max(1, row.mainSubjects.length + row.activitySubjects.length);
                let subjectIndex = 1;

                return (
                  <React.Fragment key={teacherIdx}>
                    <tr>
                      <td className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-top font-medium" rowSpan={totalRows + 1}>{row.department}</td>
                      <td className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-top font-medium" rowSpan={totalRows + 1}>{row.no}</td>
                      <td className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-left align-top font-medium text-slate-800" rowSpan={totalRows + 1}>{row.name}</td>
                      <td className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-left align-top text-slate-600" rowSpan={totalRows + 1}>{row.email}</td>
                      <td className="border border-slate-300 px-3 py-2 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-top whitespace-pre-wrap" rowSpan={totalRows + 1}>{row.homeroom}</td>

                      {/* First Row of subjects */}
                      {row.mainSubjects.length > 0 || row.activitySubjects.length > 0 ? (
                        <>
                          <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle">{subjectIndex++}</td>
                          <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle">
                            {(row.mainSubjects[0]?.subject || row.activitySubjects[0]?.subject)?.subjectCode || (row.activitySubjects.length > 0 ? '*' : '-')}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-left align-middle relative">
                            {(row.mainSubjects[0]?.subject || row.activitySubjects[0]?.subject)?.name}
                            {row.mainSubjects.length === 0 && row.activitySubjects.length > 0 && <span className="ml-1 text-[10px] bg-slate-100 border border-slate-200 px-1 rounded absolute right-2 top-1/2 -translate-y-1/2 print:border-none print:px-0 text-slate-500">กิจกรรม</span>}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle whitespace-nowrap">
                            {row.mainSubjects[0] ? `${row.mainSubjects[0].periods} / ${formatRoomDisplay(row.mainSubjects[0].physicalRoom) || '-'}` : `${row.activitySubjects[0]?.periods} / ${formatRoomDisplay(row.activitySubjects[0]?.physicalRoom) || '-'}`}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle whitespace-nowrap">
                            {row.mainSubjects[0] ? row.mainSubjects[0].formattedSlots : row.activitySubjects[0]?.formattedSlots || '-'}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle">
                            {row.mainSubjects[0] ? row.mainSubjects[0].gradeLevel?.name || '-' : row.activitySubjects[0]?.gradeLevel?.name || '-'}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle font-medium">
                            {row.mainSubjects[0]?.periods || row.activitySubjects[0]?.periods || 0}
                          </td>
                        </>
                      ) : (
                        <>
                           <td className="border border-slate-300 px-3 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center p-0 align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle text-slate-500 italic">- ไม่มีภาระงานสอน -</td>
                           <td className="border border-slate-300 px-3 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center p-0 align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center p-0 align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center p-0 align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle text-slate-500">0</td>
                        </>
                      )}
                    </tr>
                    
                    {/* Remaining subjects */}
                    {(() => {
                        const allSubjects = [...row.mainSubjects, ...row.activitySubjects];
                        return allSubjects.slice(1).map((sub, i) => {
                           const isActivitySub = row.mainSubjects.length === 0 || i >= row.mainSubjects.length - 1;
                           return (
                            <tr key={`extra-${teacherIdx}-${i}`} className={isActivitySub ? "text-slate-600 print:text-black" : "print:text-black"}>
                                <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle">{subjectIndex++}</td>
                                <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle">{sub.subject?.subjectCode || (isActivitySub ? '*' : '-')}</td>
                                <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-left align-middle relative">
                                    {sub.subject?.name}
                                    {isActivitySub && <span className="ml-1 text-[10px] bg-slate-100 border border-slate-200 px-1 rounded absolute right-2 top-1/2 -translate-y-1/2 print:border-none print:px-0 text-slate-500">กิจกรรม</span>}
                                </td>
                                <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle whitespace-nowrap">
                                    {sub.periods} / {formatRoomDisplay(sub.physicalRoom) || '-'}
                                </td>
                                <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle whitespace-nowrap">
                                    {sub.formattedSlots}
                                </td>
                                <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle">{sub.gradeLevel?.name || '-'}</td>
                                <td className="border border-slate-300 px-2 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center align-middle font-medium">{sub.periods}</td>
                            </tr>
                           );
                        });
                    })()}

                    {/* Total Row */}
                    <tr className="bg-sky-50 print:bg-[#f8fafc]">
                        <td className="border border-slate-300 px-3 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-right font-bold print:font-bold" colSpan={6}>
                           รวมคาบสอน (วิชาหลัก: {row.totalMain}, กิจกรรม: {row.totalActivity})
                        </td>
                        <td className="border border-slate-300 px-3 py-1.5 print:px-1 print:py-0 print:h-6 print:text-[11px] print:leading-[1.1] text-center font-bold text-sky-700 print:text-black">{row.grandTotal}</td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          <div className="mt-10 mb-4 flex justify-between text-center print:flex hidden" style={{ pageBreakInside: 'avoid' }}>
                <div style={{ width: '45%' }}>
                    <div style={{ marginBottom: '8px' }}>ลงชื่อ ........................................................ ผู้เสนออนุมัติ</div>
                    <div style={{ marginBottom: '8px' }}>({appData.organizationSettings?.deputyDirectorName || '........................................................'})</div>
                    <div>{appData.organizationSettings?.deputyDirectorPosition || 'รองผู้อำนวยการฝ่ายบริหารวิชาการ'}</div>
                </div>
                <div style={{ width: '45%' }}>
                    <div style={{ marginBottom: '8px' }}>ลงชื่อ ........................................................ ผู้อนุมัติ</div>
                    <div style={{ marginBottom: '8px' }}>({appData.organizationSettings?.directorName || '........................................................'})</div>
                    <div>{appData.organizationSettings?.directorPosition || 'ผู้อำนวยการโรงเรียน'}</div>
                </div>
          </div>
        </div>
      </div>
    </div>
  );
};
