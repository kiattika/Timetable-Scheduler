import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AppData, Identifiable, PrintOptions, Teacher, GradeLevel, PhysicalRoom, ScheduleEntry, DayOfWeek } from '../types';
import { SARABUN_REGULAR_BASE64, SARABUN_BOLD_BASE64 } from './sarabunFont';
import { formatRoomDisplay, formatRoomShort } from './stringUtils';
import { isParentGrade as checkIsParentGradeUtil } from '../components/scheduleUtils';

export const THAI_DAYS: Record<string, string> = {
  'Monday': 'จันทร์',
  'Tuesday': 'อังคาร',
  'Wednesday': 'พุธ',
  'Thursday': 'พฤหัสบดี',
  'Friday': 'ศุกร์',
  'Saturday': 'เสาร์',
  'Sunday': 'อาทิตย์',
};

export async function exportScheduleGridPdf(
  appData: AppData,
  printOptions: PrintOptions,
  getEntryDisplay: (entry: ScheduleEntry) => { subject?: any; teachers: Teacher[]; physicalRoom?: PhysicalRoom; gradeLevel?: GradeLevel }
): Promise<void> {
  const { itemType, selectedItemIds, orientation } = printOptions;
  const orgSettings = appData.organizationSettings;
  const orgName = orgSettings?.name || 'โรงเรียน';
  const semester = orgSettings?.semester || '1';
  const academicYear = orgSettings?.academicYear || '2567';
  const logoUrl = orgSettings?.logoUrl;
  const deputyDirectorName = orgSettings?.deputyDirectorName || '......................................................';
  const deputyDirectorPosition = orgSettings?.deputyDirectorPosition || 'รองผู้อำนวยการกลุ่มบริหารวิชาการ';
  const directorName = orgSettings?.directorName || '......................................................';
  const directorPosition = orgSettings?.directorPosition || `ผู้อำนวยการโรงเรียน${orgName}`;

  const periodSettings = appData.periodSettings || [];
  const operatingDays = (orgSettings?.operatingDays && orgSettings.operatingDays.length > 0)
    ? orgSettings.operatingDays
    : [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday];

  const itemsToRender = selectedItemIds.map(id => {
    switch (itemType) {
      case 'teacher': return appData.teachers.find(t => t.id === id);
      case 'gradeLevel': return appData.gradeLevels.find(gl => gl.id === id);
      case 'physicalRoom': return appData.physicalRooms.find(c => c.id === id);
      default: return null;
    }
  }).filter(Boolean) as Identifiable[];

  if (itemsToRender.length === 0) return;

  const doc = new jsPDF({
    orientation: orientation || 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  doc.addFileToVFS('Sarabun-Regular.ttf', SARABUN_REGULAR_BASE64);
  doc.addFileToVFS('Sarabun-Bold.ttf', SARABUN_BOLD_BASE64);
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
  doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let itemIdx = 0; itemIdx < itemsToRender.length; itemIdx++) {
    const item = itemsToRender[itemIdx];
    if (itemIdx > 0) {
      doc.addPage();
    }

    let scheduleTypeTitle = 'ตารางสอน';
    let line2Text = '';

    if (itemType === 'teacher') {
      const teacher = item as Teacher;
      scheduleTypeTitle = 'ตารางสอนรายบุคคล';
      const codePrefix = teacher.teacherCode ? `${teacher.teacherCode} ` : '';
      const deptSuffix = teacher.department ? ` (กลุ่มสาระฯ${teacher.department})` : '';
      line2Text = `ครูผู้สอน: ${codePrefix}${teacher.name || 'N/A'}${deptSuffix}`;
    } else if (itemType === 'gradeLevel') {
      const grade = item as GradeLevel;
      scheduleTypeTitle = 'ตารางเรียนประจำชั้น';
      let classInfo = grade.name || 'N/A';
      if (grade.homeroomPhysicalRoomId && !checkIsParentGradeUtil(grade.id, appData.gradeLevels)) {
        const cl = appData.physicalRooms.find(c => c.id === grade.homeroomPhysicalRoomId);
        if (cl?.name) {
          classInfo += ` (ห้อง ${cl.name})`;
        }
      }
      line2Text = `ระดับชั้น/ห้อง: ${classInfo}`;
    } else if (itemType === 'physicalRoom') {
      const room = item as PhysicalRoom;
      scheduleTypeTitle = 'ตารางการใช้ห้องเรียน';
      const roomCodeSuffix = room.code ? ` (${room.code})` : '';
      line2Text = `ห้องเรียน: ${room.name || 'N/A'}${roomCodeSuffix}`;
    }

    // --- Draw Header ---
    let textStartX = 14;
    if (logoUrl && logoUrl.startsWith('data:image')) {
      try {
        doc.addImage(logoUrl, 'PNG', 14, 8, 14, 14);
        textStartX = 31;
      } catch (err) {
        console.warn('Unable to render logo in schedule PDF:', err);
      }
    }

    doc.setFont('Sarabun', 'bold');
    doc.setFontSize(11);
    doc.text(`${orgName} | ${scheduleTypeTitle} | ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`, textStartX, 13);
    doc.setFontSize(10);
    doc.setFont('Sarabun', 'normal');
    doc.text(line2Text, textStartX, 19);

    // --- Build Table Head and Body ---
    const headRow = [
      'วัน / คาบ',
      ...periodSettings.map(p => `${p.label}\n${p.startTime}-${p.endTime}`)
    ];

    const bodyRows: any[] = [];

    operatingDays.forEach(day => {
      const thaiDay = THAI_DAYS[day] || day;
      const rowCells: any[] = [thaiDay];

      periodSettings.forEach((_, periodIndex) => {
        // Find matching entries
        let entries: ScheduleEntry[] = [];
        if (itemType === 'teacher') {
          entries = appData.scheduleEntries.filter(e => e.day === day && e.period === periodIndex && e.teacherIds.includes(item.id));
        } else if (itemType === 'gradeLevel') {
          entries = appData.scheduleEntries.filter(e => e.day === day && e.period === periodIndex && e.gradeLevelId === item.id);
        } else if (itemType === 'physicalRoom') {
          entries = appData.scheduleEntries.filter(e => e.day === day && e.period === periodIndex && e.physicalRoomId === item.id);
        }

        if (entries.length === 0) {
          rowCells.push('');
        } else {
          // Format exactly 4 lines per block
          const blockTexts = entries.map(entry => {
            const display = getEntryDisplay(entry);
            const subCode = display.subject?.subjectCode || display.subject?.name || '-';
            const roomShort = formatRoomShort(display.physicalRoom) || '';

            if (itemType === 'teacher') {
              const coTeachers = display.teachers.filter(t => t.id !== item.id);
              let line3 = '';
              if (coTeachers.length === 1) {
                line3 = coTeachers[0].name;
              } else if (coTeachers.length > 1) {
                line3 = `${coTeachers[0].name} และทีม`;
              } else if (entry.cohort) {
                line3 = `(${entry.cohort})`;
              }
              return `${subCode}\n${display.gradeLevel?.name || '-'}\n${line3}\n${roomShort}`;
            } else if (itemType === 'gradeLevel') {
              const teachers = display.teachers || [];
              const t1 = teachers.length > 0 ? teachers[0].name : '-';
              let t2 = '';
              if (teachers.length === 2) {
                t2 = teachers[1].name;
              } else if (teachers.length > 2) {
                t2 = `${teachers[1].name} และทีม`;
              } else if (entry.cohort) {
                t2 = `(${entry.cohort})`;
              }
              return `${subCode}\n${t1}\n${t2}\n${roomShort}`;
            } else {
              // physicalRoom
              const teachers = display.teachers || [];
              const t1 = teachers.length > 0 ? teachers[0].name : '-';
              let t2 = '';
              if (teachers.length === 2) {
                t2 = teachers[1].name;
              } else if (teachers.length > 2) {
                t2 = `${teachers[1].name} และทีม`;
              } else if (entry.cohort) {
                t2 = `(${entry.cohort})`;
              }
              return `${subCode}\n${t1}\n${t2}\n${display.gradeLevel?.name || '-'}`;
            }
          });

          rowCells.push(blockTexts.join('\n---\n'));
        }
      });

      bodyRows.push(rowCells);
    });

    const dayColWidth = 18;
    const remainingWidth = (pageWidth - 28) - dayColWidth;
    const periodColWidth = periodSettings.length > 0 ? remainingWidth / periodSettings.length : 20;

    const columnStyles: Record<number, any> = {
      0: { cellWidth: dayColWidth, halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: 10 }
    };
    periodSettings.forEach((_, idx) => {
      columnStyles[idx + 1] = { cellWidth: periodColWidth, halign: 'center', valign: 'middle', fontSize: 7.5 };
    });

    autoTable(doc, {
      startY: 24,
      head: [headRow],
      body: bodyRows,
      theme: 'grid',
      styles: {
        font: 'Sarabun',
        fontSize: 7.5,
        cellPadding: 1,
        textColor: [0, 0, 0],
        lineColor: [180, 180, 180],
        lineWidth: 0.1,
        minCellHeight: 18
      },
      headStyles: {
        font: 'Sarabun',
        fontStyle: 'bold',
        fontSize: 8,
        fillColor: [241, 245, 249],
        textColor: [0, 0, 0],
        halign: 'center',
        valign: 'middle'
      },
      columnStyles,
      margin: { top: 24, bottom: 28, left: 14, right: 14 }
    });

    // --- Footer Signatures ---
    const footerTopY = pageHeight - 18;
    doc.setFont('Sarabun', 'normal');
    doc.setFontSize(8.5);

    // Left Column: Deputy Director
    const leftCenter = pageWidth * 0.28;
    doc.text('(ลงชื่อ)...................................................... ผู้เสนออนุมัติ', leftCenter, footerTopY, { align: 'center' });
    doc.text(`(${deputyDirectorName})`, leftCenter, footerTopY + 4.5, { align: 'center' });
    doc.text(deputyDirectorPosition, leftCenter, footerTopY + 9, { align: 'center' });

    // Right Column: Director
    const rightCenter = pageWidth * 0.72;
    doc.text('(ลงชื่อ)...................................................... ผู้อนุมัติ', rightCenter, footerTopY, { align: 'center' });
    doc.text(`(${directorName})`, rightCenter, footerTopY + 4.5, { align: 'center' });
    doc.text(directorPosition, rightCenter, footerTopY + 9, { align: 'center' });
  }

  const exportFileName = `ตาราง_${itemType}_ภาค${semester}_${academicYear}.pdf`;
  doc.save(exportFileName);
}
