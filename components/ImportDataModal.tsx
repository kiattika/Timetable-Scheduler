

import React, { useState, ChangeEvent, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { AppData, ImportableEntityType, Teacher, Subject, GradeLevel, PhysicalRoom, FormField, SubjectTeachingMode, TeacherSubjectAssignment } from '../types';
import Modal from './Modal';
import { Icons, PREDEFINED_SUBJECT_COLORS } from '../constants';
import { getSampleAppData } from '../api';
// Removed: import { fetchDataFromGoogleSheet } from '../api';

interface ImportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  appData: AppData;
  setAppData: React.Dispatch<React.SetStateAction<AppData>>;
  entityConfigurations: Record<ImportableEntityType, { singular: string; plural: string; fields: FormField[]; getIcon: () => React.ElementType }>;
}

interface ImportResult {
  source: 'excel'; // Simplified: only Excel is supported now
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  messages: string[];
}

const IMPORTABLE_ENTITY_KEYS: ImportableEntityType[] = ['teachers', 'subjects', 'gradeLevels', 'physicalRooms', 'teacherSubjectAssignments'];

const ImportDataModal: React.FC<ImportDataModalProps> = ({ isOpen, onClose, appData, setAppData, entityConfigurations }) => {
  const [selectedEntityType, setSelectedEntityType] = useState<ImportableEntityType>('teachers');
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Removed Google Sheet related state: googleSheetId, googleSheetTabName, isGsProcessing

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
      setImportResult(null); // Reset result when new file is selected
    }
  };

  const currentExpectedColumns = useMemo(() => {
    const config = entityConfigurations[selectedEntityType];
    if (!config || !config.fields) {
        console.error(`Configuration or fields missing for importable entity type: ${selectedEntityType}`);
        return [];
    }
    const fields = config.fields;
    return fields.map(field => {
      let note = field.placeholder || `Enter ${field.label.toLowerCase()}`;
      if (field.type === 'number' && field.name === 'periodsPerWeek') note = 'Numeric value (e.g., 3 or 5).';
      else if (field.type === 'color' && field.name === 'color') note = 'Hex color code (e.g., #FF6B6B). If blank/invalid, a default is assigned.';
      else if (field.name === 'teachingMode') note = "'single' or 'multiple'. Defaults to 'single' if blank/invalid.";
      else if (field.name === 'allowClassroomSharing' || field.name === 'isHomeroomAdvisorySubject' || field.name === 'autoLinkToHomeroomTeachers') note = "Enter 'true' or 'false'. Defaults to 'false' if blank.";
      else if (field.type === 'number') note = 'Numeric value.';
      else if (field.name === 'homeroomGradeLevelIds') note = 'Comma-separated names (e.g., M.1/1, M.1/2).';
      else if (field.name === 'applicableParentGradeLevelIds') note = 'Comma-separated parent names only (e.g., M.1, M.2). Do not use sub-rooms.';
      else if (field.name === 'homeroomClassroomId') note = 'Physical Room Name (e.g., Room 101).';
      else if (selectedEntityType === 'teacherSubjectAssignments') {
        if (field.name === 'teacherIdentifier') note = "Teacher's full name or unique code.";
        if (field.name === 'subjectIdentifier') note = "Subject's full name or unique code.";
        if (field.name === 'gradeLevelName') note = "Full name of the Grade Level (e.g., M.1/1 or M.1).";
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
    
    // Add sample data rows
    if (selectedEntityType === 'teachers') {
        data.push(["อ.สมชาย ใจดี", "T001", "somchai.j@example.com", "คณิตศาสตร์", "ม.1/1, ม.1/2"]);
        data.push(["อ.สมหญิง เก่งมาก", "T002", "somying.k@example.com", "วิทยาศาสตร์", "ม.2/1"]);
    } else if (selectedEntityType === 'subjects') {
        data.push(["คณิตศาสตร์พื้นฐาน", "ค21101", 3, "#FF6B6B", "single", "1/1/1", false, false, false, false, "ม.1, ม.2"]);
        data.push(["กิจกรรมลูกเสือ-เนตรนารี (Broad)", "ลส21101", 1, "#D97706", "single", "1", true, true, false, false, "ม.1"]);
    } else if (selectedEntityType === 'gradeLevels') {
        data.push(["ม.1/1", "ห้อง M.1/1 (HR)"]);
        data.push(["ม.1/2", "ห้อง M.1/2 (HR)"]);
        data.push(["ม.1", undefined]); // Parent grade, no homeroom classroom
    } else if (selectedEntityType === 'physicalRooms') {
        data.push(["ห้อง 101", "ห้องเรียนทั่วไป"]);
        data.push(["ห้องปฏิบัติการวิทย์ 1", "ห้องปฏิบัติการ"]);
    } else if (selectedEntityType === 'teacherSubjectAssignments') {
        data.push(["อ.สมชาย ใจดี", "คณิตศาสตร์พื้นฐาน", "ม.1/1"]);
        data.push(["T002", "ว21201", "ม.1/2"]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, config.plural);
    XLSX.writeFile(wb, `sample_${selectedEntityType}.xlsx`);
  };


  const parseAndProcessSheetData = (
    jsonData: any[][]
  ): ImportResult => {
    if (jsonData.length < 1) { 
        return { source: 'excel', importedCount: 0, skippedCount: 0, errorCount: 0, messages: ["Spreadsheet is empty or contains only a header row."] };
    }
    
    const headersFromFile = (jsonData[0] as string[]).map(h => String(h || '').trim());
    const configForSelectedType = entityConfigurations[selectedEntityType];

    const isHeaderMatch = (fileHeader: string, expectedFieldConfig: FormField) => {
        const fh = fileHeader.toLowerCase().trim();
        const lh = expectedFieldConfig.label.toLowerCase().trim();
        if (fh === lh) return true;
        
        if (expectedFieldConfig.name === 'name') {
            if (selectedEntityType === 'teachers' && (fh === 'name' || fh === 'ชื่อ' || fh === 'ชื่อ-สกุล' || fh === 'ชื่ออาจารย์' || fh === 'teacher name' || fh.includes('ชื่อ'))) return true;
            if (selectedEntityType === 'physicalRooms' && (fh === 'room name' || fh === 'ชื่อห้อง' || fh === 'รหัสห้อง' || fh === 'room number')) return true;
            if (selectedEntityType === 'gradeLevels' && (fh === 'grade' || fh === 'ระดับชั้น' || fh === 'ชื่อชั้น')) return true;
            if (selectedEntityType === 'subjects' && (fh === 'subject name' || fh === 'ชื่อวิชา')) return true;
        }
        if (expectedFieldConfig.name === 'teacherCode' && (fh === 'code' || fh === 'รหัส' || fh === 'รหัสอาจารย์' || fh === 'teacher code')) return true;
        if (expectedFieldConfig.name === 'department' && (fh === 'department' || fh === 'กลุ่มสาระ' || fh === 'หมวด' || fh.includes('สาระ'))) return true;
        if (expectedFieldConfig.name === 'email' && (fh === 'email' || fh === 'อีเมล')) return true;
        if (expectedFieldConfig.name === 'roomType' && selectedEntityType === 'physicalRooms' && (fh === 'room type' || fh === 'ประเภทห้อง')) return true;
        if (expectedFieldConfig.name === 'homeroomClassroomId' && selectedEntityType === 'gradeLevels' && (fh === 'homeroom' || fh === 'รหัสห้องโฮมรูม')) return true;
        if (expectedFieldConfig.name === 'subjectCode' && selectedEntityType === 'subjects' && (fh === 'subject code' || fh === 'รหัสวิชา')) return true;

        return false;
    };

    const missingRequiredHeaders = configForSelectedType.fields
        .filter(col => col.required)
        .filter(col => !headersFromFile.some(fh => isHeaderMatch(fh, col)));

    if (missingRequiredHeaders.length > 0) {
        throw new Error(`Missing required column(s) in the file based on label: ${missingRequiredHeaders.map(h => `'${h.label}'`).join(', ')}. Please ensure headers match the labels shown in 'Manage Data'.`);
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
        } else if (fieldConfig.required) {
            throw new Error(`Required column for field '${fieldConfig.label}' not found in file.`);
        }
    });

    const newItemsToPush: any[] = [];
    let importedCount = 0;
    let skippedCount = 0;
    const messages: string[] = [];
    const dataRows = jsonData.slice(1); 

    dataRows.forEach((rowArray, rowIndex) => {
        if (!Array.isArray(rowArray) || rowArray.every(cell => cell === undefined || cell === null || String(cell).trim() === '')) {
            return; // Skip empty rows
        }
        const newItemData: any = {};
        let hasErrorForRow = false;

        fieldProcessingOrder.forEach(({ internalField, colIndexInFile, config: fieldConfig }) => {
            if (hasErrorForRow) return;
            const rawValue = rowArray[colIndexInFile] !== undefined && rowArray[colIndexInFile] !== null ? String(rowArray[colIndexInFile]).trim() : undefined;
            let processedValue: any = rawValue;

            if (fieldConfig.required && (rawValue === undefined || rawValue === '')) {
                messages.push(`Row ${rowIndex + 2}: Skipped - Missing required value for '${fieldConfig.label}'.`);
                skippedCount++; hasErrorForRow = true; return;
            }

            if (rawValue !== undefined && rawValue !== '') {
                 switch (fieldConfig.type) {
                    case 'number':
                        processedValue = Number(rawValue);
                        if (isNaN(processedValue)) {
                            messages.push(`Row ${rowIndex + 2}: Invalid number for '${fieldConfig.label}'. Value: '${rawValue}'. Skipped.`);
                            skippedCount++; hasErrorForRow = true; return;
                        }
                        break;
                    case 'checkbox':
                        const lowerVal = rawValue.toLowerCase();
                        processedValue = lowerVal === 'true' || lowerVal === 'yes' || lowerVal === '1';
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
                    case 'multiselect': case 'checkboxgroup': 
                        if (internalField === 'homeroomGradeLevelIds' || internalField === 'applicableParentGradeLevelIds') {
                            processedValue = rawValue.split(',').map(name => name.trim()).filter(Boolean);
                        }
                        break;
                    default: processedValue = rawValue;
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
                } else {
                    processedValue = undefined;
                }
            }
            newItemData[internalField] = processedValue;
        });

        if (hasErrorForRow) return;
        
        if (selectedEntityType === 'teachers' && newItemData.homeroomGradeLevelIds) {
            newItemData.homeroomGradeLevelIds = newItemData.homeroomGradeLevelIds.map((name: string) => appData.gradeLevels.find(gl => gl.name === name)?.id).filter(Boolean);
        }
        if (selectedEntityType === 'subjects' && newItemData.applicableParentGradeLevelIds) {
            newItemData.applicableParentGradeLevelIds = newItemData.applicableParentGradeLevelIds.map((name: string) => appData.gradeLevels.find(gl => gl.name === name && !gl.name.includes('/'))?.id).filter(Boolean);
        }
        if (selectedEntityType === 'gradeLevels' && newItemData.homeroomClassroomId) { 
             newItemData.homeroomClassroomId = appData.physicalRooms.find(c => c.name === newItemData.homeroomClassroomId)?.id || undefined;
        }
        
        if (selectedEntityType === 'teacherSubjectAssignments') {
            const teacherIdentifier = newItemData.teacherIdentifier;
            const subjectIdentifier = newItemData.subjectIdentifier;
            const gradeLevelName = newItemData.gradeLevelName;

            const teacher = appData.teachers.find(t => t.name === teacherIdentifier || t.teacherCode === teacherIdentifier);
            const subject = appData.subjects.find(s => s.name === subjectIdentifier || s.subjectCode === subjectIdentifier);
            const gradeLevel = appData.gradeLevels.find(gl => gl.name === gradeLevelName);

            if (!teacher) { messages.push(`Row ${rowIndex + 2}: Teacher '${teacherIdentifier}' not found. Skipped.`); skippedCount++; return; }
            if (!subject) { messages.push(`Row ${rowIndex + 2}: Subject '${subjectIdentifier}' not found. Skipped.`); skippedCount++; return; }
            if (!gradeLevel) { messages.push(`Row ${rowIndex + 2}: Grade Level '${gradeLevelName}' not found. Skipped.`); skippedCount++; return; }
            
            newItemData.teacherId = teacher.id;
            newItemData.subjectId = subject.id;
            newItemData.gradeLevelId = gradeLevel.id;
            newItemData.periodsPerWeek = subject.periodsPerWeek || 0;
            newItemData.department = teacher.department || '';
            delete newItemData.teacherIdentifier;
            delete newItemData.subjectIdentifier;
            delete newItemData.gradeLevelName;
        }


        const finalNewItem = { id: crypto.randomUUID(), ...newItemData };
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

        let isDuplicate = false; 
        switch (selectedEntityType) {
            case 'teachers':
            const teacherItem = finalNewItem as Teacher;
            if (teacherItem.teacherCode && appData.teachers.some(t => t.teacherCode === teacherItem.teacherCode)) isDuplicate = true;
            else if (appData.teachers.some(t => t.name === teacherItem.name)) isDuplicate = true;
            break;
            case 'subjects':
            const subjectItem = finalNewItem as Subject;
            if (subjectItem.subjectCode && appData.subjects.some(s => s.subjectCode === subjectItem.subjectCode)) isDuplicate = true;
            else if (appData.subjects.some(s => s.name === subjectItem.name)) isDuplicate = true;
            break;
            case 'gradeLevels':
            const gradeLevelItem = finalNewItem as GradeLevel;
            if (appData.gradeLevels.some(gl => gl.name === gradeLevelItem.name)) isDuplicate = true;
            break;
            case 'physicalRooms':
            const physicalRoomItem = finalNewItem as any;
            if (appData.physicalRooms?.some(r => r.name === physicalRoomItem.name)) isDuplicate = true;
            break;
            case 'teacherSubjectAssignments':
            const tsaItem = finalNewItem as TeacherSubjectAssignment;
            if (appData.teacherSubjectAssignments.some(tsa => tsa.teacherId === tsaItem.teacherId && tsa.subjectId === tsaItem.subjectId && tsa.gradeLevelId === tsaItem.gradeLevelId)) isDuplicate = true;
            break;
        }

        if (isDuplicate) {
            messages.push(`Row ${rowIndex + 2}: Skipped - ${configForSelectedType.singular} '${finalNewItem.name || finalNewItem.subjectCode || finalNewItem.teacherCode || `Link for ${finalNewItem.teacherId}-${finalNewItem.subjectId}-${finalNewItem.gradeLevelId}`}' already exists.`);
            skippedCount++;
        } else {
            newItemsToPush.push(finalNewItem);
            importedCount++;
        }
    });

    if (newItemsToPush.length > 0) {
        setAppData(prevAppData => {
            if (!prevAppData) return prevAppData; 
            const currentEntityList = prevAppData[selectedEntityType] as any[] || [];
            const updatedEntityList = [...currentEntityList, ...newItemsToPush];
            return { ...prevAppData, [selectedEntityType]: updatedEntityList };
        });
    }
    messages.unshift(`Import from Excel complete: ${importedCount} ${configForSelectedType.plural.toLowerCase()} imported, ${skippedCount} skipped.`);
    return { source: 'excel', importedCount, skippedCount, errorCount: 0, messages };
  };

  const processExcelImport = async () => {
    if (!file) {
      setImportResult({ source: 'excel', importedCount: 0, skippedCount: 0, errorCount: 1, messages: ["No file selected."] });
      return;
    }
    setIsProcessing(true);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("Failed to read file data.");
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { header: 1, blankrows: false });
        
        const result = parseAndProcessSheetData(jsonData);
        setImportResult(result);

      } catch (error: any) {
        console.error("Error processing Excel import:", error);
        setImportResult({ source: 'excel', importedCount: 0, skippedCount: 0, errorCount: 1, messages: [`Error: ${error.message}`] });
      } finally {
        setIsProcessing(false);
        setFile(null); 
        const fileInput = document.getElementById('fileUpload') as HTMLInputElement;
        if (fileInput) fileInput.value = "";
      }
    };
    reader.onerror = () => {
        setIsProcessing(false);
        setImportResult({ source: 'excel', importedCount: 0, skippedCount: 0, errorCount: 1, messages: ["Failed to read the Excel file."] });
    };
    reader.readAsArrayBuffer(file);
  };

  // Removed handleGoogleSheetImport function

  const loadDemoSampleSystemData = () => {
    if (window.confirm("คุณต้องการล้างข้อมูลทั้งหมด และโหลดข้อมูลตัวอย่างลงในแต่ละตารางใช่หรือไม่?\n(ห้องเรียน, รายวิชา, อาจารย์ผู้สอน และตารางเรียนจะถูกตั้งค่าด้วยข้อมูลตัวอย่างระบบ)")) {
      const sampleData = getSampleAppData();

      // 1. Strict Exemption of Core School Metadata
      const currentOrgSettings = appData?.organizationSettings || {};
      const preservedOrgSettings = {
        ...(sampleData.organizationSettings || {}),
        ...currentOrgSettings, // Preserve existing organization settings
        name: currentOrgSettings.name || (sampleData.organizationSettings?.name || "โรงเรียนตัวอย่างพัฒนาการวิทยาา"),
        allowedDomain: currentOrgSettings.allowedDomain || "",
        schoolAdminEmail: currentOrgSettings.schoolAdminEmail || ""
      };

      // 2. Prevent Account Role Overwriting
      const preservedUsers = appData?.users && appData.users.length > 0 ? [...appData.users] : (appData?.currentUser ? [appData.currentUser] : sampleData.users);
      
      const activeUser = appData?.currentUser;
      if (activeUser) {
        const userIndex = preservedUsers.findIndex(u => u.id === activeUser.id || u.email.toLowerCase() === activeUser.email.toLowerCase());
        if (userIndex >= 0) {
          preservedUsers[userIndex] = {
            ...preservedUsers[userIndex],
            role: activeUser.role, // Lock in original role
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

      setAppData(seededData);
      
      // 3. Success Feedback toast summary and alert
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
    // Removed Google Sheet state resets
    setImportResult(null);
    setIsProcessing(false);
    // Removed setIsGsProcessing(false);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleModalClose} title="Import Data from Excel" size="xl">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-grow">
            <label htmlFor="entityTypeSelect" className="block text-sm font-medium text-slate-700 mb-1">
              Select data type to import:
            </label>
            <select
              id="entityTypeSelect"
              value={selectedEntityType}
              onChange={(e) => {
                  setSelectedEntityType(e.target.value as ImportableEntityType);
                  setImportResult(null); 
                  setFile(null); 
                  // Removed Google Sheet state resets
              }}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              disabled={isProcessing}
            >
              {IMPORTABLE_ENTITY_KEYS.map(key => (
                <option key={key} value={key}>
                  {entityConfigurations[key].plural}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={downloadSampleFile}
            className="mt-3 sm:mt-6 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-md border border-blue-300 transition-colors flex items-center w-full sm:w-auto justify-center"
            title={`Download sample Excel for ${entityConfigurations[selectedEntityType].plural}`}
          >
            <Icons.Import size={16} className="mr-2"/> Download Sample for {entityConfigurations[selectedEntityType].singular}
          </button>
        </div>


        <div className="p-4 border border-blue-200 bg-blue-50 rounded-md shrink min-w-0 break-words w-full">
          <h4 className="text-md font-semibold text-blue-700 mb-2">Expected Excel File Format for {entityConfigurations[selectedEntityType].plural}:</h4>
          <p className="text-sm text-blue-600 mb-2">
            Ensure your Excel file has columns with headers matching the field labels from "Manage Data".
          </p>
          <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
            {currentExpectedColumns.map((col, index) => (
              <li key={index}>
                <strong>Header: "{col.header}"</strong> ({col.note})
                {col.required && <span className="text-red-500 font-semibold"> (Required)</span>}
              </li>
            ))}
          </ul>
           <p className="text-xs text-blue-500 mt-3 break-words whitespace-normal leading-relaxed">
            Tip: For best results, ensure column headers in your file exactly match the labels shown (case-insensitive).
            Rows with missing required fields or data for entities that already exist (based on code or name) will be skipped. For Teachers' Homeroom Grades and Subjects' Applicable Parent Grades, provide comma-separated Grade Level names (e.g., "M.1/1, M.1/2"). For Grade Level's Homeroom Physical Room, provide Physical Room Name.
          </p>
        </div>
        
        <fieldset className="border border-slate-300 p-4 rounded-md min-w-0 w-full shrink">
            <legend className="text-md font-semibold text-slate-700 px-2 break-words max-w-full">Import from Excel</legend>
            <div className="mt-2">
                <label htmlFor="fileUpload" className="block text-sm font-medium text-slate-700 mb-1">
                    Upload Excel or CSV file:
                </label>
                <input
                    type="file"
                    id="fileUpload"
                    accept=".xlsx, .xls, .csv"
                    onChange={handleFileChange}
                    className="w-full text-sm text-slate-500
                            file:mr-4 file:py-2 file:px-4
                            file:rounded-md file:border-0
                            file:text-sm file:font-semibold
                            file:bg-blue-50 file:text-blue-700
                            hover:file:bg-blue-100
                            disabled:opacity-50"
                    disabled={isProcessing}
                />
            </div>
            <div className="mt-4 text-right">
                <button
                    type="button"
                    onClick={processExcelImport}
                    disabled={!file || isProcessing}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center ml-auto"
                >
                    {isProcessing ? (
                    <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing Excel...
                    </>
                    ) : (
                    <> <Icons.Import size={18} className="mr-2"/> Import from Excel </>
                    )}
                </button>
            </div>
        </fieldset>

        <fieldset className="border border-indigo-200 bg-indigo-50 p-4 rounded-md min-w-0 w-full shrink mt-4">
            <legend className="text-md font-semibold text-indigo-700 px-2 flex flex-wrap items-center gap-1.5 break-words max-w-full">
                <Icons.Sparkles size={16} className="shrink-0" /> <span className="break-words">โหลดข้อมูลตัวอย่างทดลองระบบ (Quick Load Demo Data)</span>
            </legend>
            <div className="mt-2 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <p className="text-xs text-indigo-800 leading-relaxed max-w-xl break-words whitespace-normal">
                    ระบบจะทำการกรอกข้อมูลตัวอย่างแบบครบถ้วนลงในแต่ละตารางทันที (ได้แก่ ตึกเรียน/ห้องเรียนภาษา-วิทย์, รายวิชา เช่น ฟิสิกส์ คณิตศาสตร์พื้นฐาน คณิตศาสตร์เพิ่มเติม เคมีแล็บ และรายชื่อคณะครูอาจารย์ดร.สมชาย ดร.Smith Ms.Jones) เพื่ออำนวยความสะดวกในการทดสอบฟีเจอร์จัดตารางสอนและจัดพิมพ์ตารางสอนที่จัดเรียงสวยงาม
                </p>
                <button
                    type="button"
                    onClick={loadDemoSampleSystemData}
                    className="w-full md:w-auto px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm transition-colors flex items-center justify-center shrink-0"
                >
                    <Icons.Sparkles size={16} className="mr-2"/> โหลดข้อมูลตัวอย่างระบบ
                </button>
            </div>
        </fieldset>

        {/* Google Sheet Import Section Removed */}

        {importResult && (
          <div className={`mt-4 p-3 rounded-md text-sm ${importResult.errorCount > 0 ? 'bg-red-50 text-red-700 border border-red-200' : (importResult.importedCount > 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200')}`}>
            <h4 className="font-semibold mb-1">Import Summary (from Excel):</h4>
            <ul className="list-disc list-inside max-h-32 overflow-y-auto">
              {importResult.messages.map((msg, index) => (
                <li key={index} className={msg.startsWith("Error:") || msg.includes("Skipped - Missing") ? "text-red-700" : (msg.includes("Skipped") ? "text-amber-700" : "text-green-700")}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10">
          <button
            type="button"
            onClick={handleModalClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
            disabled={isProcessing}
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ImportDataModal;