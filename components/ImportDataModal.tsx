import React, { useState, ChangeEvent, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  AppData, 
  ImportableEntityType, 
  Teacher, 
  Subject, 
  GradeLevel, 
  PhysicalRoom, 
  FormField, 
  SubjectTeachingMode, 
  TeacherSubjectAssignment,
  Department,
  ResourceType 
} from '../types';
import Modal from './Modal';
import { Icons, PREDEFINED_SUBJECT_COLORS } from '../constants';
import { getSampleAppData } from '../api';

interface ImportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  appData: AppData;
  setAppData: React.Dispatch<React.SetStateAction<AppData | null>> | ((data: AppData) => void);
  entityConfigurations: Record<ImportableEntityType, { singular: string; plural: string; fields: FormField[]; getIcon: () => React.ElementType }>;
}

interface ImportResult {
  source: 'excel';
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  messages: string[];
}

const IMPORTABLE_ENTITY_KEYS: ImportableEntityType[] = [
  'teachers', 
  'subjects', 
  'gradeLevels', 
  'classrooms', 
  'physicalRooms', 
  'teacherSubjectAssignments'
];

export const ImportDataModal: React.FC<ImportDataModalProps> = ({ 
  isOpen, 
  onClose, 
  appData, 
  setAppData, 
  entityConfigurations 
}) => {
  const [selectedEntityType, setSelectedEntityType] = useState<ImportableEntityType>('teachers');
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
      setImportResult(null);
    }
  };

  const currentExpectedColumns = useMemo(() => {
    const config = entityConfigurations[selectedEntityType];
    if (!config || !config.fields) {
      return [];
    }
    const fields = config.fields;
    return fields.map(field => {
      let note = field.placeholder || `ระบุ ${field.label}`;
      if (field.type === 'number' && field.name === 'periodsPerWeek') note = 'ตัวเลขจำนวนคาบต่อสัปดาห์ (เช่น 3 หรือ 2)';
      else if (field.type === 'color' && field.name === 'color') note = 'รหัสสี Hex (เช่น #3B82F6) หากไม่ระบุระบบจะสุ่มสีให้';
      else if (field.name === 'teachingMode') note = "'single' (ผู้สอนคนเดียว) หรือ 'multiple' (สอนร่วม). ค่าเริ่มต้น: 'single'";
      else if (field.name === 'allowClassroomSharing' || field.name === 'isBroadAssignment' || field.name === 'isHomeroomAdvisorySubject' || field.name === 'autoLinkToHomeroomTeachers') {
        note = "ระบุ 'true'/'false' หรือ 'ใช่'/'ไม่ใช่'";
      }
      else if (field.name === 'homeroomGradeLevelIds') note = 'ชื่อห้องเรียนคั่นด้วยจุลภาค (เช่น ม.1/1, ม.1/2)';
      else if (field.name === 'applicableParentGradeLevelIds') note = 'ชื่อระดับชั้นหลักคั่นด้วยจุลภาค (เช่น ม.1, ม.2, ม.3)';
      else if (field.name === 'homeroomPhysicalRoomId') note = 'ชื่อหรือรหัสห้องประจำ (เช่น ห้อง 931 หรือ 931)';
      else if (field.name === 'type' && selectedEntityType === 'physicalRooms') note = 'ประเภทห้อง (เช่น ห้องเรียนทั่วไป, ห้องปฏิบัติการ, สนาม/ลานกิจกรรม)';
      else if (field.name === 'capacity') note = 'ตัวเลขความจุ/จำนวนที่นั่ง (เช่น 40)';
      else if (selectedEntityType === 'teacherSubjectAssignments') {
        if (field.name === 'teacherIdentifier') note = "ชื่อ-สกุล หรือรหัสครูผู้สอน (เช่น ดร.สมชาย หรือ T001)";
        if (field.name === 'subjectIdentifier') note = "ชื่อวิชา หรือรหัสวิชา (เช่น คณิตศาสตร์พื้นฐาน หรือ ค21101)";
        if (field.name === 'gradeLevelName') note = "ชื่อระดับชั้นหรือห้องเรียน (เช่น ม.1/1 หรือ ม.1)";
      }
      
      return {
        header: field.label, 
        field: field.name as string, 
        required: field.required,
        type: field.type,
        note: note,
      };
    });
  }, [selectedEntityType, entityConfigurations]);

  const downloadSampleFile = () => {
    const config = entityConfigurations[selectedEntityType];
    const headers = currentExpectedColumns.map(col => col.header);
    const data: (string | number | boolean | undefined)[][] = [headers];
    
    // Add realistic sample data rows
    if (selectedEntityType === 'teachers') {
      data.push(["นายสมชาย ใจดี", "T001", "somchai.j@utd.ac.th", "วิทยาศาสตร์และเทคโนโลยี", "ม.1/1, ม.1/2"]);
      data.push(["นางสาวสมหญิง สดใส", "T002", "somying.s@utd.ac.th", "คณิตศาสตร์", "ม.2/1"]);
    } else if (selectedEntityType === 'subjects') {
      data.push(["คณิตศาสตร์พื้นฐาน 1", "ค21101", 3, "คณิตศาสตร์", "#3B82F6", "single", "2/1", false, false, false, false, "ม.1"]);
      data.push(["วิทยาศาสตร์กายภาพ 1", "ว21101", 3, "วิทยาศาสตร์และเทคโนโลยี", "#10B981", "single", "2/1", false, false, false, false, "ม.1"]);
      data.push(["กิจกรรมลูกเสือ-เนตรนารี", "ก21901", 1, "กิจกรรมพัฒนาผู้เรียน", "#D97706", "single", "1", true, true, false, false, "ม.1, ม.2, ม.3"]);
      data.push(["กิจกรรมโฮมรูมและแนะแนว", "ก21902", 1, "กิจกรรมพัฒนาผู้เรียน", "#8B5CF6", "single", "1", false, false, true, true, "ม.1"]);
    } else if (selectedEntityType === 'gradeLevels') {
      data.push(["ม.1", "", "ชั้นมัธยมศึกษาปีที่ 1"]);
      data.push(["ม.2", "", "ชั้นมัธยมศึกษาปีที่ 2"]);
      data.push(["ม.3", "", "ชั้นมัธยมศึกษาปีที่ 3"]);
    } else if (selectedEntityType === 'classrooms') {
      data.push(["ม.1/1", "ห้อง 931", "ห้องเรียนประจำชั้น ม.1/1 อาคาร 9"]);
      data.push(["ม.1/2", "ห้อง 932", "ห้องเรียนประจำชั้น ม.1/2 อาคาร 9"]);
      data.push(["ม.2/1", "ห้อง 941", "ห้องเรียนประจำชั้น ม.2/1 อาคาร 9"]);
    } else if (selectedEntityType === 'physicalRooms') {
      data.push(["931", "ห้องปฏิบัติการคอมพิวเตอร์ 1", "ห้องปฏิบัติการ", 40]);
      data.push(["932", "ห้องเรียน ม.1/2 อาคาร 9", "ห้องเรียนทั่วไป", 40]);
      data.push(["941", "ห้องเรียน ม.2/1 อาคาร 9", "ห้องเรียนทั่วไป", 40]);
      data.push(["F001", "สนามฟุตบอลและลานกิจกรรม", "สนาม/ลานกิจกรรม", 100]);
    } else if (selectedEntityType === 'teacherSubjectAssignments') {
      data.push(["นายสมชาย ใจดี", "วิทยาศาสตร์กายภาพ 1", "ม.1/1"]);
      data.push(["T002", "ค21101", "ม.1/1"]);
      data.push(["T002", "คณิตศาสตร์พื้นฐาน 1", "ม.1/2"]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, config.plural || selectedEntityType);
    XLSX.writeFile(wb, `sample_${selectedEntityType}.xlsx`);
  };

  const parseAndProcessSheetData = (jsonData: any[][]): ImportResult => {
    if (jsonData.length < 1) { 
      return { 
        source: 'excel', 
        importedCount: 0, 
        skippedCount: 0, 
        errorCount: 0, 
        messages: ["ไฟล์ว่างเปล่า หรือมีเฉพาะแถวหัวตาราง"] 
      };
    }
    
    const headersFromFile = (jsonData[0] as string[]).map(h => String(h || '').trim());
    const configForSelectedType = entityConfigurations[selectedEntityType];

    const isHeaderMatch = (fileHeader: string, expectedFieldConfig: FormField) => {
      const fh = fileHeader.toLowerCase().trim();
      const lh = expectedFieldConfig.label.toLowerCase().trim();
      if (fh === lh) return true;
      
      const fn = expectedFieldConfig.name as string;

      // Check specific field mappings
      if (fn === 'name') {
        if (selectedEntityType === 'teachers' && (fh.includes('ชื่อ') || fh === 'name' || fh === 'teacher name')) return true;
        if (selectedEntityType === 'physicalRooms' && (fh.includes('ชื่อห้อง') || fh.includes('ชื่ออาคาร') || fh === 'room name' || fh === 'name')) return true;
        if (selectedEntityType === 'gradeLevels' && (fh.includes('ระดับชั้น') || fh.includes('ชื่อชั้น') || fh === 'grade' || fh === 'grade level')) return true;
        if (selectedEntityType === 'classrooms' && (fh.includes('ห้องเรียน') || fh.includes('ชื่อห้องเรียน') || fh === 'classroom' || fh === 'room')) return true;
        if (selectedEntityType === 'subjects' && (fh.includes('ชื่อวิชา') || fh === 'subject' || fh === 'subject name' || fh === 'name')) return true;
      }
      if (fn === 'code' && selectedEntityType === 'physicalRooms' && (fh.includes('รหัสห้อง') || fh === 'code' || fh === 'room code' || fh === 'รหัส')) return true;
      if (fn === 'teacherCode' && selectedEntityType === 'teachers' && (fh.includes('รหัสครู') || fh.includes('รหัสอาจารย์') || fh === 'code' || fh === 'teacher code')) return true;
      if (fn === 'subjectCode' && selectedEntityType === 'subjects' && (fh.includes('รหัสวิชา') || fh === 'subject code' || fh === 'code')) return true;
      if (fn === 'department' && (fh.includes('กลุ่มสาระ') || fh.includes('หมวด') || fh.includes('สาระ') || fh === 'department')) return true;
      if (fn === 'email' && (fh.includes('อีเมล') || fh.includes('email') || fh === 'e-mail')) return true;
      if (fn === 'type' && selectedEntityType === 'physicalRooms' && (fh.includes('ประเภทห้อง') || fh.includes('ประเภท') || fh === 'type' || fh === 'room type')) return true;
      if (fn === 'capacity' && selectedEntityType === 'physicalRooms' && (fh.includes('ความจุ') || fh.includes('ที่นั่ง') || fh === 'capacity')) return true;
      if (fn === 'homeroomPhysicalRoomId' && (fh.includes('โฮมรูม') || fh.includes('ห้องประจำ') || fh.includes('ห้องเรียนประจำ') || fh === 'homeroom')) return true;
      if (fn === 'homeroomGradeLevelIds' && (fh.includes('ประจำชั้น') || fh.includes('ที่ปรึกษา') || fh.includes('homeroom grades'))) return true;
      if (fn === 'periodsPerWeek' && (fh.includes('คาบ') || fh.includes('จำนวนคาบ') || fh === 'periods' || fh === 'periods per week')) return true;
      if (fn === 'teachingMode' && (fh.includes('รูปแบบการสอน') || fh === 'teaching mode' || fh === 'mode')) return true;
      if (fn === 'schedulingPattern' && (fh.includes('รูปแบบคาบ') || fh.includes('pattern') || fh === 'scheduling pattern')) return true;
      if (fn === 'allowClassroomSharing' && (fh.includes('แชร์ห้อง') || fh.includes('ใช้ห้องร่วม') || fh === 'allow sharing')) return true;
      if (fn === 'isBroadAssignment' && (fh.includes('เรียนรวม') || fh.includes('broad') || fh === 'broad assignment')) return true;
      if (fn === 'isHomeroomAdvisorySubject' && (fh.includes('โฮมรูม') || fh.includes('แนะแนว') || fh === 'homeroom subject')) return true;
      if (fn === 'autoLinkToHomeroomTeachers' && (fh.includes('ผูกกับครู') || fh.includes('auto link') || fh === 'auto link teachers')) return true;
      if (fn === 'applicableParentGradeLevelIds' && (fh.includes('เปิดสอน') || fh.includes('applicable grades') || fh.includes('ระดับชั้นที่เรียน'))) return true;
      if (fn === 'description' && (fh.includes('คำอธิบาย') || fh.includes('หมายเหตุ') || fh === 'description' || fh === 'notes')) return true;

      if (selectedEntityType === 'teacherSubjectAssignments') {
        if (fn === 'teacherIdentifier' && (fh.includes('ครู') || fh.includes('อาจารย์') || fh === 'teacher' || fh === 'teacher name' || fh === 'teacher code')) return true;
        if (fn === 'subjectIdentifier' && (fh.includes('วิชา') || fh === 'subject' || fh === 'subject name' || fh === 'subject code')) return true;
        if (fn === 'gradeLevelName' && (fh.includes('ชั้น') || fh.includes('ห้อง') || fh === 'grade' || fh === 'classroom' || fh === 'grade level')) return true;
      }

      return false;
    };

    const missingRequiredHeaders = configForSelectedType.fields
      .filter(col => col.required)
      .filter(col => !headersFromFile.some(fh => isHeaderMatch(fh, col)));

    if (missingRequiredHeaders.length > 0) {
      throw new Error(`ไม่พบคอลัมน์บังคับในไฟล์: ${missingRequiredHeaders.map(h => `'${h.label}'`).join(', ')} กรุณาตรวจสอบหัวตารางให้ตรงกับแบบฟอร์ม`);
    }

    const fieldProcessingOrder: { internalField: string, colIndexInFile: number, config: FormField }[] = [];
    configForSelectedType.fields.forEach(fieldConfig => {
      const matchingHeaderIndex = headersFromFile.findIndex(fh => isHeaderMatch(fh, fieldConfig));
      if (matchingHeaderIndex !== -1) {
        fieldProcessingOrder.push({
          internalField: fieldConfig.name as string,
          colIndexInFile: matchingHeaderIndex,
          config: fieldConfig
        });
      }
    });

    const newItemsToPush: any[] = [];
    let importedCount = 0;
    let skippedCount = 0;
    const messages: string[] = [];
    const dataRows = jsonData.slice(1);

    // Track newly discovered departments and resourceTypes to auto-register
    const discoveredDepartments = new Set<string>();
    const discoveredResourceTypes = new Set<string>();

    dataRows.forEach((rowArray, rowIndex) => {
      if (!Array.isArray(rowArray) || rowArray.every(cell => cell === undefined || cell === null || String(cell).trim() === '')) {
        return; // Skip empty row
      }
      const newItemData: any = {};
      let hasErrorForRow = false;

      fieldProcessingOrder.forEach(({ internalField, colIndexInFile, config: fieldConfig }) => {
        if (hasErrorForRow) return;
        const rawValue = rowArray[colIndexInFile] !== undefined && rowArray[colIndexInFile] !== null ? String(rowArray[colIndexInFile]).trim() : undefined;
        let processedValue: any = rawValue;

        if (fieldConfig.required && (rawValue === undefined || rawValue === '')) {
          messages.push(`แถวที่ ${rowIndex + 2}: ข้าม - ไม่ได้ระบุข้อมูลจำเป็นในคอลัมน์ '${fieldConfig.label}'`);
          skippedCount++; 
          hasErrorForRow = true; 
          return;
        }

        if (rawValue !== undefined && rawValue !== '') {
          switch (fieldConfig.type) {
            case 'number':
              processedValue = Number(rawValue);
              if (isNaN(processedValue)) {
                messages.push(`แถวที่ ${rowIndex + 2}: ข้อมูลตัวเลขไม่ถูกต้องสำหรับ '${fieldConfig.label}' (ค่า: '${rawValue}') ข้าม`);
                skippedCount++; 
                hasErrorForRow = true; 
                return;
              }
              break;
            case 'checkbox':
              const lowerVal = rawValue.toLowerCase();
              processedValue = lowerVal === 'true' || lowerVal === 'yes' || lowerVal === '1' || lowerVal === 'ใช่' || lowerVal === 'จริง';
              break;
            case 'color':
              if (selectedEntityType === 'subjects' && fieldConfig.name === 'color') {
                processedValue = /^#[0-9A-F]{6}$/i.test(rawValue) ? rawValue : PREDEFINED_SUBJECT_COLORS[appData.subjects.length % PREDEFINED_SUBJECT_COLORS.length];
              }
              break;
            case 'select':
              if (selectedEntityType === 'subjects' && fieldConfig.name === 'teachingMode') {
                const modeVal = rawValue.toLowerCase();
                processedValue = (modeVal === 'single' || modeVal === 'multiple') ? modeVal as SubjectTeachingMode : 'single';
              }
              break;
            case 'multiselect': 
            case 'checkboxgroup':
              if (internalField === 'homeroomGradeLevelIds' || internalField === 'applicableParentGradeLevelIds') {
                processedValue = rawValue.split(/[,，\n]/).map(name => name.trim()).filter(Boolean);
              }
              break;
            default: 
              processedValue = rawValue;
          }
        } else { 
          if (selectedEntityType === 'subjects') {
            if (fieldConfig.name === 'teachingMode') processedValue = 'single';
            else if (fieldConfig.name === 'allowClassroomSharing' || fieldConfig.name === 'isHomeroomAdvisorySubject' || fieldConfig.name === 'autoLinkToHomeroomTeachers' || fieldConfig.name === 'isBroadAssignment') processedValue = false;
            else if (fieldConfig.name === 'color') processedValue = PREDEFINED_SUBJECT_COLORS[appData.subjects.length % PREDEFINED_SUBJECT_COLORS.length];
            else if (fieldConfig.name === 'schedulingPattern') processedValue = '';
            else if (fieldConfig.name === 'applicableParentGradeLevelIds') processedValue = [];
            else processedValue = undefined;
          } else if (selectedEntityType === 'teachers' && fieldConfig.name === 'homeroomGradeLevelIds') {
            processedValue = [];
          } else if (selectedEntityType === 'physicalRooms' && fieldConfig.name === 'type') {
            processedValue = 'ห้องเรียนทั่วไป';
          } else {
            processedValue = undefined;
          }
        }
        newItemData[internalField] = processedValue;
      });

      if (hasErrorForRow) return;

      // Foreign key / identifier resolution
      if (selectedEntityType === 'teachers') {
        if (newItemData.department) discoveredDepartments.add(newItemData.department);
        if (newItemData.homeroomGradeLevelIds && Array.isArray(newItemData.homeroomGradeLevelIds)) {
          newItemData.homeroomGradeLevelIds = newItemData.homeroomGradeLevelIds.map((name: string) => {
            const match = appData.gradeLevels.find(gl => gl.name.toLowerCase() === name.toLowerCase());
            return match ? match.id : null;
          }).filter(Boolean);
        }
      }

      if (selectedEntityType === 'subjects') {
        if (newItemData.department) discoveredDepartments.add(newItemData.department);
        if (newItemData.applicableParentGradeLevelIds && Array.isArray(newItemData.applicableParentGradeLevelIds)) {
          newItemData.applicableParentGradeLevelIds = newItemData.applicableParentGradeLevelIds.map((name: string) => {
            const match = appData.gradeLevels.find(gl => gl.name.toLowerCase() === name.toLowerCase() && !gl.name.includes('/'));
            return match ? match.id : null;
          }).filter(Boolean);
        }
      }

      if (selectedEntityType === 'gradeLevels' || selectedEntityType === 'classrooms') {
        if (newItemData.homeroomPhysicalRoomId) {
          const roomQuery = String(newItemData.homeroomPhysicalRoomId).toLowerCase().trim();
          const match = appData.physicalRooms.find(r => 
            r.name.toLowerCase() === roomQuery || 
            r.code.toLowerCase() === roomQuery || 
            `ห้อง ${r.code}`.toLowerCase() === roomQuery
          );
          newItemData.homeroomPhysicalRoomId = match ? match.id : undefined;
        }
      }

      if (selectedEntityType === 'physicalRooms') {
        if (newItemData.type) discoveredResourceTypes.add(newItemData.type);
        if (!newItemData.code && newItemData.name) {
          newItemData.code = newItemData.name;
        }
      }

      if (selectedEntityType === 'teacherSubjectAssignments') {
        const teacherIdentifier = String(newItemData.teacherIdentifier || '').trim().toLowerCase();
        const subjectIdentifier = String(newItemData.subjectIdentifier || '').trim().toLowerCase();
        const gradeLevelName = String(newItemData.gradeLevelName || '').trim().toLowerCase();

        const teacher = appData.teachers.find(t => 
          t.name.toLowerCase() === teacherIdentifier || 
          (t.teacherCode && t.teacherCode.toLowerCase() === teacherIdentifier)
        );
        const subject = appData.subjects.find(s => 
          s.name.toLowerCase() === subjectIdentifier || 
          (s.subjectCode && s.subjectCode.toLowerCase() === subjectIdentifier)
        );
        const gradeLevel = appData.gradeLevels.find(gl => 
          gl.name.toLowerCase() === gradeLevelName
        );

        if (!teacher) { 
          messages.push(`แถวที่ ${rowIndex + 2}: ไม่พบข้อมูลครู '${newItemData.teacherIdentifier}' ในระบบ (ข้าม)`); 
          skippedCount++; 
          return; 
        }
        if (!subject) { 
          messages.push(`แถวที่ ${rowIndex + 2}: ไม่พบข้อมูลวิชา '${newItemData.subjectIdentifier}' ในระบบ (ข้าม)`); 
          skippedCount++; 
          return; 
        }
        if (!gradeLevel) { 
          messages.push(`แถวที่ ${rowIndex + 2}: ไม่พบข้อมูลระดับชั้น/ห้องเรียน '${newItemData.gradeLevelName}' ในระบบ (ข้าม)`); 
          skippedCount++; 
          return; 
        }
        
        newItemData.teacherId = teacher.id;
        newItemData.subjectId = subject.id;
        newItemData.gradeLevelId = gradeLevel.id;
        newItemData.periodsPerWeek = subject.periodsPerWeek || 0;
        newItemData.department = teacher.department || subject.department || '';
        delete newItemData.teacherIdentifier;
        delete newItemData.subjectIdentifier;
        delete newItemData.gradeLevelName;
      }

      const finalNewItem = { id: crypto.randomUUID(), ...newItemData };

      // Set explicit defaults
      if (selectedEntityType === 'subjects') {
        if (finalNewItem.teachingMode === undefined) finalNewItem.teachingMode = 'single';
        if (finalNewItem.allowClassroomSharing === undefined) finalNewItem.allowClassroomSharing = false;
        if (finalNewItem.isBroadAssignment === undefined) finalNewItem.isBroadAssignment = false;
        if (finalNewItem.isHomeroomAdvisorySubject === undefined) finalNewItem.isHomeroomAdvisorySubject = false;
        if (finalNewItem.autoLinkToHomeroomTeachers === undefined) finalNewItem.autoLinkToHomeroomTeachers = false;
        if (finalNewItem.applicableParentGradeLevelIds === undefined) finalNewItem.applicableParentGradeLevelIds = [];
      }
      if (selectedEntityType === 'teachers' && finalNewItem.homeroomGradeLevelIds === undefined) {
        finalNewItem.homeroomGradeLevelIds = [];
      }

      // Check duplicates
      let isDuplicate = false; 
      switch (selectedEntityType) {
        case 'teachers': {
          const tItem = finalNewItem as Teacher;
          if (tItem.teacherCode && appData.teachers.some(t => t.teacherCode?.toLowerCase() === tItem.teacherCode?.toLowerCase())) {
            isDuplicate = true;
          } else if (appData.teachers.some(t => t.name.toLowerCase() === tItem.name.toLowerCase())) {
            isDuplicate = true;
          }
          break;
        }
        case 'subjects': {
          const sItem = finalNewItem as Subject;
          if (sItem.subjectCode && appData.subjects.some(s => s.subjectCode?.toLowerCase() === sItem.subjectCode?.toLowerCase())) {
            isDuplicate = true;
          } else if (appData.subjects.some(s => s.name.toLowerCase() === sItem.name.toLowerCase())) {
            isDuplicate = true;
          }
          break;
        }
        case 'gradeLevels':
        case 'classrooms': {
          const glItem = finalNewItem as GradeLevel;
          if (appData.gradeLevels.some(gl => gl.name.toLowerCase() === glItem.name.toLowerCase())) {
            isDuplicate = true;
          }
          break;
        }
        case 'physicalRooms': {
          const prItem = finalNewItem as PhysicalRoom;
          if (appData.physicalRooms?.some(r => 
            (r.code && r.code.toLowerCase() === prItem.code.toLowerCase()) || 
            r.name.toLowerCase() === prItem.name.toLowerCase()
          )) {
            isDuplicate = true;
          }
          break;
        }
        case 'teacherSubjectAssignments': {
          const tsaItem = finalNewItem as TeacherSubjectAssignment;
          if (appData.teacherSubjectAssignments.some(tsa => 
            tsa.teacherId === tsaItem.teacherId && 
            tsa.subjectId === tsaItem.subjectId && 
            tsa.gradeLevelId === tsaItem.gradeLevelId
          )) {
            isDuplicate = true;
          }
          break;
        }
      }

      if (isDuplicate) {
        messages.push(`แถวที่ ${rowIndex + 2}: ข้าม - ${configForSelectedType.singular} '${finalNewItem.name || finalNewItem.subjectCode || finalNewItem.teacherCode || finalNewItem.code || 'รายการนี้'}' มีอยู่ในระบบแล้ว`);
        skippedCount++;
      } else {
        newItemsToPush.push(finalNewItem);
        importedCount++;
      }
    });

    if (newItemsToPush.length > 0) {
      setAppData((prevAppData: AppData | null) => {
        if (!prevAppData) return prevAppData as any;

        // Auto-register new departments
        let updatedDepartments: Department[] = [...(prevAppData.departments || [])];
        discoveredDepartments.forEach(depName => {
          if (!updatedDepartments.some(d => d.name.toLowerCase() === depName.toLowerCase())) {
            updatedDepartments.push({ id: crypto.randomUUID(), name: depName });
          }
        });

        // Auto-register new resource types
        let updatedResourceTypes: ResourceType[] = [...(prevAppData.resourceTypes || [])];
        discoveredResourceTypes.forEach(rtName => {
          if (!updatedResourceTypes.some(r => r.name.toLowerCase() === rtName.toLowerCase())) {
            updatedResourceTypes.push({ id: crypto.randomUUID(), name: rtName });
          }
        });

        if (selectedEntityType === 'classrooms') {
          const currentGradeLevels = prevAppData.gradeLevels || [];
          return {
            ...prevAppData,
            gradeLevels: [...currentGradeLevels, ...newItemsToPush],
            departments: updatedDepartments,
            resourceTypes: updatedResourceTypes
          };
        }

        const currentEntityList = (prevAppData[selectedEntityType as keyof AppData] as any[]) || [];
        return { 
          ...prevAppData, 
          [selectedEntityType]: [...currentEntityList, ...newItemsToPush],
          departments: updatedDepartments,
          resourceTypes: updatedResourceTypes
        };
      });
    }

    messages.unshift(`นำเข้าข้อมูลจาก Excel เสร็จสิ้น: นำเข้าสำเร็จ ${importedCount} รายการ, ข้าม ${skippedCount} รายการ`);
    return { source: 'excel', importedCount, skippedCount, errorCount: 0, messages };
  };

  const processExcelImport = async () => {
    if (!file) {
      setImportResult({ source: 'excel', importedCount: 0, skippedCount: 0, errorCount: 1, messages: ["กรุณาเลือกไฟล์ที่ต้องการนำเข้า"] });
      return;
    }
    setIsProcessing(true);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("ไม่สามารถอ่านข้อมูลในไฟล์ได้");
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, blankrows: false });
        
        const result = parseAndProcessSheetData(jsonData);
        setImportResult(result);

      } catch (error: any) {
        console.error("Error processing Excel import:", error);
        setImportResult({ source: 'excel', importedCount: 0, skippedCount: 0, errorCount: 1, messages: [`ข้อผิดพลาด: ${error.message}`] });
      } finally {
        setIsProcessing(false);
        setFile(null); 
        const fileInput = document.getElementById('fileUpload') as HTMLInputElement;
        if (fileInput) fileInput.value = "";
      }
    };
    reader.onerror = () => {
      setIsProcessing(false);
      setImportResult({ source: 'excel', importedCount: 0, skippedCount: 0, errorCount: 1, messages: ["เกิดข้อผิดพลาดในการอ่านไฟล์ Excel"] });
    };
    reader.readAsArrayBuffer(file);
  };

  const loadDemoSampleSystemData = () => {
    if (window.confirm("คุณต้องการล้างข้อมูลทั้งหมด และโหลดข้อมูลตัวอย่างลงในแต่ละตารางใช่หรือไม่?\n(ห้องเรียน, รายวิชา, อาจารย์ผู้สอน และตารางเรียนจะถูกตั้งค่าด้วยข้อมูลตัวอย่างระบบ)")) {
      const sampleData = getSampleAppData();

      // 1. Strict Exemption of Core School Metadata
      const currentOrgSettings = appData?.organizationSettings || null;
      const preservedOrgSettings = currentOrgSettings ? {
        ...(sampleData.organizationSettings || {}),
        ...currentOrgSettings,
        name: currentOrgSettings.name || (sampleData.organizationSettings?.name || "โรงเรียนตัวอย่างพัฒนาการ"),
        allowedDomain: currentOrgSettings.allowedDomain || "",
        schoolAdminEmail: currentOrgSettings.schoolAdminEmail || ""
      } : sampleData.organizationSettings;

      // 2. Prevent Account Role Overwriting
      const preservedUsers = appData?.users && appData.users.length > 0 ? [...appData.users] : (appData?.currentUser ? [appData.currentUser] : sampleData.users);
      
      const activeUser = appData?.currentUser;
      if (activeUser) {
        const userIndex = preservedUsers.findIndex(u => u.id === activeUser.id || u.email.toLowerCase() === activeUser.email.toLowerCase());
        if (userIndex >= 0) {
          preservedUsers[userIndex] = {
            ...preservedUsers[userIndex],
            role: activeUser.role,
            name: activeUser.name,
            email: activeUser.email,
            assignedDepartments: activeUser.assignedDepartments || preservedUsers[userIndex].assignedDepartments
          };
        } else {
          preservedUsers.push(activeUser);
        }
      }

      const seededData: AppData = {
        ...sampleData,
        organizationSettings: preservedOrgSettings,
        users: preservedUsers,
        currentUser: activeUser || null,
        activityLogs: appData?.activityLogs || []
      };

      setAppData(seededData as any);
      
      setImportResult({
        source: 'excel',
        importedCount: sampleData.teachers.length + sampleData.subjects.length + sampleData.physicalRooms.length,
        skippedCount: 0,
        errorCount: 0,
        messages: ["โหลดข้อมูลตัวอย่างสำเร็จ (ข้อมูลองค์กรและสิทธิ์ผู้ดูแลระบบถูกปกป้องไว้เรียบร้อยแล้ว)"]
      });

      alert("โหลดข้อมูลตัวอย่างสำเร็จ (ข้อมูลองค์กรและสิทธิ์ผู้ดูแลระบบถูกปกป้องไว้เรียบร้อยแล้ว)");
    }
  };

  const handleModalClose = () => {
    setFile(null);
    setImportResult(null);
    setIsProcessing(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleModalClose} title="นำเข้าข้อมูลจาก Excel / CSV (Import Data)" size="xl">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-grow w-full">
            <label htmlFor="entityTypeSelect" className="block text-sm font-medium text-slate-700 mb-1">
              เลือกประเภทข้อมูลที่ต้องการนำเข้า:
            </label>
            <select
              id="entityTypeSelect"
              value={selectedEntityType}
              onChange={(e) => {
                setSelectedEntityType(e.target.value as ImportableEntityType);
                setImportResult(null); 
                setFile(null); 
              }}
              className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 shadow-sm text-sm"
              disabled={isProcessing}
            >
              {IMPORTABLE_ENTITY_KEYS.map(key => (
                <option key={key} value={key}>
                  {entityConfigurations[key]?.plural || key}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={downloadSampleFile}
            className="mt-2 sm:mt-6 px-4 py-2.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors flex items-center w-full sm:w-auto justify-center shrink-0 shadow-sm"
            title={`ดาวน์โหลดไฟล์ตัวอย่างสำหรับ ${entityConfigurations[selectedEntityType]?.plural || selectedEntityType}`}
          >
            <Icons.Import size={16} className="mr-2"/> ดาวน์โหลดไฟล์ตัวอย่าง ({entityConfigurations[selectedEntityType]?.singular || selectedEntityType})
          </button>
        </div>

        <div className="p-4 border border-blue-200 bg-blue-50/70 rounded-xl shrink min-w-0 break-words w-full">
          <h4 className="text-sm font-semibold text-blue-800 mb-2">
            รูปแบบคอลัมน์ Excel ที่รองรับสำหรับ {entityConfigurations[selectedEntityType]?.plural || selectedEntityType}:
          </h4>
          <p className="text-xs text-blue-700 mb-3">
            ไฟล์ Excel/CSV ควรมีหัวตารางที่ตรงกับชื่อคอลัมน์ด้านล่างนี้ (ระบบรองรับทั้งภาษาไทยและภาษาอังกฤษ):
          </p>
          <ul className="list-disc list-inside text-xs text-slate-700 space-y-1.5">
            {currentExpectedColumns.map((col, index) => (
              <li key={index}>
                <strong className="text-slate-800">"{col.header}"</strong> <span className="text-slate-600">({col.note})</span>
                {col.required && <span className="text-red-500 font-semibold"> *จำเป็น</span>}
              </li>
            ))}
          </ul>
        </div>
        
        <fieldset className="border border-slate-200 p-5 rounded-xl min-w-0 w-full shrink bg-white shadow-sm">
          <legend className="text-sm font-semibold text-slate-700 px-2">อัปโหลดไฟล์ Excel / CSV</legend>
          <div className="mt-2">
            <label htmlFor="fileUpload" className="block text-xs font-medium text-slate-600 mb-1.5">
              เลือกไฟล์ (.xlsx, .xls, .csv):
            </label>
            <input
              type="file"
              id="fileUpload"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              className="w-full text-sm text-slate-500
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-lg file:border-0
                      file:text-xs file:font-semibold
                      file:bg-blue-50 file:text-blue-700
                      hover:file:bg-blue-100
                      disabled:opacity-50 border border-slate-200 rounded-lg p-1"
              disabled={isProcessing}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={processExcelImport}
              disabled={!file || isProcessing}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center"
            >
              {isProcessing ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังประมวลผลไฟล์...
                </>
              ) : (
                <>
                  <Icons.Import size={18} className="mr-2"/> นำเข้าข้อมูล (Import)
                </>
              )}
            </button>
          </div>
        </fieldset>

        <fieldset className="border border-indigo-200 bg-indigo-50/60 p-4 rounded-xl min-w-0 w-full shrink mt-4">
          <legend className="text-sm font-semibold text-indigo-700 px-2 flex items-center gap-1.5">
            <Icons.Sparkles size={16} className="shrink-0" /> <span>โหลดข้อมูลตัวอย่างทดลองระบบ (Quick Load Demo Data)</span>
          </legend>
          <div className="mt-1 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <p className="text-xs text-indigo-900 leading-relaxed max-w-xl">
              ระบบจะทำการเติมข้อมูลตัวอย่างแบบครบถ้วนลงในตารางทั้งหมดทันที (อาคารสถานที่, รายวิชา, รายชื่อครูอาจารย์, โครงสร้างชั้นเรียน และตารางสอน)
            </p>
            <button
              type="button"
              onClick={loadDemoSampleSystemData}
              className="w-full md:w-auto px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors flex items-center justify-center shrink-0"
            >
              <Icons.Sparkles size={15} className="mr-1.5"/> โหลดข้อมูลตัวอย่างระบบ
            </button>
          </div>
        </fieldset>

        {importResult && (
          <div className={`mt-4 p-4 rounded-xl text-xs ${importResult.errorCount > 0 ? 'bg-red-50 text-red-700 border border-red-200' : (importResult.importedCount > 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200')}`}>
            <h4 className="font-semibold text-sm mb-1.5 flex items-center gap-1.5">
              {importResult.errorCount > 0 ? <Icons.AlertTriangle className="w-4 h-4 text-red-500" /> : <Icons.CheckCircle className="w-4 h-4 text-emerald-600" />}
              สรุปผลการนำเข้าข้อมูล:
            </h4>
            <ul className="list-disc list-inside max-h-40 overflow-y-auto space-y-1">
              {importResult.messages.map((msg, index) => (
                <li key={index} className={msg.startsWith("ข้อผิดพลาด:") || msg.includes("ข้าม - ไม่ได้ระบุ") ? "text-red-700 font-medium" : (msg.includes("ข้าม") ? "text-amber-700" : "text-emerald-700")}>
                  {msg}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 z-10 rounded-b-xl">
          <button
            type="button"
            onClick={handleModalClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors shadow-sm"
            disabled={isProcessing}
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ImportDataModal;
