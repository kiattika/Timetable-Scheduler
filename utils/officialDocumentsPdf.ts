import { jsPDF } from 'jspdf';
import { OrganizationSettings } from '../types';
import { SARABUN_REGULAR_BASE64, SARABUN_BOLD_BASE64 } from './sarabunFont';

/**
 * Initializes jsPDF with Sarabun Thai font.
 */
function createPdfDocument(orientation: 'portrait' | 'landscape' = 'portrait'): jsPDF {
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
  });

  doc.addFileToVFS('Sarabun-Regular.ttf', SARABUN_REGULAR_BASE64);
  doc.addFileToVFS('Sarabun-Bold.ttf', SARABUN_BOLD_BASE64);
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
  doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');

  return doc;
}

/**
 * Safely renders an image (base64) onto jsPDF document
 */
function safeAddImage(doc: jsPDF, imageData: string | undefined, x: number, y: number, w: number, h: number) {
  if (!imageData || !imageData.startsWith('data:image')) return;
  try {
    doc.addImage(imageData, x, y, w, h);
  } catch (err) {
    console.warn('Unable to embed image in PDF:', err);
  }
}

/**
 * 1. Generate "บันทึกข้อความ" (Official Memo) - A4 Portrait
 */
export function generateOfficialMemoPdf(settings: OrganizationSettings | null): void {
  const doc = createPdfDocument('portrait');

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

  const leftMargin = 25;
  const rightMargin = 20;
  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const contentWidth = pageWidth - leftMargin - rightMargin; // 165mm

  let currentY = 22;

  // --- 1. Top Section: Garuda Emblem & Title ---
  if (settings?.emblemUrl) {
    safeAddImage(doc, settings.emblemUrl, leftMargin, currentY, 20, 20);
  }

  // Header Title "บันทึกข้อความ"
  doc.setFont('Sarabun', 'bold');
  doc.setFontSize(24);
  doc.text('บันทึกข้อความ', pageWidth / 2 + 10, currentY + 12, { align: 'center' });

  currentY += 25;

  // --- 2. Memo Meta Header ---
  doc.setFontSize(14);
  
  // ส่วนราชการ
  doc.setFont('Sarabun', 'bold');
  doc.text('ส่วนราชการ', leftMargin, currentY);
  doc.setFont('Sarabun', 'normal');
  const orgFullText = `${schoolName} (${department})${phone ? ` โทร. ${phone}` : ''}`;
  doc.text(orgFullText, leftMargin + 25, currentY);
  currentY += 7;

  // ที่ และ วันที่
  doc.setFont('Sarabun', 'bold');
  doc.text('ที่', leftMargin, currentY);
  doc.setFont('Sarabun', 'normal');
  doc.text(orderNumber, leftMargin + 8, currentY);

  doc.setFont('Sarabun', 'bold');
  doc.text('วันที่', leftMargin + 80, currentY);
  doc.setFont('Sarabun', 'normal');
  doc.text('........................................................', leftMargin + 92, currentY);
  currentY += 7;

  // เรื่อง
  doc.setFont('Sarabun', 'bold');
  doc.text('เรื่อง', leftMargin, currentY);
  doc.setFont('Sarabun', 'normal');
  const subjectText = `ลงนามในคำสั่งแต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน ภาคเรียนที่ ${semester} ประจำปีการศึกษา ${academicYear}`;
  const subjectLines = doc.splitTextToSize(subjectText, contentWidth - 14);
  doc.text(subjectLines, leftMargin + 14, currentY);
  currentY += (subjectLines.length * 6) + 1;

  // เส้นคั่น
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(leftMargin, currentY, leftMargin + contentWidth, currentY);
  currentY += 6;

  // เรียน
  doc.setFont('Sarabun', 'bold');
  doc.text('เรียน', leftMargin, currentY);
  doc.setFont('Sarabun', 'normal');
  doc.text(directorPosition, leftMargin + 14, currentY);
  currentY += 7;

  // สิ่งที่แนบมาด้วย
  doc.setFont('Sarabun', 'bold');
  doc.text('สิ่งที่แนบมาด้วย', leftMargin, currentY);
  doc.setFont('Sarabun', 'normal');
  const attachText = `คำสั่งแต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน ภาคเรียนที่ ${semester} ประจำปีการศึกษา ${academicYear}`;
  const attachLines = doc.splitTextToSize(attachText, contentWidth - 28);
  doc.text(attachLines, leftMargin + 28, currentY);
  currentY += (attachLines.length * 6) + 2;

  // --- 3. Memo Body Paragraphs ---
  doc.setFontSize(13);
  const pIndent = '        '; // 8 spaces indent

  // Paragraph 1
  const p1Text = `${pIndent}ด้วย${department} โดย${workGroupName} มีหน้าที่ในการดำเนินการจัดตารางเรียนตารางสอนของครูและนักเรียน${schoolName} ได้จัดทำข้อมูลตารางสอนของคณะครูและนักเรียน${schoolName} เพื่อให้การดำเนินการจัดกิจกรรมการเรียนการสอนของ${schoolName} ภาคเรียนที่ ${semester} ประจำปีการศึกษา ${academicYear} เป็นไปด้วยความเรียบร้อยมีประสิทธิภาพสอดคล้องกับบริบทของโรงเรียน และสอดคล้องกับแนวนโยบายของกระทรวงศึกษาธิการ`;
  const p1Lines = doc.splitTextToSize(p1Text, contentWidth);
  doc.text(p1Lines, leftMargin, currentY);
  currentY += (p1Lines.length * 5.8) + 3;

  // Paragraph 2
  const p2Text = `${pIndent}${workGroupName} จึงได้จัดทำตารางเรียนตารางสอน คำสั่งแต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอนภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear} เพื่อขออนุมัติใช้เป็นแนวทางการปฏิบัติงานในหน้าที่ที่รับผิดชอบให้บังเกิดผลดีต่อราชการต่อไป`;
  const p2Lines = doc.splitTextToSize(p2Text, contentWidth);
  doc.text(p2Lines, leftMargin, currentY);
  currentY += (p2Lines.length * 5.8) + 3;

  // Paragraph 3
  const p3Text = `${pIndent}จึงเรียนมาเพื่อโปรดพิจารณา หากเห็นชอบโปรดลงนาม คำสั่งแต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`;
  const p3Lines = doc.splitTextToSize(p3Text, contentWidth);
  doc.text(p3Lines, leftMargin, currentY);
  currentY += (p3Lines.length * 5.8) + 5;

  // --- 4. Signatures (4 Tiers) ---
  doc.setFontSize(12);

  // Tier 1: Proposer (Right-aligned)
  const rightColumnX = leftMargin + 90;
  doc.text('ลงชื่อ........................................................', rightColumnX, currentY);
  currentY += 5.5;
  doc.text(`( ${proposerName} )`, rightColumnX, currentY);
  currentY += 5;
  doc.text(proposerPosition, rightColumnX, currentY);
  currentY += 7;

  // Tier 2: Two Columns (Reviewer Left, Deputy Director Right)
  const tier2TopY = currentY;
  const leftColX = leftMargin;
  const rightColX = leftMargin + 85;

  // Left: ตรวจเสนอ (Reviewer)
  doc.text('(   ) ตรวจเสนอแล้ว', leftColX, currentY);
  doc.text('(   ) เห็นควรดำเนินการตามเสนอ', leftColX, currentY + 4.5);
  doc.text('ลงชื่อ........................................................', leftColX, currentY + 12);
  doc.text(`( ${reviewerName} )`, leftColX, currentY + 17);
  doc.text(reviewerPosition, leftColX, currentY + 22);

  // Right: ความเห็นรองผู้อำนวยการ (Deputy Director)
  doc.text('(   ) ทราบ', rightColX, currentY);
  doc.text('(   ) เห็นชอบ / เสนอเพื่อโปรดลงนาม', rightColX, currentY + 4.5);
  doc.text('ลงชื่อ........................................................', rightColX, currentY + 12);
  doc.text(`( ${deputyDirectorName} )`, rightColX, currentY + 17);
  doc.text(deputyDirectorPosition, rightColX, currentY + 22);

  currentY = tier2TopY + 28;

  // Tier 3: Director (Bottom Approval)
  const dirColX = leftMargin + 45;
  doc.text('(   ) อนุมัติและลงนามแล้ว            (   ) อื่นๆ ...........................................', leftMargin, currentY);
  currentY += 8;
  doc.text('ลงชื่อ........................................................', dirColX, currentY);
  currentY += 5.5;
  doc.text(`( ${directorName} )`, dirColX, currentY);
  currentY += 5;
  doc.text(directorPosition, dirColX, currentY);

  doc.save(`บันทึกข้อความขออนุมัติคำสั่งสอน_ภาค${semester}_${academicYear}.pdf`);
}

