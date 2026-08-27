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
  ShadingType,
  Header,
  Footer,
  PageNumber,
  ImageRun
} from 'docx';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SARABUN_REGULAR_BASE64, SARABUN_BOLD_BASE64 } from '../utils/sarabunFont';

function getImageTypeAndData(base64Str?: string): { data: Uint8Array; type: 'png' | 'jpg' } | null {
  if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image')) return null;
  try {
    const isJpeg = base64Str.startsWith('data:image/jpeg') || base64Str.startsWith('data:image/jpg');
    const type: 'png' | 'jpg' = isJpeg ? 'jpg' : 'png';
    const commaIdx = base64Str.indexOf(',');
    const raw = commaIdx >= 0 ? base64Str.slice(commaIdx + 1) : base64Str;
    const binary = atob(raw);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { data: bytes, type };
  } catch (err) {
    console.warn('Unable to decode base64 image for docx:', err);
    return null;
  }
}

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
      const orderNumber = organizationSettings?.orderNumber || `..... / ${academicYear}`;
      const deputyDirectorName = organizationSettings?.deputyDirectorName || '......................................................';
      const deputyDirectorPosition = organizationSettings?.deputyDirectorPosition || 'รองผู้อำนวยการกลุ่มบริหารวิชาการ';
      const directorName = organizationSettings?.directorName || '......................................................';
      const directorPosition = organizationSettings?.directorPosition || `ผู้อำนวยการโรงเรียน${schoolName}`;
      const logoInfo = getImageTypeAndData(organizationSettings?.logoUrl);

      const pageMarginDxa = 800; // ~14mm margin for max table space
      const pageLandscapeWidthDxa = 16838; // 297mm in DXA
      const usableWidthDxa = pageLandscapeWidthDxa - (pageMarginDxa * 2);

      // 11 Proportional columns without email:
      // 1. กลุ่มสาระ (13%)
      // 2. ที่ (3%)
      // 3. ชื่อ-สกุล (14%)
      // 4. ประจำชั้น (7%)
      // 5. ลำดับ (4%)
      // 6. รหัสวิชา (7%)
      // 7. ชื่อรายวิชา (17%) - narrowed
      // 8. คาบ/ห้อง (9%)
      // 9. วัน-คาบที่สอน (16%) - widened
      // 10. ระดับ (6%)
      // 11. สรุปคาบ (4%)
      const colPercentages = [13, 3, 14, 7, 4, 7, 17, 9, 16, 6, 4];
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
        'กลุ่มสาระ', 'ที่', 'ชื่อ-สกุล', 'ประจำชั้น',
        'ลำดับ', 'รหัสวิชา', 'ชื่อรายวิชา', 'คาบ/ห้อง', 'วัน-คาบที่สอน', 'ระดับ', 'สรุปคาบ'
      ];

      const headerRow = new TableRow({
        tableHeader: true,
        children: tableHeaderTitles.map((title, idx) => new TableCell({
          width: { size: colWidths[idx], type: WidthType.DXA },
          shading: { fill: 'F1F5F9', type: ShadingType.CLEAR },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: title, bold: true, size: 21, font: 'TH Sarabun New' })]
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
                alignment: idx === 2 || idx === 6 ? AlignmentType.LEFT : AlignmentType.CENTER,
                children: [new TextRun({ text: cellText, size: 20, font: 'TH Sarabun New' })]
              })]
            }))
          }));
        };

        if (row.mainSubjects.length === 0 && row.activitySubjects.length === 0) {
          const emptyCells = [
            row.department,
            String(row.no),
            row.name,
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
                alignment: idx === 2 ? AlignmentType.LEFT : (idx === 6 ? AlignmentType.CENTER : AlignmentType.CENTER),
                children: [new TextRun({ text: cellText, size: 20, font: 'TH Sarabun New', italics: idx === 6 })]
              })]
            }))
          }));
        } else {
          row.mainSubjects.forEach((g, i) => addDocxSubjectRow(g, false, i === 0));
          row.activitySubjects.forEach((g, i) => addDocxSubjectRow(g, true, row.mainSubjects.length === 0 && i === 0));
        }

        // Summary row for teacher (span across first 10 columns)
        const colSpan10Width = colWidths.slice(0, 10).reduce((sum, w) => sum + w, 0);
        tableRows.push(new TableRow({
          children: [
            new TableCell({
              columnSpan: 10,
              width: { size: colSpan10Width, type: WidthType.DXA },
              shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({
                  text: `รวมคาบสอน (วิชาหลัก: ${row.totalMain}, กิจกรรม: ${row.totalActivity})`,
                  bold: true,
                  size: 20,
                  font: 'TH Sarabun New'
                })]
              })]
            }),
            new TableCell({
              shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
              width: { size: colWidths[10], type: WidthType.DXA },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({
                  text: String(row.grandTotal),
                  bold: true,
                  size: 20,
                  font: 'TH Sarabun New'
                })]
              })]
            })
          ]
        }));
      });

      const headerCells: TableCell[] = [];
      if (logoInfo) {
        headerCells.push(new TableCell({
          width: { size: 600, type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: logoInfo.data,
                  transformation: { width: 34, height: 34 },
                  type: logoInfo.type
                })
              ]
            })
          ]
        }));
      }

      headerCells.push(new TableCell({
        width: { size: logoInfo ? usableWidthDxa - 600 - Math.round(usableWidthDxa * 0.15) : Math.round(usableWidthDxa * 0.85), type: WidthType.DXA },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: `ตารางแนบท้ายประกอบคำสั่ง${schoolName} ที่ ${orderNumber} เรื่อง แต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`,
                bold: true,
                size: 22,
                font: 'TH Sarabun New'
              })
            ]
          })
        ]
      }));

      headerCells.push(new TableCell({
        width: { size: Math.round(usableWidthDxa * 0.15), type: WidthType.DXA },
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: 'หน้า ', size: 22, font: 'TH Sarabun New' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 22, font: 'TH Sarabun New' }),
              new TextRun({ text: ' / ', size: 22, font: 'TH Sarabun New' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 22, font: 'TH Sarabun New' })
            ]
          })
        ]
      }));

      const doc = new Document({
        sections: [{
          properties: {
            page: {
              size: { orientation: PageOrientation.LANDSCAPE },
              margin: { top: 1200, bottom: 1800, left: pageMarginDxa, right: pageMarginDxa }
            }
          },
          headers: {
            default: new Header({
              children: [
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  borders: {
                    top: { style: BorderStyle.NONE },
                    bottom: { style: BorderStyle.NONE },
                    left: { style: BorderStyle.NONE },
                    right: { style: BorderStyle.NONE },
                    insideHorizontal: { style: BorderStyle.NONE },
                    insideVertical: { style: BorderStyle.NONE }
                  },
                  rows: [
                    new TableRow({
                      children: headerCells
                    })
                  ]
                })
              ]
            })
          },
          footers: {
            default: new Footer({
              children: [
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  borders: {
                    top: { style: BorderStyle.NONE },
                    bottom: { style: BorderStyle.NONE },
                    left: { style: BorderStyle.NONE },
                    right: { style: BorderStyle.NONE },
                    insideHorizontal: { style: BorderStyle.NONE },
                    insideVertical: { style: BorderStyle.NONE }
                  },
                  rows: [
                    new TableRow({
                      children: [
                        new TableCell({
                          width: { size: Math.round(usableWidthDxa * 0.5), type: WidthType.DXA },
                          children: [
                            new Paragraph({
                              alignment: AlignmentType.CENTER,
                              children: [
                                new TextRun({ text: '(ลงชื่อ)...................................................... ', size: 21, font: 'TH Sarabun New' }),
                                new TextRun({ text: 'ผู้เห็นชอบ', bold: true, size: 21, font: 'TH Sarabun New' })
                              ]
                            }),
                            new Paragraph({
                              alignment: AlignmentType.CENTER,
                              children: [new TextRun({ text: `(${deputyDirectorName})`, size: 21, font: 'TH Sarabun New' })]
                            }),
                            new Paragraph({
                              alignment: AlignmentType.CENTER,
                              children: [new TextRun({ text: deputyDirectorPosition, size: 21, font: 'TH Sarabun New' })]
                            })
                          ]
                        }),
                        new TableCell({
                          width: { size: Math.round(usableWidthDxa * 0.5), type: WidthType.DXA },
                          children: [
                            new Paragraph({
                              alignment: AlignmentType.CENTER,
                              children: [
                                new TextRun({ text: '(ลงชื่อ)...................................................... ', size: 21, font: 'TH Sarabun New' }),
                                new TextRun({ text: 'ผู้อนุมัติ', bold: true, size: 21, font: 'TH Sarabun New' })
                              ]
                            }),
                            new Paragraph({
                              alignment: AlignmentType.CENTER,
                              children: [new TextRun({ text: `(${directorName})`, size: 21, font: 'TH Sarabun New' })]
                            }),
                            new Paragraph({
                              alignment: AlignmentType.CENTER,
                              children: [new TextRun({ text: directorPosition, size: 21, font: 'TH Sarabun New' })]
                            })
                          ]
                        })
                      ]
                    })
                  ]
                })
              ]
            })
          },
          children: [
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              columnWidths: colWidths,
              borders: tableBorders,
              rows: tableRows
            })
          ]
        }]
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `ตารางแนบท้ายคำสั่งสอน_ภาค${semester}_${academicYear}.docx`);
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
      const orderNumber = organizationSettings?.orderNumber || `..... / ${academicYear}`;
      const deputyDirectorName = organizationSettings?.deputyDirectorName || '......................................................';
      const deputyDirectorPosition = organizationSettings?.deputyDirectorPosition || 'รองผู้อำนวยการกลุ่มบริหารวิชาการ';
      const directorName = organizationSettings?.directorName || '......................................................';
      const directorPosition = organizationSettings?.directorPosition || `ผู้อำนวยการโรงเรียน${schoolName}`;
      const logoUrl = organizationSettings?.logoUrl;

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      doc.addFileToVFS('Sarabun-Regular.ttf', SARABUN_REGULAR_BASE64);
      doc.addFileToVFS('Sarabun-Bold.ttf', SARABUN_BOLD_BASE64);
      doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
      doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');

      const pageWidth = doc.internal.pageSize.getWidth(); // 297mm
      const pageHeight = doc.internal.pageSize.getHeight(); // 210mm

      const head = [['กลุ่มสาระ', 'ที่', 'ชื่อ-สกุล', 'ประจำชั้น', 'ลำดับ', 'รหัสวิชา', 'ชื่อรายวิชา', 'คาบ/ห้อง', 'วัน-คาบที่สอน', 'ระดับ', 'สรุปคาบ']];
      const body: any[] = [];

      reportData.forEach((row) => {
        let subjectIndex = 1;
        const addPdfSubjectRow = (group: any, isActivity: boolean, isFirstOfTeacher: boolean) => {
          body.push([
            isFirstOfTeacher ? row.department : '',
            isFirstOfTeacher ? String(row.no) : '',
            isFirstOfTeacher ? row.name : '',
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

        // Summary row for teacher (colSpan 10)
        body.push([
          {
            content: `รวมคาบสอน (วิชาหลัก: ${row.totalMain}, กิจกรรม: ${row.totalActivity})`,
            colSpan: 10,
            styles: { halign: 'right', fontStyle: 'bold', fillColor: [248, 250, 252] }
          },
          {
            content: String(row.grandTotal),
            styles: { halign: 'center', fontStyle: 'bold', fillColor: [248, 250, 252] }
          }
        ]);
      });

      autoTable(doc, {
        startY: 23,
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
          1: { cellWidth: 8, halign: 'center' },
          2: { cellWidth: 34, halign: 'left' },
          3: { cellWidth: 20, halign: 'center' },
          4: { cellWidth: 12, halign: 'center' },
          5: { cellWidth: 16, halign: 'center' },
          6: { cellWidth: 46, halign: 'left' },
          7: { cellWidth: 24, halign: 'center' },
          8: { cellWidth: 42, halign: 'center' },
          9: { cellWidth: 15, halign: 'center' },
          10: { cellWidth: 14, halign: 'center' }
        },
        margin: { top: 23, bottom: 30, left: 12, right: 12 },
        didDrawPage: () => {
          // --- Draw Repeating Header on Every Page ---
          let textStartX = 12;
          if (logoUrl && logoUrl.startsWith('data:image')) {
            try {
              doc.addImage(logoUrl, 'PNG', 12, 5, 12, 12);
              textStartX = 26;
            } catch (err) {
              console.warn('Unable to draw logo in PDF header:', err);
            }
          }

          doc.setFont('Sarabun', 'bold');
          doc.setFontSize(9.5);
          const headerTitle = `ตารางแนบท้ายประกอบคำสั่ง${schoolName} ที่ ${orderNumber} เรื่อง แต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`;
          doc.text(headerTitle, textStartX, 12);

          // --- Draw Repeating Footer on Every Page ---
          const footerTopY = pageHeight - 24;
          doc.setFont('Sarabun', 'normal');
          doc.setFontSize(8.5);

          // Left column: Deputy Director (Sign & Approval on same line)
          const leftCenter = 75;
          doc.text('(ลงชื่อ)...................................................... ผู้เห็นชอบ', leftCenter, footerTopY, { align: 'center' });
          doc.text(`(${deputyDirectorName})`, leftCenter, footerTopY + 5, { align: 'center' });
          doc.text(deputyDirectorPosition, leftCenter, footerTopY + 10, { align: 'center' });

          // Right column: Director (Sign & Approval on same line)
          const rightCenter = 222;
          doc.text('(ลงชื่อ)...................................................... ผู้อนุมัติ', rightCenter, footerTopY, { align: 'center' });
          doc.text(`(${directorName})`, rightCenter, footerTopY + 5, { align: 'center' });
          doc.text(directorPosition, rightCenter, footerTopY + 10, { align: 'center' });
        }
      });

      // Second pass: Draw page numbers on all pages accurately (e.g. "หน้า 1 / 5")
      const totalPages = (doc as any).getNumberOfPages ? (doc as any).getNumberOfPages() : (doc.internal.pages.length - 1);
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont('Sarabun', 'normal');
        doc.setFontSize(9);
        doc.text(`หน้า ${i} / ${totalPages}`, pageWidth - 12, 12, { align: 'right' });
      }

      doc.save(`ตารางแนบท้ายคำสั่งสอน_ภาค${semester}_${academicYear}.pdf`);
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

