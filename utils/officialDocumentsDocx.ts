import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  BorderStyle,
  PageOrientation,
  ImageRun,
} from 'docx';
import { saveAs } from 'file-saver';
import { OrganizationSettings } from '../types';
import { formatThaiDate } from './officialDocumentsPdf';

/**
 * Helper to decode base64 data URL into Uint8Array with image type for docx ImageRun.
 */
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

const noBorder = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

/**
 * 1. Generate "บันทึกข้อความ" (Official Memo) - Word Document (.docx)
 * Follows standard Thai government saraban format (A4 Portrait, Sarabun font, 1.5 cm Garuda).
 */
export async function generateOfficialMemoDocx(
  settings: OrganizationSettings | null,
  _appData?: any
): Promise<void> {
  try {
    const schoolName = settings?.name || '................................';
    const department = settings?.department || 'กลุ่มบริหารวิชาการ';
    const workGroupName = settings?.workGroupName || 'กลุ่มงานวิชาการและหลักสูตร';
    const orderNumber = settings?.orderNumber || '....... / ..........';
    const semester = settings?.semester || '.....';
    const academicYear = settings?.academicYear || '..........';
    const phone = settings?.phone || '';

    const proposerName = settings?.proposerName || '........................................................';
    const proposerPosition = settings?.proposerPosition || 'หัวหน้างานจัดตารางสอน';

    const reviewerName = settings?.reviewerName || '........................................................';
    const reviewerPosition = settings?.reviewerPosition || 'หัวหน้ากลุ่มงานวิชาการและหลักสูตร';

    const deputyDirectorName = settings?.deputyDirectorName || '........................................................';
    const deputyDirectorPosition = settings?.deputyDirectorPosition || 'รองผู้อำนวยการกลุ่มบริหารวิชาการ';

    const directorName = settings?.directorName || '........................................................';
    const directorPosition = settings?.directorPosition || `ผู้อำนวยการโรงเรียน${schoolName}`;

    const thaiDate = formatThaiDate(settings?.orderDate);
    const memoDateText = settings?.orderDate
      ? `${thaiDate.day} ${thaiDate.month} ${thaiDate.year}`
      : '........................................................';

    // Page dimensions (A4 Portrait: 11,906 x 16,838 DXA)
    const marginLeftDxa = 1700; // ~3cm
    const marginRightDxa = 1134; // ~2cm
    const usableWidthDxa = 11906 - marginLeftDxa - marginRightDxa; // 9072 DXA

    // Prepare Garuda Image (1.5 cm height ~ 57 px)
    const emblemImage = getImageTypeAndData(settings?.emblemUrl);

    // Top Table (Garuda Left 1.5cm + Title Center)
    const topRowCells: TableCell[] = [];
    if (emblemImage) {
      topRowCells.push(
        new TableCell({
          width: { size: 1800, type: WidthType.DXA },
          borders: noBorder,
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: emblemImage.data,
                  type: emblemImage.type,
                  transformation: {
                    width: 57, // ~1.5 cm at 96 DPI
                    height: 57,
                  },
                }),
              ],
            }),
          ],
        })
      );
      topRowCells.push(
        new TableCell({
          width: { size: usableWidthDxa - 1800, type: WidthType.DXA },
          borders: noBorder,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 120, after: 120 },
              children: [
                new TextRun({
                  text: 'บันทึกข้อความ',
                  bold: true,
                  size: 58, // 29pt
                  font: 'TH Sarabun New',
                }),
              ],
            }),
          ],
        })
      );
    } else {
      topRowCells.push(
        new TableCell({
          width: { size: usableWidthDxa, type: WidthType.DXA },
          borders: noBorder,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 120, after: 120 },
              children: [
                new TextRun({
                  text: 'บันทึกข้อความ',
                  bold: true,
                  size: 58,
                  font: 'TH Sarabun New',
                }),
              ],
            }),
          ],
        })
      );
    }

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: 'TH Sarabun New',
              size: 32, // 16pt
            },
            paragraph: {
              spacing: { line: 260, before: 60, after: 60 },
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { orientation: PageOrientation.PORTRAIT },
              margin: {
                top: 1440, // 2.5cm
                bottom: 1134, // 2.0cm
                left: marginLeftDxa,
                right: marginRightDxa,
              },
            },
          },
          children: [
            // Top Section (Logo + Title)
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: noBorder,
              rows: [new TableRow({ children: topRowCells })],
            }),

            // Spacer
            new Paragraph({ spacing: { after: 120 }, children: [] }),

            // ส่วนราชการ
            new Paragraph({
              spacing: { before: 40, after: 40 },
              children: [
                new TextRun({ text: 'ส่วนราชการ  ', bold: true, size: 32, font: 'TH Sarabun New' }),
                new TextRun({
                  text: `${schoolName} (${department})${phone ? ` โทร. ${phone}` : ''}`,
                  size: 32,
                  font: 'TH Sarabun New',
                }),
              ],
            }),

            // ที่ และ วันที่ (2 Columns Table)
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: noBorder,
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: Math.round(usableWidthDxa * 0.45), type: WidthType.DXA },
                      borders: noBorder,
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({ text: 'ที่  ', bold: true, size: 32, font: 'TH Sarabun New' }),
                            new TextRun({ text: orderNumber, size: 32, font: 'TH Sarabun New' }),
                          ],
                        }),
                      ],
                    }),
                    new TableCell({
                      width: { size: Math.round(usableWidthDxa * 0.55), type: WidthType.DXA },
                      borders: noBorder,
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({ text: 'วันที่  ', bold: true, size: 32, font: 'TH Sarabun New' }),
                            new TextRun({ text: memoDateText, size: 32, font: 'TH Sarabun New' }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),

            // เรื่อง
            new Paragraph({
              spacing: { before: 40, after: 60 },
              children: [
                new TextRun({ text: 'เรื่อง  ', bold: true, size: 32, font: 'TH Sarabun New' }),
                new TextRun({
                  text: `ลงนามในคำสั่งแต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน ภาคเรียนที่ ${semester} ประจำปีการศึกษา ${academicYear}`,
                  size: 32,
                  font: 'TH Sarabun New',
                }),
              ],
            }),

            // เส้นคั่น (Divider Line)
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
                insideHorizontal: { style: BorderStyle.NONE },
                insideVertical: { style: BorderStyle.NONE },
              },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: usableWidthDxa, type: WidthType.DXA },
                      children: [new Paragraph({ children: [] })],
                    }),
                  ],
                }),
              ],
            }),

            new Paragraph({ spacing: { after: 60 }, children: [] }),

            // เรียน
            new Paragraph({
              spacing: { before: 40, after: 40 },
              children: [
                new TextRun({ text: 'เรียน  ', bold: true, size: 32, font: 'TH Sarabun New' }),
                new TextRun({ text: directorPosition, size: 32, font: 'TH Sarabun New' }),
              ],
            }),

            // สิ่งที่แนบมาด้วย
            new Paragraph({
              spacing: { before: 40, after: 80 },
              children: [
                new TextRun({ text: 'สิ่งที่แนบมาด้วย  ', bold: true, size: 32, font: 'TH Sarabun New' }),
                new TextRun({
                  text: `คำสั่งแต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน ภาคเรียนที่ ${semester} ประจำปีการศึกษา ${academicYear}`,
                  size: 32,
                  font: 'TH Sarabun New',
                }),
              ],
            }),

            // เนื้อความ ย่อหน้า 1
            new Paragraph({
              spacing: { before: 80, after: 60 },
              children: [
                new TextRun({
                  text: `        ด้วย${department} โดย${workGroupName} มีหน้าที่ในการดำเนินการจัดตารางเรียนตารางสอนของครูและนักเรียน${schoolName} ได้จัดทำข้อมูลตารางสอนของคณะครูและนักเรียน${schoolName} เพื่อให้การดำเนินการจัดกิจกรรมการเรียนการสอนของ${schoolName} ภาคเรียนที่ ${semester} ประจำปีการศึกษา ${academicYear} เป็นไปด้วยความเรียบร้อยมีประสิทธิภาพสอดคล้องกับบริบทของโรงเรียน และสอดคล้องกับแนวนโยบายของกระทรวงศึกษาธิการ`,
                  size: 30, // 15pt
                  font: 'TH Sarabun New',
                }),
              ],
            }),

            // เนื้อความ ย่อหน้า 2
            new Paragraph({
              spacing: { before: 60, after: 60 },
              children: [
                new TextRun({
                  text: `        ${workGroupName} จึงได้จัดทำตารางเรียนตารางสอน คำสั่งแต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอนภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear} เพื่อขออนุมัติใช้เป็นแนวทางการปฏิบัติงานในหน้าที่ที่รับผิดชอบให้บังเกิดผลดีต่อราชการต่อไป`,
                  size: 30,
                  font: 'TH Sarabun New',
                }),
              ],
            }),

            // เนื้อความ ย่อหน้า 3
            new Paragraph({
              spacing: { before: 60, after: 120 },
              children: [
                new TextRun({
                  text: `        จึงเรียนมาเพื่อโปรดพิจารณา หากเห็นชอบโปรดลงนาม คำสั่งแต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`,
                  size: 30,
                  font: 'TH Sarabun New',
                }),
              ],
            }),

            // --- Signatures Tier 1: Proposer (Right-Aligned Table) ---
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: noBorder,
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: Math.round(usableWidthDxa * 0.45), type: WidthType.DXA },
                      borders: noBorder,
                      children: [new Paragraph({ children: [] })],
                    }),
                    new TableCell({
                      width: { size: Math.round(usableWidthDxa * 0.55), type: WidthType.DXA },
                      borders: noBorder,
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: 'ลงชื่อ........................................................', size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: `( ${proposerName} )`, size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: proposerPosition, size: 28, font: 'TH Sarabun New' })],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),

            new Paragraph({ spacing: { after: 100 }, children: [] }),

            // --- Signatures Tier 2: Two Columns (Reviewer Left, Deputy Director Right) ---
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: noBorder,
              rows: [
                new TableRow({
                  children: [
                    // Left Column: Reviewer
                    new TableCell({
                      width: { size: Math.round(usableWidthDxa * 0.5), type: WidthType.DXA },
                      borders: noBorder,
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: '(   ) ตรวจเสนอแล้ว', size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          children: [new TextRun({ text: '(   ) เห็นควรดำเนินการตามเสนอ', size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          spacing: { before: 80 },
                          children: [new TextRun({ text: 'ลงชื่อ........................................................', size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          children: [new TextRun({ text: `( ${reviewerName} )`, size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          children: [new TextRun({ text: reviewerPosition, size: 28, font: 'TH Sarabun New' })],
                        }),
                      ],
                    }),
                    // Right Column: Deputy Director
                    new TableCell({
                      width: { size: Math.round(usableWidthDxa * 0.5), type: WidthType.DXA },
                      borders: noBorder,
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: '(   ) ทราบ', size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          children: [new TextRun({ text: '(   ) เห็นชอบ / เสนอเพื่อโปรดลงนาม', size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          spacing: { before: 80 },
                          children: [new TextRun({ text: 'ลงชื่อ........................................................', size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          children: [new TextRun({ text: `( ${deputyDirectorName} )`, size: 28, font: 'TH Sarabun New' })],
                        }),
                        new Paragraph({
                          children: [new TextRun({ text: deputyDirectorPosition, size: 28, font: 'TH Sarabun New' })],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),

            new Paragraph({ spacing: { after: 120 }, children: [] }),

            // --- Signatures Tier 3: Director Bottom Approval ---
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: '(   ) อนุมัติและลงนามแล้ว            (   ) อื่นๆ ...........................................',
                  size: 28,
                  font: 'TH Sarabun New',
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 80 },
              children: [new TextRun({ text: 'ลงชื่อ........................................................', size: 28, font: 'TH Sarabun New' })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: `( ${directorName} )`, size: 28, font: 'TH Sarabun New' })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: directorPosition, size: 28, font: 'TH Sarabun New' })],
            }),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `บันทึกข้อความขออนุมัติคำสั่งสอน_ภาค${semester}_${academicYear}.docx`);
  } catch (err: any) {
    console.error('Error generating official memo docx:', err);
    alert('เกิดข้อผิดพลาดในการสร้างไฟล์ Word บันทึกข้อความ: ' + (err.message || ''));
  }
}

/**
 * 2. Generate "คำสั่งโรงเรียน" (School Order) - Word Document (.docx)
 * Follows standard Thai government format (A4 Portrait, 3 cm Garuda centered, TH Sarabun New).
 */
export async function generateSchoolOrderDocx(
  settings: OrganizationSettings | null,
  _appData?: any
): Promise<void> {
  try {
    const schoolName = settings?.name || '................................';
    const orderNumber = settings?.orderNumber || '....... / ..........';
    const semester = settings?.semester || '.....';
    const academicYear = settings?.academicYear || '..........';
    const legalBasisText =
      settings?.legalBasisText?.trim() ||
      'อาศัยอำนาจตามความในมาตรา 39 (1) แห่งพระราชบัญญัติระเบียบบริหารราชการกระทรวงศึกษาธิการ พ.ศ. 2546 และที่แก้ไขเพิ่มเติม และมาตรา 27 (1) แห่งพระราชบัญญัติระเบียบข้าราชการครูและบุคลากรทางการศึกษา พ.ศ. 2547 และที่แก้ไขเพิ่มเติม ประกอบกับระเบียบกระทรวงศึกษาธิการว่าด้วยการบริหารจัดการและขอบเขตการปฏิบัติหน้าที่ของสถานศึกษาขั้นพื้นฐานที่เป็นนิติบุคคลในสังกัดเขตพื้นที่การศึกษา พ.ศ. 2546';

    const directorName = settings?.directorName || '........................................................';
    const directorPosition = settings?.directorPosition || `ผู้อำนวยการโรงเรียน${schoolName}`;

    const thaiDate = formatThaiDate(settings?.orderDate);

    // Page dimensions (A4 Portrait)
    const marginLeftDxa = 1700; // ~3cm
    const marginRightDxa = 1134; // ~2cm
    const usableWidthDxa = 11906 - marginLeftDxa - marginRightDxa;

    // Prepare Garuda Image (3 cm height ~ 113 px)
    const emblemImage = getImageTypeAndData(settings?.emblemUrl);

    const docChildren: any[] = [];

    // 1. Center Garuda Emblem (3cm)
    if (emblemImage) {
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 120 },
          children: [
            new ImageRun({
              data: emblemImage.data,
              type: emblemImage.type,
              transformation: {
                width: 113, // ~3.0 cm at 96 DPI
                height: 113,
              },
            }),
          ],
        })
      );
    } else {
      docChildren.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [] }));
    }

    // 2. Order Header
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 },
        children: [
          new TextRun({
            text: `คำสั่ง${schoolName}`,
            bold: true,
            size: 36, // 18pt
            font: 'TH Sarabun New',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 60 },
        children: [
          new TextRun({
            text: `ที่ ${orderNumber}`,
            size: 32, // 16pt
            font: 'TH Sarabun New',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({
            text: 'เรื่อง แต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน',
            bold: true,
            size: 32,
            font: 'TH Sarabun New',
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 20, after: 100 },
        children: [
          new TextRun({
            text: `ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`,
            bold: true,
            size: 32,
            font: 'TH Sarabun New',
          }),
        ],
      }),
      // Divider line
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: usableWidthDxa, type: WidthType.DXA },
                children: [new Paragraph({ children: [] })],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ spacing: { after: 120 }, children: [] })
    );

    // 3. Body Paragraphs
    docChildren.push(
      // Paragraph 1
      new Paragraph({
        spacing: { before: 80, after: 60 },
        children: [
          new TextRun({
            text: `        ${legalBasisText} เพื่อให้การบริหารสถานศึกษา เกิดประสิทธิภาพและประสิทธิผลสูงสุดทางราชการ จึงแต่งตั้งและมอบหมายหน้าที่ราชการ งานสนับสนุนการสอน ให้ข้าราชการครูและลูกจ้างของ${schoolName}ปฏิบัติหน้าที่สอนภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear} ตามบัญชีแนบท้ายคำสั่งนี้`,
            size: 30, // 15pt
            font: 'TH Sarabun New',
          }),
        ],
      }),
      // Paragraph 2
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: [
          new TextRun({
            text: `        ทั้งนี้ให้ผู้ที่ได้รับการแต่งตั้งให้ปฏิบัติหน้าที่สอนในทุกกลุ่มสาระการเรียนรู้ และงานกิจกรรมพัฒนาผู้เรียน จัดกิจกรรมโฮมรูมให้กับนักเรียนตั้งแต่เวลา 08.00 น. – 08.30 น. ดำเนินการจัดทำแผนการจัดการเรียนรู้ การวัดและประเมินผลการเรียนรู้ ให้เป็นไปตามปฏิทินวิชาการ และปฏิบัติหน้าที่ให้เกิดผลดีต่อนักเรียน โรงเรียนและทางราชการ ต่อไป`,
            size: 30,
            font: 'TH Sarabun New',
          }),
        ],
      }),
      // Paragraph 3 ("ทั้งนี้ ตั้งแต่บัดนี้เป็นต้นไป")
      new Paragraph({
        spacing: { before: 60, after: 140 },
        children: [
          new TextRun({
            text: '        ทั้งนี้ ตั้งแต่บัดนี้เป็นต้นไป',
            size: 30,
            font: 'TH Sarabun New',
          }),
        ],
      })
    );

    // 4. Date & Director Signature Block (Right aligned table)
    docChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorder,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: Math.round(usableWidthDxa * 0.4), type: WidthType.DXA },
                borders: noBorder,
                children: [new Paragraph({ children: [] })],
              }),
              new TableCell({
                width: { size: Math.round(usableWidthDxa * 0.6), type: WidthType.DXA },
                borders: noBorder,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 80, after: 140 },
                    children: [
                      new TextRun({
                        text: `สั่ง ณ วันที่ ${thaiDate.day} เดือน ${thaiDate.month} พ.ศ. ${thaiDate.year}`,
                        size: 30,
                        font: 'TH Sarabun New',
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 80, after: 40 },
                    children: [
                      new TextRun({
                        text: 'ลงชื่อ ........................................................',
                        size: 28,
                        font: 'TH Sarabun New',
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 20, after: 20 },
                    children: [
                      new TextRun({
                        text: `( ${directorName} )`,
                        size: 28,
                        font: 'TH Sarabun New',
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 20, after: 40 },
                    children: [
                      new TextRun({
                        text: directorPosition,
                        size: 28,
                        font: 'TH Sarabun New',
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    );

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: 'TH Sarabun New',
              size: 32,
            },
            paragraph: {
              spacing: { line: 260, before: 60, after: 60 },
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { orientation: PageOrientation.PORTRAIT },
              margin: {
                top: 1440, // 2.5cm
                bottom: 1134, // 2.0cm
                left: marginLeftDxa,
                right: marginRightDxa,
              },
            },
          },
          children: docChildren,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `คำสั่งปฏิบัติหน้าที่สอน_ภาค${semester}_${academicYear}.docx`);
  } catch (err: any) {
    console.error('Error generating school order docx:', err);
    alert('เกิดข้อผิดพลาดในการสร้างไฟล์ Word คำสั่ง: ' + (err.message || ''));
  }
}