/**
 * 2. Generate "คำสั่งโรงเรียน" (School Order) - A4 Portrait
 */
export function generateSchoolOrderPdf(settings: OrganizationSettings | null): void {
  const doc = createPdfDocument('portrait');

  const schoolName = settings?.name || '................................';
  const orderNumber = settings?.orderNumber || '....... / ..........';
  const semester = settings?.semester || '.....';
  const academicYear = settings?.academicYear || '..........';
  const legalBasisText = settings?.legalBasisText?.trim() || 
    'อาศัยอำนาจตามความในมาตรา 39 (1) แห่งพระราชบัญญัติระเบียบบริหารราชการกระทรวงศึกษาธิการ พ.ศ. 2546 และที่แก้ไขเพิ่มเติม และมาตรา 27 (1) แห่งพระราชบัญญัติระเบียบข้าราชการครูและบุคลากรทางการศึกษา พ.ศ. 2547 และที่แก้ไขเพิ่มเติม ประกอบกับระเบียบกระทรวงศึกษาธิการว่าด้วยการบริหารจัดการและขอบเขตการปฏิบัติหน้าที่ของสถานศึกษาขั้นพื้นฐานที่เป็นนิติบุคคลในสังกัดเขตพื้นที่การศึกษา พ.ศ. 2546';

  const directorName = settings?.directorName || '........................................................';
  const directorPosition = settings?.directorPosition || `ผู้อำนวยการโรงเรียน${schoolName}`;

  const leftMargin = 25;
  const rightMargin = 20;
  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const contentWidth = pageWidth - leftMargin - rightMargin; // 165mm

  let currentY = 22;

  // --- 1. Center Garuda Emblem ---
  if (settings?.emblemUrl) {
    const emblemSize = 26;
    safeAddImage(doc, settings.emblemUrl, (pageWidth - emblemSize) / 2, currentY, emblemSize, emblemSize);
    currentY += 30;
  } else {
    currentY += 15;
  }

  // --- 2. Order Header Titles ---
  doc.setFont('Sarabun', 'bold');
  doc.setFontSize(18);
  doc.text(`คำสั่ง${schoolName}`, pageWidth / 2, currentY, { align: 'center' });
  currentY += 8;

  doc.setFont('Sarabun', 'normal');
  doc.setFontSize(15);
  doc.text(`ที่ ${orderNumber}`, pageWidth / 2, currentY, { align: 'center' });
  currentY += 8;

  doc.setFont('Sarabun', 'bold');
  doc.setFontSize(15);
  doc.text('เรื่อง แต่งตั้งและมอบหมายให้ข้าราชการครูและลูกจ้างปฏิบัติหน้าที่สอน', pageWidth / 2, currentY, { align: 'center' });
  currentY += 7;
  doc.text(`ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`, pageWidth / 2, currentY, { align: 'center' });
  currentY += 5;

  // Separator Line
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(leftMargin, currentY, leftMargin + contentWidth, currentY);
  currentY += 8;

  // --- 3. Order Paragraphs ---
  doc.setFont('Sarabun', 'normal');
  doc.setFontSize(14);
  const pIndent = '        ';

  // Paragraph 1
  const p1Text = `${pIndent}${legalBasisText} เพื่อให้การบริหารสถานศึกษา เกิดประสิทธิภาพและประสิทธิผลสูงสุดทางราชการ จึงแต่งตั้งและมอบหมายหน้าที่ราชการ งานสนับสนุนการสอน ให้ข้าราชการครูและลูกจ้างของ${schoolName}ปฏิบัติหน้าที่สอนภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear} ตามบัญชีแนบท้ายคำสั่งนี้`;
  const p1Lines = doc.splitTextToSize(p1Text, contentWidth);
  doc.text(p1Lines, leftMargin, currentY);
  currentY += (p1Lines.length * 6.2) + 4;

  // Paragraph 2
  const p2Text = `${pIndent}ทั้งนี้ให้ผู้ที่ได้รับการแต่งตั้งให้ปฏิบัติหน้าที่สอนในทุกกลุ่มสาระการเรียนรู้ และงานกิจกรรมพัฒนาผู้เรียน จัดกิจกรรมโฮมรูมให้กับนักเรียนตั้งแต่เวลา 08.00 น. – 08.30 น. ดำเนินการจัดทำแผนการจัดการเรียนรู้ การวัดและประเมินผลการเรียนรู้ ให้เป็นไปตามปฏิทินวิชาการ และปฏิบัติหน้าที่ให้เกิดผลดีต่อนักเรียน โรงเรียนและทางราชการ ต่อไป`;
  const p2Lines = doc.splitTextToSize(p2Text, contentWidth);
  doc.text(p2Lines, leftMargin, currentY);
  currentY += (p2Lines.length * 6.2) + 4;

  // Paragraph 3
  const p3Text = `${pIndent}ทั้งนี้ ตั้งแต่วันที่ ................... เป็นต้นไป`;
  doc.text(p3Text, leftMargin, currentY);
  currentY += 14;

  // --- 4. Date & Director Signature Block ---
  const signColX = leftMargin + 70;
  doc.text('สั่ง ณ วันที่ ......... เดือน ................... พ.ศ. ...........', signColX, currentY);
  currentY += 18;

  doc.text('ลงชื่อ ........................................................', signColX + 15, currentY);
  currentY += 7;
  doc.text(`( ${directorName} )`, signColX + 15, currentY);
  currentY += 6;
  doc.text(directorPosition, signColX + 15, currentY);

  doc.save(`คำสั่งปฏิบัติหน้าที่สอน_ภาค${semester}_${academicYear}.pdf`);
}
