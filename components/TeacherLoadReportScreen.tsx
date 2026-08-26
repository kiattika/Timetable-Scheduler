import { formatRoomDisplay } from "../utils/stringUtils";
import React, { useMemo, useState } from 'react';
import { AppData, Subject, GradeLevel, ScheduleEntry, PhysicalRoom, DayOfWeek } from '../types';
import * as XLSX from 'xlsx';
import { Icons } from '../constants';
import { 
  Document, 
  Packer, 
  Paragraph, 
  Table, 
  TableRow, 
  TableCell, 
  TextRun, 
  AlignmentType, 
  WidthType, 
  BorderStyle, 
  PageOrientation, 
  ShadingType 
} from 'docx';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SARABUN_REGULAR_BASE64, SARABUN_BOLD_BASE64 } from '../utils/sarabunFont';

interface TeacherLoadReportScreenProps {
  appData: AppData;
  onClose?: () => void;
}

export const TeacherLoadReportScreen: React.FC<TeacherLoadReportScreenProps> = ({ appData, onClose }) => {
  const { teachers, subjects, gradeLevels, scheduleEntries, physicalRooms, organizationSettings } = appData;
  const [reportError, setReportError] = React.useState<string | null>(null);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

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

  const handleExportDocx = async () => {
    try {
      setIsExportingDocx(true);
      const schoolName = organizationSettings?.name || '................................';
      const academicYear = organizationSettings?.academicYear || '.....';
      const semester = organizationSettings?.semester || '.....';

      const pageMarginDxa = 1000;
      // Standard A4 Landscape width is 16,838 DXA (297mm).
      // Usable width = 16,838 - 1,000 (left margin) - 1,000 (right margin) = 14,838 DXA.
      const pageLandscapeWidthDxa = 16838;
      const usableWidthDxa = pageLandscapeWidthDxa - (pageMarginDxa * 2);

      // Proportional column percentages based on real content length:
      // 1. กลุ่มสาระ (13%): Extended for long department names like "วิทยาศาสตร์และเทคโนโลยี(คอมพิวเตอร์)"
      // 2. ที่ (3%): Short number 1-2 digits
      // 3. ชื่อ-สกุล (12%): Full teacher name
      // 4. อีเมล (12%): Full email address
      // 5. ประจำชั้น (6%): Homeroom class (e.g. "ม.1/1")
      // 6. ลำดับวิชา (4%): Short subject index
      // 7. รหัสวิชา (6%): Subject code (e.g. "ว21101")
      // 8. ชื่อรายวิชา (18%): Longest column for subject name & activity labels
      // 9. คาบ/ห้อง (8%): Periods and room name
      // 10. วัน-คาบที่สอน (8%): Day and period slots
      // 11. ระดับ (6%): Grade level
      // 12. สรุปคาบ (4%): Short period total
      const colPercentages = [13, 3, 12, 12, 6, 4, 6, 18, 8, 8, 6, 4];
      const colWidths = colPercentages.map((pct, idx) => {
        if (idx === colPercentages.length - 1) {
          const sumPrev = colPercentages.slice(0, idx).reduce((sum, p) => sum + Math.round((p / 100) * usableWidthDxa), 0);
          return usableWidthDxa - sumPrev;
        }
        return Math.round((pct / 100) * usableWidthDxa);
      });

      const thinBorder = {
        style: BorderStyle.SINGLE,
        size: 4,
        color: 'A0AEC0'
      };
      const tableBorders = {
        top: thinBorder,
        bottom: thinBorder,
        left: thinBorder,
        right: thinBorder,
        insideHorizontal: thinBorder,
        insideVertical: thinBorder
      };

      const tableHeaderTitles = [
        'กลุ่มสาระ', 'ที่', 'ชื่อ-สกุล', 'อีเมล', 'ประจำชั้น',
        'ลำดับวิชา', 'รหัสวิชา', 'ชื่อรายวิชา', 'คาบ/ห้อง', 'วัน-คาบที่สอน', 'ระดับ', 'สรุปคาบ'
      ];

      const headerRow = new TableRow({
        tableHeader: true,
        children: tableHeaderTitles.map((title, idx) => new TableCell({
          width: { size: colWidths[idx], type: WidthType.DXA },
          shading: { fill: 'F1F5F9', type: ShadingType.CLEAR },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: title, bold: true, size: 17, font: 'TH Sarabun New' })]
          })]
        }))
      });

      const tableRows: TableRow[] = [headerRow];

      reportData.forEach((row) => {
        let subjectIndex = 1;
        const addDocxSubjectRow = (group: any, isActivity: boolean, isFirstOfTeacher: boolean) => {
          const cells = [
            isFirstOfTeacher ? row.department : '',
            isFirstOfTeacher ? String(row.no) : '',
            isFirstOfTeacher ? row.name : '',
            isFirstOfTeacher ? row.email : '',
            isFirstOfTeacher ? row.homeroom : '',
            String(subjectIndex++),
            group.subject?.subjectCode || '-',
            (group.subject?.name || '-') + (isActivity ? ' (กิจกรรม)' : ''),
            `${group.periods} / ${formatRoomDisplay(group.physicalRoom) || '-'}`,
            group.formattedSlots || '-',
            group.gradeLevel?.name || '-',
            String(group.periods)
          ];

          tableRows.push(new TableRow({
            children: cells.map((cellText, idx) => new TableCell({
              width: { size: colWidths[idx], type: WidthType.DXA },
              children: [new Paragraph({
                alignment: idx === 2 || idx === 3 || idx === 7 ? AlignmentType.LEFT : AlignmentType.CENTER,
                children: [new TextRun({ text: cellText, size: 16, font: 'TH Sarabun New' })]
              })]
            }))
          }));
        };

        if (row.mainSubjects.length === 0 && row.activitySubjects.length === 0) {
          const emptyCells = [
            row.department,
            String(row.no),
            row.name,
            row.email,
            row.homeroom,
            '',
            '-',
            '- ไม่มีภาระงานสอน -',
            '-',
            '-',
            '-',
            '0'
          ];
          tableRows.push(new TableRow({
            children: emptyCells.map((cellText, idx) => new TableCell({
              width: { size: colWidths[idx], type: WidthType.DXA },
              children: [new Paragraph({
                alignment: idx === 2 || idx === 3 ? AlignmentType.LEFT : (idx === 7 ? AlignmentType.CENTER : AlignmentType.CENTER),
                children: [new TextRun({ text: cellText, size: 16, font: 'TH Sarabun New', italics: idx === 7 })]
              })]
            }))
          }));
        } else {
          row.mainSubjects.forEach((g, i) => addDocxSubjectRow(g, false, i === 0));
          row.activitySubjects.forEach((g, i) => addDocxSubjectRow(g, true, row.mainSubjects.length === 0 && i === 0));
        }

        // Summary row for teacher
        const colSpan11Width = colWidths.slice(0, 11).reduce((sum, w) => sum + w, 0);
        tableRows.push(new TableRow({
          children: [
            new TableCell({
              columnSpan: 11,
              width: { size: colSpan11Width, type: WidthType.DXA },
              shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({
                  text: `รวมคาบสอน (วิชาหลัก: ${row.totalMain}, กิจกรรม: ${row.totalActivity})`,
                  bold: true,
                  size: 16,
                  font: 'TH Sarabun New'
                })]
              })]
            }),
            new TableCell({
              shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
              width: { size: colWidths[11], type: WidthType.DXA },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({
                  text: String(row.grandTotal),
                  bold: true,
                  size: 16,
                  font: 'TH Sarabun New'
                })]
              })]
            })
          ]
        }));
      });

      const doc = new Document({
        sections: [{
          properties: {
            page: {
              size: { orientation: PageOrientation.LANDSCAPE },
              margin: { top: pageMarginDxa, bottom: pageMarginDxa, left: pageMarginDxa, right: pageMarginDxa }
            }
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: `คำสั่งโรงเรียน${schoolName}`, bold: true, size: 28, font: 'TH Sarabun New' })]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: `ที่ ..... /${academicYear}`, size: 24, font: 'TH Sarabun New' })]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: `เรื่อง แต่งตั้งครูปฏิบัติหน้าที่การสอน ประจำภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`, bold: true, size: 24, font: 'TH Sarabun New' })]
            }),
            new Paragraph({ text: '' }),
            new Paragraph({
              children: [new TextRun({
                text: '        เพื่อให้การจัดการเรียนการสอนของโรงเรียนเป็นไปด้วยความเรียบร้อยและมีประสิทธิภาพ อาศัยอำนาจตามความในมาตรา ... จึงแต่งตั้งให้ข้าราชการครูปฏิบัติหน้าที่การสอน ดังรายละเอียดต่อไปนี้',
                size: 24,
                font: 'TH Sarabun New'
              })]
            }),
            new Paragraph({ text: '' }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              columnWidths: colWidths,
              borders: tableBorders,
              rows: tableRows
            }),
            new Paragraph({ text: '' }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: 'สั่ง ณ วันที่ ..... เดือน ..................... พ.ศ. .....        ', size: 24, font: 'TH Sarabun New' })]
            }),
            new Paragraph({ text: '' }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: 'ลงชื่อ .................................................                   ', size: 24, font: 'TH Sarabun New' })]
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `(${organizationSettings?.directorName || '........................................'})                  `, size: 24, font: 'TH Sarabun New' })]
            }),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `${organizationSettings?.directorPosition || `ผู้อำนวยการโรงเรียน${schoolName}`}         `, size: 24, font: 'TH Sarabun New' })]
            })
          ]
        }]
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, 'คำสั่งปฏิบัติงานสอน.docx');
    } catch (err: any) {
      console.error('Error exporting Word document:', err);
      alert('เกิดข้อผิดพลาดในการสร้างไฟล์ Word: ' + (err.message || ''));
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);
      const schoolName = organizationSettings?.name || '................................';
      const academicYear = organizationSettings?.academicYear || '.....';
      const semester = organizationSettings?.semester || '.....';

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      doc.addFileToVFS('Sarabun-Regular.ttf', SARABUN_REGULAR_BASE64);
      doc.addFileToVFS('Sarabun-Bold.ttf', SARABUN_BOLD_BASE64);
      doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
      doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');

      const pageWidth = doc.internal.pageSize.getWidth(); // 297mm

      doc.setFont('Sarabun', 'bold');
      doc.setFontSize(14);
      doc.text(`คำสั่งโรงเรียน${schoolName}`, pageWidth / 2, 14, { align: 'center' });

      doc.setFont('Sarabun', 'normal');
      doc.setFontSize(11);
      doc.text(`ที่ ..... /${academicYear}`, pageWidth / 2, 20, { align: 'center' });

      doc.setFont('Sarabun', 'bold');
      doc.text(`เรื่อง แต่งตั้งครูปฏิบัติหน้าที่การสอน ประจำภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`, pageWidth / 2, 26, { align: 'center' });

      doc.setFont('Sarabun', 'normal');
      doc.setFontSize(10);
      const reasonText = '        เพื่อให้การจัดการเรียนการสอนของโรงเรียนเป็นไปด้วยความเรียบร้อยและมีประสิทธิภาพ อาศัยอำนาจตามความในมาตรา ... จึงแต่งตั้งให้ข้าราชการครูปฏิบัติหน้าที่การสอน ดังรายละเอียดต่อไปนี้';
      doc.text(reasonText, 14, 33, { maxWidth: pageWidth - 28 });

      const head = [['กลุ่มสาระ', 'ที่', 'ชื่อ-สกุล', 'อีเมล', 'ประจำชั้น', 'ลำดับวิชา', 'รหัสวิชา', 'ชื่อรายวิชา', 'คาบ/ห้อง', 'วัน-คาบที่สอน', 'ระดับ', 'สรุปคาบ']];
      const body: any[] = [];

      reportData.forEach((row) => {
        let subjectIndex = 1;
        const addPdfSubjectRow = (group: any, isActivity: boolean, isFirstOfTeacher: boolean) => {
          body.push([
            isFirstOfTeacher ? row.department : '',
            isFirstOfTeacher ? String(row.no) : '',
            isFirstOfTeacher ? row.name : '',
            isFirstOfTeacher ? row.email : '',
            isFirstOfTeacher ? row.homeroom : '',
            String(subjectIndex++),
            group.subject?.subjectCode || '-',
            (group.subject?.name || '-') + (isActivity ? ' (กิจกรรม)' : ''),
            `${group.periods} / ${formatRoomDisplay(group.physicalRoom) || '-'}`,
            group.formattedSlots || '-',
            group.gradeLevel?.name || '-',
            String(group.periods)
          ]);
        };

        if (row.mainSubjects.length === 0 && row.activitySubjects.length === 0) {
          body.push([
            row.department,
            String(row.no),
            row.name,
            row.email,
            row.homeroom,
            '',
            '-',
            '- ไม่มีภาระงานสอน -',
            '-',
            '-',
            '-',
            '0'
          ]);
        } else {
          row.mainSubjects.forEach((g, i) => addPdfSubjectRow(g, false, i === 0));
          row.activitySubjects.forEach((g, i) => addPdfSubjectRow(g, true, row.mainSubjects.length === 0 && i === 0));
        }

        // Summary row for teacher
        body.push([
          {
            content: `รวมคาบสอน (วิชาหลัก: ${row.totalMain}, กิจกรรม: ${row.totalActivity})`,
            colSpan: 11,
            styles: { halign: 'right', fontStyle: 'bold', fillColor: [248, 250, 252] }
          },
          {
            content: String(row.grandTotal),
            styles: { halign: 'center', fontStyle: 'bold', fillColor: [248, 250, 252] }
          }
        ]);
      });

      autoTable(doc, {
        startY: 38,
        head: head,
        body: body,
        theme: 'grid',
        styles: {
          font: 'Sarabun',
          fontSize: 8,
          cellPadding: 1.5,
          textColor: [0, 0, 0],
          lineColor: [180, 180, 180],
          lineWidth: 0.1
        },
        headStyles: {
          font: 'Sarabun',
          fontStyle: 'bold',
          fillColor: [241, 245, 249],
          textColor: [0, 0, 0],
          halign: 'center',
          valign: 'middle'
        },
        columnStyles: {
          0: { cellWidth: 26, halign: 'center' },
          1: { cellWidth: 10, halign: 'center' },
          2: { cellWidth: 34, halign: 'left' },
          3: { cellWidth: 34, halign: 'left' },
          4: { cellWidth: 20, halign: 'center' },
          5: { cellWidth: 12, halign: 'center' },
          6: { cellWidth: 16, halign: 'center' },
          7: { cellWidth: 'auto', halign: 'left' },
          8: { cellWidth: 24, halign: 'center' },
          9: { cellWidth: 22, halign: 'center' },
          10: { cellWidth: 16, halign: 'center' },
          11: { cellWidth: 14, halign: 'center' }
        },
        margin: { left: 14, right: 14, bottom: 20 }
      });

      const finalY = (doc as any).lastAutoTable?.finalY || 100;
      let signY = finalY + 12;
      if (signY + 35 > doc.internal.pageSize.getHeight()) {
        doc.addPage();
        signY = 20;
      }

      const rightAlignX = pageWidth - 20;
      doc.setFont('Sarabun', 'normal');
      doc.setFontSize(10);
      doc.text('สั่ง ณ วันที่ ..... เดือน ..................... พ.ศ. .....', rightAlignX, signY, { align: 'right' });
      doc.text('ลงชื่อ .................................................', rightAlignX, signY + 12, { align: 'right' });
      doc.text(`(${organizationSettings?.directorName || '........................................'})`, rightAlignX - 8, signY + 18, { align: 'right' });
      doc.text(organizationSettings?.directorPosition || `ผู้อำนวยการโรงเรียน${schoolName}`, rightAlignX - 5, signY + 24, { align: 'right' });

      doc.save('คำสั่งปฏิบัติงานสอน.pdf');
    } catch (err: any) {
      console.error('Error exporting PDF:', err);
      alert('เกิดข้อผิดพลาดในการสร้างไฟล์ PDF: ' + (err.message || ''));
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="flex-none p-4 bg-white border-b border-slate-200 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">รายงานสรุปภาระงานสอน (คำสั่งปฏิบัติงานสอน)</h1>
          <p className="text-slate-500">ข้อมูลสรุปภาระงานสอนรายบุคคล จัดกลุ่มตามวิชาหลักและกิจกรรม</p>
        </div>
        <div className="flex items-center space-x-3">
          <button 
            onClick={handleExportExcel}
            className="flex items-center bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md shadow-sm transition-colors text-sm font-medium"
          >
            <Icons.Download className="w-4 h-4 mr-2" />
            ดาวน์โหลดไฟล์ Excel (.xlsx)
          </button>
          <button 
            onClick={handleExportDocx}
            disabled={isExportingDocx}
            className="flex items-center bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-md shadow-sm transition-colors text-sm font-medium"
          >
            <Icons.FileText className="w-4 h-4 mr-2" />
            {isExportingDocx ? 'กำลังสร้างไฟล์ Word...' : 'ส่งออกเป็น Word (.docx)'}
          </button>
          <button 
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="flex items-center bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white px-4 py-2 rounded-md shadow-sm transition-colors text-sm font-medium"
          >
            <Icons.Download className="w-4 h-4 mr-2" />
            {isExportingPdf ? 'กำลังสร้างไฟล์ PDF...' : 'ส่งออกเป็น PDF'}
          </button>
          {onClose && (
            <button 
              onClick={onClose}
              className="flex items-center bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-md shadow-sm transition-colors text-sm font-medium ml-2"
            >
              ปิดหน้าต่าง
            </button>
          )}
        </div>
      </div>

      <div className="flex-grow overflow-auto p-4 bg-slate-50 text-sm">
        {reportError && (
          <div className="max-w-7xl mx-auto mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-md flex items-center">
            <Icons.Warning className="w-5 h-5 mr-3 flex-shrink-0" />
            <div>
              <p className="font-semibold">ไม่สามารถประมวลผลรายงานได้</p>
              <p className="text-sm">{reportError}</p>
            </div>
          </div>
        )}
        <div id="teacher-load-preview-area" className="max-w-7xl mx-auto bg-white p-6 shadow-sm border border-slate-200">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-slate-800">สรุปภาระงานสอนรายบุคคล</h2>
            <p className="text-slate-600">ประจำภาคเรียนที่ {appData.organizationSettings?.semester || '-'} ปีการศึกษา {appData.organizationSettings?.academicYear || '-'} โรงเรียน{appData.organizationSettings?.name || '.......'}</p>
          </div>

          <table className="w-full border-collapse border border-slate-300 text-[13px]">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="border border-slate-300 px-3 py-2 text-center w-28">กลุ่มสาระ</th>
                <th className="border border-slate-300 px-3 py-2 text-center w-12">ที่</th>
                <th className="border border-slate-300 px-3 py-2 text-left w-48">ชื่อ-สกุล</th>
                <th className="border border-slate-300 px-3 py-2 text-left w-48">อีเมล</th>
                <th className="border border-slate-300 px-3 py-2 text-center w-24">ประจำชั้น</th>
                <th className="border border-slate-300 px-3 py-2 text-center w-20">ลำดับวิชา</th>
                <th className="border border-slate-300 px-3 py-2 text-center w-24">รหัสวิชา</th>
                <th className="border border-slate-300 px-3 py-2 text-left">ชื่อรายวิชา</th>
                <th className="border border-slate-300 px-3 py-2 text-center w-24">คาบ/ห้อง</th>
                <th className="border border-slate-300 px-3 py-2 text-center w-24">วัน-คาบที่สอน</th>
                <th className="border border-slate-300 px-3 py-2 text-center w-24">ระดับ</th>
                <th className="border border-slate-300 px-3 py-2 text-center w-20">สรุปคาบ</th>
              </tr>
            </thead>
            <tbody>
              {reportData.map((row, teacherIdx) => {
                const totalRows = Math.max(1, row.mainSubjects.length + row.activitySubjects.length);
                let subjectIndex = 1;

                return (
                  <React.Fragment key={teacherIdx}>
                    <tr>
                      <td className="border border-slate-300 px-3 py-2 text-center align-top font-medium" rowSpan={totalRows + 1}>{row.department}</td>
                      <td className="border border-slate-300 px-3 py-2 text-center align-top font-medium" rowSpan={totalRows + 1}>{row.no}</td>
                      <td className="border border-slate-300 px-3 py-2 text-left align-top font-medium text-slate-800" rowSpan={totalRows + 1}>{row.name}</td>
                      <td className="border border-slate-300 px-3 py-2 text-left align-top text-slate-600" rowSpan={totalRows + 1}>{row.email}</td>
                      <td className="border border-slate-300 px-3 py-2 text-center align-top whitespace-pre-wrap" rowSpan={totalRows + 1}>{row.homeroom}</td>

                      {/* First Row of subjects */}
                      {row.mainSubjects.length > 0 || row.activitySubjects.length > 0 ? (
                        <>
                          <td className="border border-slate-300 px-2 py-1.5 text-center align-middle">{subjectIndex++}</td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center align-middle">
                            {(row.mainSubjects[0]?.subject || row.activitySubjects[0]?.subject)?.subjectCode || (row.activitySubjects.length > 0 ? '*' : '-')}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-left align-middle relative">
                            {(row.mainSubjects[0]?.subject || row.activitySubjects[0]?.subject)?.name}
                            {row.mainSubjects.length === 0 && row.activitySubjects.length > 0 && <span className="ml-1 text-[10px] bg-slate-100 border border-slate-200 px-1 rounded absolute right-2 top-1/2 -translate-y-1/2 text-slate-500">กิจกรรม</span>}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center align-middle whitespace-nowrap">
                            {row.mainSubjects[0] ? `${row.mainSubjects[0].periods} / ${formatRoomDisplay(row.mainSubjects[0].physicalRoom) || '-'}` : `${row.activitySubjects[0]?.periods} / ${formatRoomDisplay(row.activitySubjects[0]?.physicalRoom) || '-'}`}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center align-middle whitespace-nowrap">
                            {row.mainSubjects[0] ? row.mainSubjects[0].formattedSlots : row.activitySubjects[0]?.formattedSlots || '-'}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center align-middle">
                            {row.mainSubjects[0] ? row.mainSubjects[0].gradeLevel?.name || '-' : row.activitySubjects[0]?.gradeLevel?.name || '-'}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center align-middle font-medium">
                            {row.mainSubjects[0]?.periods || row.activitySubjects[0]?.periods || 0}
                          </td>
                        </>
                      ) : (
                        <>
                           <td className="border border-slate-300 px-3 py-1.5 text-center p-0 align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 text-center align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 text-center align-middle text-slate-500 italic">- ไม่มีภาระงานสอน -</td>
                           <td className="border border-slate-300 px-3 py-1.5 text-center p-0 align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 text-center p-0 align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 text-center p-0 align-middle">&nbsp;</td>
                           <td className="border border-slate-300 px-3 py-1.5 text-center align-middle text-slate-500">0</td>
                        </>
                      )}
                    </tr>
                    
                    {/* Remaining subjects */}
                    {(() => {
                        const allSubjects = [...row.mainSubjects, ...row.activitySubjects];
                        return allSubjects.slice(1).map((sub, i) => {
                           const isActivitySub = row.mainSubjects.length === 0 || i >= row.mainSubjects.length - 1;
                           return (
                            <tr key={`extra-${teacherIdx}-${i}`} className={isActivitySub ? "text-slate-600" : ""}>
                                <td className="border border-slate-300 px-2 py-1.5 text-center align-middle">{subjectIndex++}</td>
                                <td className="border border-slate-300 px-2 py-1.5 text-center align-middle">{sub.subject?.subjectCode || (isActivitySub ? '*' : '-')}</td>
                                <td className="border border-slate-300 px-2 py-1.5 text-left align-middle relative">
                                    {sub.subject?.name}
                                    {isActivitySub && <span className="ml-1 text-[10px] bg-slate-100 border border-slate-200 px-1 rounded absolute right-2 top-1/2 -translate-y-1/2 text-slate-500">กิจกรรม</span>}
                                </td>
                                <td className="border border-slate-300 px-2 py-1.5 text-center align-middle whitespace-nowrap">
                                    {sub.periods} / {formatRoomDisplay(sub.physicalRoom) || '-'}
                                </td>
                                <td className="border border-slate-300 px-2 py-1.5 text-center align-middle whitespace-nowrap">
                                    {sub.formattedSlots}
                                </td>
                                <td className="border border-slate-300 px-2 py-1.5 text-center align-middle">{sub.gradeLevel?.name || '-'}</td>
                                <td className="border border-slate-300 px-2 py-1.5 text-center align-middle font-medium">{sub.periods}</td>
                            </tr>
                           );
                        });
                    })()}

                    {/* Total Row */}
                    <tr className="bg-sky-50">
                        <td className="border border-slate-300 px-3 py-1.5 text-right font-bold text-slate-700" colSpan={6}>
                           รวมคาบสอน (วิชาหลัก: {row.totalMain}, กิจกรรม: {row.totalActivity})
                        </td>
                        <td className="border border-slate-300 px-3 py-1.5 text-center font-bold text-sky-700">{row.grandTotal}</td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          <div className="mt-10 mb-4 flex justify-between text-center">
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

