import { formatRoomDisplay } from "../utils/stringUtils";

import React, { useState, useEffect, useMemo } from 'react';
// Fix: Ensure all types used from appData for optionsSource are correctly typed to have a 'name' property.
import { AppData, Entity, EntityType, FormField, Identifiable, Subject as SubjectType, Teacher as TeacherType, SubjectTeachingMode, ScreenAccessProps, GradeLevel as GradeLevelType, PhysicalRoom as ClassroomType, TeacherSubjectAssignment, Teacher, Subject, GradeLevel, PhysicalRoom, ScheduleEntry } from '../types'; // Renamed Subject to avoid conflict
import Modal from './Modal';
import ConfirmationModal from './ConfirmationModal'; // Import ConfirmationModal
import { Icons, PREDEFINED_SUBJECT_COLORS } from '../constants';
import { getParentGradeLevelId, isParentGrade as checkIsParentGradeUtil, getChildGradeLevelIds } from './scheduleUtils'; // Import from new utils file


interface EntityManagementScreenProps<T extends Identifiable> extends ScreenAccessProps {
  entityType: EntityType;
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  formFields: FormField[];
  entityNameSingular: string;
  entityNamePlural: string;
  getIcon: (type: EntityType) => React.ElementType;
  appData: AppData; 
  setAppData?: React.Dispatch<React.SetStateAction<AppData>>; // Added for subject auto-linking
}

const EntityManagementScreen = <T extends Identifiable,>({
  entityType,
  items,
  setItems,
  formFields,
  entityNameSingular,
  entityNamePlural,
  getIcon,
  appData, 
  setAppData, // Added for subject auto-linking
  permissions,
  googleAccessToken,
}: EntityManagementScreenProps<T>) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<Partial<T> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRoomType, setSelectedRoomType] = useState('');
  
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const [itemToDeleteId, setItemToDeleteId] = useState<string | null>(null);

  const [isConfirmSubmitModalOpen, setIsConfirmSubmitModalOpen] = useState(false);
   const [isConfirmCancelModalOpen, setIsConfirmCancelModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [isBulkPasteModalOpen, setIsBulkPasteModalOpen] = useState(false);
  const [bulkPasteClassroom, setBulkPasteClassroom] = useState<GradeLevel | null>(null);
  const [isSyncingStudents, setIsSyncingStudents] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState('กำลังซิงค์ข้อมูล...');

  // For PhysicalRoom Bulk Paste
  const [pasteText, setPasteText] = useState('');
  const [parsedStudents, setParsedStudents] = useState<{id: string, email: string, fullName: string}[]>([]);
  const [isResolvingStudents, setIsResolvingStudents] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [selectedTeacherEmails, setSelectedTeacherEmails] = useState<string[]>([]);
  const [isSyncingTeachers, setIsSyncingTeachers] = useState(false);
  const [isInitialSyncDone, setIsInitialSyncDone] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (toastMessage) {
        const timer = setTimeout(() => setToastMessage(null), 5000);
        return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Determine standard HR/CZ subjects to auto-link
  const hrCzSubjects = useMemo(() => {
    if (!appData) return [];
    return appData.subjects.filter(s => 
        s.autoLinkToHomeroomTeachers || 
        s.subjectCode === 'HR' || 
        s.subjectCode === 'CZ' ||
        s.name.includes('โฮมรูม') ||
        s.name.includes('เขตพื้นที่') ||
        s.isHomeroomAdvisorySubject
    );
  }, [appData?.subjects]);

  useEffect(() => {
    if (!pasteText) {
      setParsedStudents([]);
      setResolveError(null);
      return;
    }

    const ids = pasteText.split('\n')
       .map(line => line.trim())
       .filter(line => line.length > 0);
       
    if (ids.length === 0) {
      setParsedStudents([]);
      setResolveError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsResolvingStudents(true);
      setResolveError(null);
      try {
        const liveToken = googleAccessToken || localStorage.getItem('googleAccessToken');
        if (!liveToken) {
           setResolveError("ไม่พบสิทธิ์การใช้งาน Google Group สำหรับบัญชีนี้ กรุณาลงชื่อเข้าใช้งานใหม่อีกครั้ง");
           // Removed setParsedStudents([]) so it doesn't wipe state on token loss
           return;
        }

        const response = await fetch('/api/workspace/directory/resolve-users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${liveToken}`,
                'X-User-Email': appData.currentUser?.email || '',
                'X-Authorized-Admins': JSON.stringify(appData.authorizedAdmins || [])
            },
            body: JSON.stringify({ userIds: ids })
        });
        
        let data;
        try {
          const text = await response.text();
          try {
            data = JSON.parse(text);
          } catch (e) {
            data = { error: text || response.statusText || 'Invalid JSON response from server' };
          }
        } catch (e) {
          data = { error: response.statusText || 'Failed to read response body' };
        }
        
        if (response.ok) {
            if (data.users) {
                setParsedStudents(data.users);
            } else {
                setParsedStudents([]);
            }
        } else {
            if (response.status === 403) {
                setResolveError("ไม่พบสิทธิ์การใช้งาน Google Group สำหรับบัญชีนี้ กรุณาลงชื่อเข้าใช้งานใหม่อีกครั้ง");
            } else {
                setResolveError(`Google API Error: ${data.error || response.statusText}`);
                window.alert(`Google API Error: ${data.error || response.statusText}`);
            }
        }
      } catch (error: any) {
        console.error('Error resolving students:', error);
        setResolveError(`Google API Error: ${error.message}`);
        window.alert(`Google API Error: ${error.message}`);
      } finally {
        setIsResolvingStudents(false);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [pasteText, googleAccessToken]);

  const handleBatchInsertGoogleGroup = async (students: {id: string, email: string, fullName: string}[]) => {
    if (!bulkPasteClassroom || !bulkPasteClassroom.groupEmail) {
      alert('กรุณากรอกและบันทึกอีเมลกลุ่มรายห้อง (Student Group Email) ก่อนทำการเพิ่มสมาชิกเข้า Google Group');
      return;
    }
    const confirmed = window.confirm(`คุณต้องการเพิ่มนักเรียนทั้งหมด ${students.length} คน เข้ากลุ่ม ${bulkPasteClassroom.groupEmail} ใช่หรือไม่?\n\nคำเตือน: การดำเนินการนี้จะลบตารางเรียนเดิมในปฏิทินของนักเรียนและแทนที่ด้วยตารางเรียนเวอร์ชันล่าสุด ยืนยันหรือไม่?`);
    if (!confirmed) return;

    // Generate real events
    const generatedEvents: any[] = [];
    const classEntries = appData?.scheduleEntries?.filter(e => e.gradeLevelId === bulkPasteClassroom.id) || [];
    if (appData?.periodSettings) {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
        const baseDate = new Date(today);
        baseDate.setDate(today.getDate() + daysUntilNextMonday);
        baseDate.setHours(0,0,0,0);
        
        const dayMap: Record<string, number> = {
            'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4, 'Saturday': 5, 'Sunday': 6
        };

        classEntries.forEach(entry => {
            const period = appData.periodSettings[entry.period];
            if (!period) return;
            const offset = dayMap[entry.day] || 0;
            const evDate = new Date(baseDate);
            evDate.setDate(evDate.getDate() + offset);
            
            const [startH, startM] = period.startTime.split(':');
            const [endH, endM] = period.endTime.split(':');
            const start = new Date(evDate); start.setHours(parseInt(startH), parseInt(startM));
            const end = new Date(evDate); end.setHours(parseInt(endH), parseInt(endM));
            
            const subject = appData.subjects.find(s => s.id === entry.subjectId);
            const teacherNames = entry.teacherIds.map(tid => appData.teachers.find(t => t.id === tid)?.name).filter(Boolean).join(', ');
            const teacherEmails = entry.teacherIds.map(tid => appData.teachers.find(t => t.id === tid)?.email).filter(Boolean);
            const roomObj = appData.physicalRooms.find(r => r.id === entry.physicalRoomId);
            
            const roomLocation = roomObj ? (roomObj.code ? `[${roomObj.code}] ${roomObj.name}` : roomObj.name) : '';
            const subjectTitle = subject ? (subject.subjectCode ? `[${subject.subjectCode}] ${subject.name}` : subject.name) : 'Class';
            
            
            const primaryTeacherEmail = teacherEmails && teacherEmails.length > 0 ? teacherEmails[0] : null;
            if (primaryTeacherEmail) {
                generatedEvents.push({
                    targetTeacherEmail: primaryTeacherEmail,

                summary: subjectTitle,
                description: `Teacher(s): ${teacherNames}`,
                location: roomLocation,
                start: start.toISOString(),
                end: end.toISOString(),
                teacherEmails: teacherEmails
            });
            }
        });
    }

    setIsSyncingStudents(true);
    try {
      const emails = students.map(s => s.email);
      const liveToken = googleAccessToken || localStorage.getItem('googleAccessToken');
      if (!liveToken) {
          throw new Error("ไม่พบสิทธิ์การใช้งาน Google Group สำหรับบัญชีนี้ กรุณาลงชื่อเข้าใช้งานใหม่อีกครั้ง");
      }

      setSyncStatusText("กำลังตรวจสอบและอัปเดตกลุ่มอีเมล...");
      // Task A: Google Groups
      const groupResponse = await fetch('/api/workspace/directory/batch-insert', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${liveToken}`,
          'X-User-Email': appData.currentUser?.email || '',
                            'X-Authorized-Admins': JSON.stringify(appData.authorizedAdmins || [])
        },
        body: JSON.stringify({
          groupEmail: bulkPasteClassroom.groupEmail,
          memberEmails: emails,
          classroomName: bulkPasteClassroom.name
        })
      });

      let groupData;
      try {
         const text = await groupResponse.text();
         try {
           groupData = JSON.parse(text);
         } catch (e) {
           groupData = { error: text || groupResponse.statusText };
         }
      } catch (e) {
         groupData = { error: groupResponse.statusText };
      }

      if (!groupResponse.ok) {
         if (groupResponse.status === 403) {
             throw new Error("ไม่พบสิทธิ์การใช้งาน Google Group สำหรับบัญชีนี้ กรุณาลงชื่อเข้าใช้งานใหม่อีกครั้ง");
         }
         throw new Error(`[${groupResponse.status}] ${groupData.error || 'Failed to sync members to group'}`);
      }

      setSyncStatusText("กำลังอัปเดตปฏิทินนักเรียน...");
      // Task B: Google Calendar for Students
      const calendarResponse = await fetch('/api/workspace/calendar/sync-students', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${liveToken}`,
          'X-User-Email': appData.currentUser?.email || '',
                            'X-Authorized-Admins': JSON.stringify(appData.authorizedAdmins || [])
        },
        body: JSON.stringify({
          students: students,
          classroomName: bulkPasteClassroom.name,
          groupEmail: bulkPasteClassroom.groupEmail,
          events: generatedEvents,
          semesterEndDate: appData?.organizationSettings?.semesterEndDate
        })
      });

      let calData;
      try {
          const text = await calendarResponse.text();
          try {
            calData = JSON.parse(text);
          } catch (e) {
            calData = { error: text || calendarResponse.statusText };
          }
      } catch (e) {
          calData = { error: calendarResponse.statusText };
      }

      if (!calendarResponse.ok) {
         if (calendarResponse.status === 403) {
             throw new Error("ไม่พบสิทธิ์การใช้งาน Google Calendar สำหรับบัญชีนี้ กรุณาลงชื่อเข้าใช้งานใหม่อีกครั้ง");
         }
         throw new Error(`[${calendarResponse.status}] ${calData.error || 'Failed to sync student calendars'}`);
      }

      if (!isInitialSyncDone) {
          alert('นำเข้าข้อมูลนักเรียนเรียบร้อยแล้ว');
          setIsInitialSyncDone(true);
      } else {
          alert('อัพเดทตารางเรียนลงปฏิทินเรียบร้อยแล้ว');
      }
      // Removed setPasteText('') and modal close so list is retained
    } catch (e: any) {
      if (e.message.includes('เซสชันหมดอายุ') || e.message.includes('401')) {
          localStorage.removeItem('googleAccessToken');
      }
      alert(`เกิดข้อผิดพลาด: ${e.message}`);
    } finally {
      setIsSyncingStudents(false);
    }
  };

  const openBulkPasteModal = (classroom: GradeLevel) => {
    setBulkPasteClassroom(classroom);
    const savedPasteText = localStorage.getItem(`studentPasteText_${classroom.id}`);
    setPasteText(savedPasteText || '');
    setIsBulkPasteModalOpen(true);
  };


  const IconComponent = getIcon(entityType);

  useEffect(() => {
    if (currentItem && entityType === 'subjects') {
      const subjectItem = currentItem as Partial<SubjectType>;
      if (!subjectItem.color) {
        const usedColors = (items as unknown as SubjectType[]).map(s => s.color);
        const availableColor = PREDEFINED_SUBJECT_COLORS.find(c => !usedColors.includes(c)) || PREDEFINED_SUBJECT_COLORS[0];
        setCurrentItem(prev => ({ ...prev, color: availableColor } as Partial<T>));
      }
      if (!subjectItem.teachingMode) { 
          setCurrentItem(prev => ({ ...prev, teachingMode: 'single' } as Partial<T>));
      }
      if (subjectItem.schedulingPattern === undefined) { 
          setCurrentItem(prev => ({ ...prev, schedulingPattern: '' } as Partial<T>));
      }
      if (subjectItem.allowClassroomSharing === undefined) { 
          setCurrentItem(prev => ({ ...prev, allowClassroomSharing: false } as Partial<T>));
      }
      if (subjectItem.isHomeroomAdvisorySubject === undefined) { 
          setCurrentItem(prev => ({ ...prev, isHomeroomAdvisorySubject: false } as Partial<T>));
      }
      if (subjectItem.autoLinkToHomeroomTeachers === undefined) {
        setCurrentItem(prev => ({ ...prev, autoLinkToHomeroomTeachers: false } as Partial<T>));
      }
      if (subjectItem.applicableParentGradeLevelIds === undefined) { // Initialize new field
        setCurrentItem(prev => ({ ...prev, applicableParentGradeLevelIds: [] } as Partial<T>));
      }
    }
  }, [currentItem, entityType, items]);

  const openModalForNew = () => {
    const initialItem: Partial<T> = formFields.reduce((acc, field) => {
      if (field.type === 'color' && entityType === 'subjects') {
        const usedColors = (items as unknown as SubjectType[]).map(s => s.color);
        const availableColor = PREDEFINED_SUBJECT_COLORS.find(c => !usedColors.includes(c)) || PREDEFINED_SUBJECT_COLORS[0];
        (acc as any)[field.name] = availableColor;
      } else if (field.name === 'teachingMode' && entityType === 'subjects') {
        (acc as any)[field.name] = 'single' as SubjectTeachingMode; 
      } else if (field.name === 'schedulingPattern' && entityType === 'subjects') {
        (acc as any)[field.name] = '';
      } else if (field.name === 'allowClassroomSharing' && entityType === 'subjects') {
        (acc as any)[field.name] = false; 
      } else if (field.name === 'isHomeroomAdvisorySubject' && entityType === 'subjects') {
        (acc as any)[field.name] = false; 
      } else if (field.name === 'autoLinkToHomeroomTeachers' && entityType === 'subjects') {
        (acc as any)[field.name] = false;
      } else if (field.name === 'applicableParentGradeLevelIds' && entityType === 'subjects') { // Initialize new field
        (acc as any)[field.name] = [];
      } else if (field.type === 'number') {
        (acc as any)[field.name] = ''; 
      } else if (field.type === 'checkbox') {
        (acc as any)[field.name] = false; 
      } else if (field.type === 'multiselect' && entityType === 'teachers' && field.name === 'homeroomGradeLevelIds') {
        (acc as any)[field.name] = []; 
      } else if (field.type === 'checkboxgroup') { // Initialize checkboxgroup
        (acc as any)[field.name] = [];
      } else if (entityType === 'gradeLevels' && field.name === 'homeroomPhysicalRoomId') { 
        (acc as any)[field.name] = '';
      } else if (entityType === 'teachers' && field.name === 'email') {
        (acc as any)[field.name] = '';
      }
       else {
        (acc as any)[field.name] = '';
      }
      return acc;
    }, {} as Partial<T>);

    setCurrentItem(initialItem);
    setEditingId(null);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openModalForEdit = (item: T) => {
    let itemToEdit: Partial<T> = { ...item };
    if (entityType === 'subjects') {
        if (!('teachingMode' in itemToEdit) || itemToEdit.teachingMode === undefined) {
            (itemToEdit as Partial<SubjectType>).teachingMode = 'single';
        }
        if (!('schedulingPattern' in itemToEdit) || itemToEdit.schedulingPattern === undefined) {
            (itemToEdit as Partial<SubjectType>).schedulingPattern = '';
        }
        if (!('allowClassroomSharing' in itemToEdit) || itemToEdit.allowClassroomSharing === undefined) {
            (itemToEdit as Partial<SubjectType>).allowClassroomSharing = false;
        }
        if (!('isHomeroomAdvisorySubject' in itemToEdit) || itemToEdit.isHomeroomAdvisorySubject === undefined) {
            (itemToEdit as Partial<SubjectType>).isHomeroomAdvisorySubject = false;
        }
        if (!('autoLinkToHomeroomTeachers' in itemToEdit) || itemToEdit.autoLinkToHomeroomTeachers === undefined) {
            (itemToEdit as Partial<SubjectType>).autoLinkToHomeroomTeachers = false;
        }
        if (!('applicableParentGradeLevelIds' in itemToEdit) || itemToEdit.applicableParentGradeLevelIds === undefined) { // Initialize new field for edit
            (itemToEdit as Partial<SubjectType>).applicableParentGradeLevelIds = [];
        }
    }
    if (entityType === 'teachers') {
        if (!('homeroomGradeLevelIds' in itemToEdit) || itemToEdit.homeroomGradeLevelIds === undefined) {
            (itemToEdit as Partial<TeacherType>).homeroomGradeLevelIds = [];
        }
        if (!('email' in itemToEdit) || itemToEdit.email === undefined) {
            (itemToEdit as Partial<TeacherType>).email = '';
        }
    }
    if (entityType === 'gradeLevels') {
        if (!('homeroomPhysicalRoomId' in itemToEdit) || itemToEdit.homeroomPhysicalRoomId === undefined) {
            (itemToEdit as Partial<GradeLevelType>).homeroomPhysicalRoomId = '';
        }
    }
    setCurrentItem(itemToEdit);
    setEditingId(item.id);
    setFormError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setCurrentItem(null);
    setEditingId(null);
    setFormError(null);
  };

  const requestDelete = (id: string) => {
    if (!permissions.canPerformManagerActions) {
      alert(`เฉพาะผู้จัดการเท่านั้นที่สามารถลบ ${entityNameSingular.toLowerCase()} ได้`);
      return;
    }
    setItemToDeleteId(id);
    setIsConfirmDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (itemToDeleteId) {
      setItems(prevItems => prevItems.filter(item => item.id !== itemToDeleteId));
    }
    setIsConfirmDeleteModalOpen(false);
    setItemToDeleteId(null);
  };

  const validateForm = (): boolean => {
    setFormError(null);
    if (!currentItem) return false;

    const anItem = currentItem as any;

    for (const field of formFields) {
        const isFieldDisabled = field.disabled ? field.disabled(currentItem, appData) : false;
        if (isFieldDisabled) continue; 

        if (field.required && (anItem[field.name] === undefined || String(anItem[field.name]).trim() === '' || (Array.isArray(anItem[field.name]) && anItem[field.name].length === 0))) {
            setFormError(`${field.label} is required.`);
            return false;
        }
        if (field.type === 'number' && anItem[field.name] !== '' && anItem[field.name] !== undefined) {
            const numVal = Number(anItem[field.name]);
            if (isNaN(numVal)) {
                setFormError(`${field.label} must be a valid number.`);
                return false;
            }
        }
        if (field.type === 'email' && anItem[field.name] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(anItem[field.name])) {
            setFormError(`Please enter a valid email address for ${field.label}.`);
            return false;
        }
    }
    
    if (entityType === 'subjects') {
      const subjectItem = currentItem as Partial<SubjectType>;
      let periodsPerWeekNum: number | undefined = undefined;

      if (subjectItem.periodsPerWeek !== undefined && String(subjectItem.periodsPerWeek).trim() !== '') {
        const tempNum = Number(subjectItem.periodsPerWeek);
        if (isNaN(tempNum)) {
          setFormError('Periods Per Week must be a valid number.');
          return false;
        }
        if (tempNum <= 0) { 
            setFormError('Periods Per Week must be a positive number if specified.');
            return false;
        }
        periodsPerWeekNum = tempNum;
      }

      if (subjectItem.schedulingPattern && subjectItem.schedulingPattern.trim() !== '') {
        const pattern = subjectItem.schedulingPattern.trim();
        const parts = pattern.split('/');
        let sumOfParts = 0;
        let isValidPattern = true;

        for (const part of parts) {
          const num = parseInt(part, 10);
          if (isNaN(num) || num <= 0) {
            isValidPattern = false;
            break;
          }
          sumOfParts += num;
        }

        if (!isValidPattern) {
          setFormError('Scheduling Pattern must be numbers separated by "/" (e.g., "2/1/1"). Each part must be a positive number.');
          return false;
        }

        if (periodsPerWeekNum !== undefined) { 
            if (sumOfParts !== periodsPerWeekNum) {
                setFormError(`The sum of parts in Scheduling Pattern (${sumOfParts}) must equal Periods Per Week (${periodsPerWeekNum}).`);
                return false;
            }
        } else { 
            if (sumOfParts > 0) { 
                setFormError(`Periods Per Week must be defined and be a positive number if Scheduling Pattern is used.`);
                return false;
            }
        }
      }
    }
    return true;
  }

  const handleRequestSubmit = () => {
    if (validateForm()) {
      setIsConfirmSubmitModalOpen(true);
    }
  };
  
  const executeSubmit = () => {
    if (!currentItem) return;

    let processedItem = { ...currentItem };
    
    if (entityType === 'subjects' && (processedItem as any).type === 'STUDENT_ONLY') {
      (processedItem as any).allowPhysicalRoomSharing = true;
    }

    // Sanitize applicableParentGradeLevelIds to ensure no sub-rooms leak into the data
    if (entityType === 'subjects' && Array.isArray((processedItem as any).applicableParentGradeLevelIds)) {
      (processedItem as any).applicableParentGradeLevelIds = ((processedItem as any).applicableParentGradeLevelIds as string[])
        .filter(id => {
          const gl = appData?.gradeLevels.find(g => g.id === id);
          return gl && !gl.name.includes('/');
        });
    }

    formFields.forEach(field => {
      if (field.type === 'number' && (processedItem as any)[field.name] !== '' && (processedItem as any)[field.name] !== undefined) {
        (processedItem as any)[field.name] = Number((processedItem as any)[field.name]);
      } else if (field.type === 'number' && ((processedItem as any)[field.name] === '' || (processedItem as any)[field.name] === undefined)) {
        (processedItem as any)[field.name] = undefined; 
      }
    });
    
    // Conflict Validation Check for Homeroom Shifts
    let scheduleEntriesToMigrate: ScheduleEntry[] = [];
    let newRoomIdForMigration: string | null = null;
    let oldRoomIdForMigration: string | null = null;

    if (entityType === 'teachers' && editingId && appData) {
        const oldTeacher = appData.teachers.find(t => t.id === editingId);
        const newTeacher = processedItem as unknown as TeacherType;
        if (oldTeacher) {
            const oldHomerooms = oldTeacher.homeroomGradeLevelIds || [];
            const newHomerooms = newTeacher.homeroomGradeLevelIds || [];
            const removedRooms = oldHomerooms.filter(id => !newHomerooms.includes(id));
            const addedRooms = newHomerooms.filter(id => !oldHomerooms.includes(id));
            
            if (removedRooms.length === 1 && addedRooms.length === 1) {
                const oldRoomId = removedRooms[0];
                const newRoomId = addedRooms[0];
                
                const hrCzSubjectIds = hrCzSubjects.map(s => s.id);
                const affectedEntries = appData.scheduleEntries.filter(entry => 
                    entry.gradeLevelId === oldRoomId && 
                    entry.teacherIds?.includes(editingId) && 
                    hrCzSubjectIds.includes(entry.subjectId)
                );
                
                if (affectedEntries.length > 0) {
                    const newRoomName = appData.gradeLevels.find(g => g.id === newRoomId)?.name || newRoomId;
                    for (const entry of affectedEntries) {
                        const conflict = appData.scheduleEntries.find(e => 
                            e.gradeLevelId === newRoomId && 
                            e.day === entry.day && 
                            e.period === entry.period
                        );
                        if (conflict) {
                            alert(`ไม่สามารถเปลี่ยนห้องประจำชั้นได้ เนื่องจากวิชา [HR/CZ] ในคาบเวลาดังกล่าวของห้องใหม่ [${newRoomName}] มีวิชาอื่นจัดสอนอยู่ก่อนแล้ว กรุณาเคลียร์ตารางสอนของห้องใหม่ก่อน`);
                            return; // STOP execution, don't save
                        }
                    }
                    scheduleEntriesToMigrate = affectedEntries;
                    newRoomIdForMigration = newRoomId;
                    oldRoomIdForMigration = oldRoomId;
                }
            }
        }
    }
    
    let newId = editingId;
    if (editingId) {
      setItems(prevItems =>
        prevItems.map(item => (item.id === editingId ? { ...item, ...processedItem, id: editingId } as T : item))
      );
    } else {
      newId = crypto.randomUUID();
      setItems(prevItems => [...prevItems, { ...processedItem, id: newId } as T]);
    }

    if (entityType === 'subjects' && setAppData && appData && newId) {
        const savedSubject = { ...processedItem, id: newId } as unknown as SubjectType;
        if (savedSubject.autoLinkToHomeroomTeachers && savedSubject.applicableParentGradeLevelIds && savedSubject.applicableParentGradeLevelIds.length > 0) {
            let newTeacherAssignments: TeacherSubjectAssignment[] = [...appData.teacherSubjectAssignments];
            const linksMade = new Set<string>();

            savedSubject.applicableParentGradeLevelIds.forEach(selectedParentId => {
                const parentGrade = appData.gradeLevels.find(g => g.id === selectedParentId);
                if (parentGrade) {
                    const childGradeIdsOfSelectedParent = getChildGradeLevelIds(selectedParentId, appData.gradeLevels);
                    
                    appData.teachers.forEach(teacher => {
                        const isHomeroomForAnyChildOfSelectedParent = teacher.homeroomGradeLevelIds?.some(hgId => 
                            childGradeIdsOfSelectedParent.includes(hgId)
                        );

                        if (isHomeroomForAnyChildOfSelectedParent) {
                            // Link for the SPECIFIC CHILD grades this teacher is homeroom for UNDER THIS PARENT
                            teacher.homeroomGradeLevelIds?.forEach(homeroomChildId => {
                                if (childGradeIdsOfSelectedParent.includes(homeroomChildId)) { // Ensure this child belongs to the current selectedParent
                                    const childLinkKey = `${teacher.id}-${savedSubject.id}-${homeroomChildId}`;
                                    if (!linksMade.has(childLinkKey)) {
                                         if (!newTeacherAssignments.some(tsa => tsa.teacherId === teacher.id && tsa.subjectId === savedSubject.id && tsa.gradeLevelId === homeroomChildId)) {
                                            newTeacherAssignments.push({
                                                id: crypto.randomUUID(),
                                                teacherId: teacher.id,
                                                subjectId: savedSubject.id,
                                                gradeLevelId: homeroomChildId,
                                            });
                                        }
                                        linksMade.add(childLinkKey);
                                    }
                                }
                            });
                        }
                    });
                }
            });
            // Remove duplicates just in case, though linksMade should prevent functional duplicates
            const uniqueAssignments = Array.from(new Map(newTeacherAssignments.map(item => [`${item.teacherId}-${item.subjectId}-${item.gradeLevelId}`, item])).values());
            setAppData(prev => prev ? ({ ...prev, teacherSubjectAssignments: uniqueAssignments }) : prev);
        }
    }

    if (entityType === 'teachers' && setAppData && appData && newId) {
        const savedTeacher = { ...processedItem, id: newId } as unknown as TeacherType;
        let newTeacherAssignments: TeacherSubjectAssignment[] = [...appData.teacherSubjectAssignments];
        let newlyLinkedCount = 0;
        
        // Find all subjects that auto-link to homeroom teachers
        const autoLinkSubjects = hrCzSubjects;
        
        autoLinkSubjects.forEach(subject => {
            // Get all valid child grade level IDs for this subject
            const validChildGradeIds = new Set<string>();
            if (subject.applicableParentGradeLevelIds && subject.applicableParentGradeLevelIds.length > 0) {
                subject.applicableParentGradeLevelIds.forEach(parentId => {
                    const children = getChildGradeLevelIds(parentId, appData.gradeLevels);
                    children.forEach(c => validChildGradeIds.add(c));
                });
            } else {
                // If applicableParentGradeLevelIds is empty, we assume it's applicable to ALL homeroom grades
                appData.gradeLevels.forEach(g => {
                    if (g.name.includes('/')) validChildGradeIds.add(g.id);
                });
            }

            // 1. Remove ANY auto-generated links for this teacher and this subject that are NO LONGER in the teacher's homeroomGradeLevelIds.
            newTeacherAssignments = newTeacherAssignments.filter(tsa => {
                if (tsa.teacherId === savedTeacher.id && tsa.subjectId === subject.id) {
                    const assignedGrade = appData.gradeLevels.find(g => g.id === tsa.gradeLevelId);
                    if (assignedGrade && !assignedGrade.name.includes('/')) {
                        return false; 
                    }
                    if (savedTeacher.homeroomGradeLevelIds?.includes(tsa.gradeLevelId) && validChildGradeIds.has(tsa.gradeLevelId)) {
                        return true;
                    }
                    return false; 
                }
                return true;
            });

            // 2. Add any MISSING links for this teacher and this subject, for the valid child grades they are homeroom for.
            savedTeacher.homeroomGradeLevelIds?.forEach(homeroomChildId => {
                if (validChildGradeIds.has(homeroomChildId)) {
                    if (!newTeacherAssignments.some(tsa => tsa.teacherId === savedTeacher.id && tsa.subjectId === subject.id && tsa.gradeLevelId === homeroomChildId)) {
                        newTeacherAssignments.push({
                            id: crypto.randomUUID(),
                            teacherId: savedTeacher.id,
                            subjectId: subject.id,
                            gradeLevelId: homeroomChildId,
                        });
                        newlyLinkedCount++;
                    }
                }
            });
        });

        setAppData(prev => prev ? ({ ...prev, teacherSubjectAssignments: newTeacherAssignments }) : prev);
        
        let additionalToastMsg = "";
        if (scheduleEntriesToMigrate.length > 0 && newRoomIdForMigration) {
            setAppData(prev => {
                if (!prev) return prev;
                const newScheduleEntries = prev.scheduleEntries.map(entry => {
                    if (scheduleEntriesToMigrate.some(e => e.id === entry.id)) {
                        return { ...entry, gradeLevelId: newRoomIdForMigration! };
                    }
                    return entry;
                });
                return { ...prev, scheduleEntries: newScheduleEntries };
            });
            additionalToastMsg = " และระบบได้ย้ายตารางสอน [HR/CZ] ไปยังห้องใหม่เรียบร้อยแล้ว";
        }
        
        if (newlyLinkedCount > 0) {
             setToastMessage(`บันทึกข้อมูลครูสำเร็จ ระบบได้ผูกลิงค์วิชาประจำชั้น [HR/CZ] ให้โดยอัตโนมัติ${additionalToastMsg}`);
        } else if (additionalToastMsg) {
             setToastMessage(`บันทึกข้อมูลครูสำเร็จ${additionalToastMsg}`);
        }
    }


    closeModal(); 
  };

  const handleRequestCancel = () => {
    setIsConfirmCancelModalOpen(true);
  };

  const handleConfirmCancel = () => {
    closeModal(); 
  };


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormError(null); 
  
    if (currentItem) {
      const fieldConfig = formFields.find(f => f.name === name);
      if (fieldConfig?.type === 'multiselect') {
        const selectedOptions = Array.from((e.target as HTMLSelectElement).selectedOptions).map(option => option.value);
        setCurrentItem(prev => ({
          ...prev,
          [name]: selectedOptions,
        } as Partial<T>));
      } else if (fieldConfig?.type === 'checkboxgroup') {
        // This case is handled by handleCheckboxGroupChange
        return;
      }
      else {
        const isCheckbox = type === 'checkbox';
        setCurrentItem(prev => ({
          ...prev,
          [name]: isCheckbox ? (e.target as HTMLInputElement).checked : value,
        } as Partial<T>));
      }
    }
  };

  const handleCheckboxGroupChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, checked } = e.target;
    setFormError(null);

    setCurrentItem(prev => {
        if (!prev) return null;
        const currentValues = (prev as any)[name] as string[] || [];
        let newValues;
        if (checked) {
            newValues = [...currentValues, value];
        } else {
            newValues = currentValues.filter(v => v !== value);
        }
        return { ...prev, [name]: newValues } as Partial<T>;
    });
  };
  
  const sortedItems = useMemo(() => {
    if (entityType === 'gradeLevels') {
      return [...items].sort((a, b) => {
        const nameA = (a as any).name || '';
        const nameB = (b as any).name || '';
        return String(nameA).localeCompare(String(nameB), undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    if (entityType === 'physicalRooms') {
      return [...items].sort((a, b) => {
        const codeA = (a as any).code || '';
        const codeB = (b as any).code || '';
        return String(codeA).localeCompare(String(codeB), undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    if (entityType === 'teachers') {
      return [...items].sort((a, b) => {
        const codeA = (a as any).teacherCode || '';
        const codeB = (b as any).teacherCode || '';
        if (codeA !== codeB) {
            return String(codeA).localeCompare(String(codeB), undefined, { numeric: true, sensitivity: 'base' });
        }
        const nameA = (a as any).name || '';
        const nameB = (b as any).name || '';
        return String(nameA).localeCompare(String(nameB), undefined, { sensitivity: 'base' });
      });
    }
    return items;
  }, [items, entityType]);

  const filteredItems = sortedItems.filter(item => {
    if (entityType === 'physicalRooms' && selectedRoomType) {
      if ((item as any).type !== selectedRoomType) {
        return false;
      }
    }

    if (Object.prototype.hasOwnProperty.call(item, 'name') && typeof (item as any).name === 'string') {
      if (String((item as any).name).toLowerCase().includes(searchTerm.toLowerCase())) {
        return true;
      }
    }
    for (const field of formFields) {
      const value = (item as any)[field.name];
      if (value !== undefined && value !== null) {
        if (field.type === 'text' || field.type === 'email' || field.type === 'number' || (entityType === 'subjects' && (field.name === 'subjectCode' || field.name === 'schedulingPattern')) || (entityType === 'teachers' && (field.name === 'teacherCode' || field.name === 'department'))) {
          if (String(value).toLowerCase().includes(searchTerm.toLowerCase())) {
            return true;
          }
        } else if ((field.type === 'select' || field.type === 'multiselect' || field.type === 'checkboxgroup') && field.optionsSource && appData) {
          // Fix: Cast sourceData to a more specific type array to ensure 'name' property exists.
          const sourceData = appData[field.optionsSource] as (Teacher[] | Subject[] | GradeLevel[] | PhysicalRoom[]);
          if (Array.isArray(value)) { 
            const selectedLabels = value.map(valId => {
              const selectedOption = sourceData.find(opt => opt.id === valId);
              return selectedOption?.name || '';
            }).join(', ');
            if (selectedLabels.toLowerCase().includes(searchTerm.toLowerCase())) {
              return true;
            }
          } else { 
            const selectedOption = sourceData.find(opt => opt.id === value);
             if (selectedOption) {
                let displayLabel = selectedOption.name;
                if (String(displayLabel).toLowerCase().includes(searchTerm.toLowerCase())) {
                  return true;
                }
            }
          }
        } else if (field.type === 'checkbox' && entityType === 'subjects' && (field.name === 'allowClassroomSharing' || field.name === 'isHomeroomAdvisorySubject' || field.name === 'autoLinkToHomeroomTeachers')) {
          const displayVal = value ? 'yes' : 'no';
          if (displayVal.includes(searchTerm.toLowerCase())) {
            return true;
          }
        }
      }
    }
    return false;
  });
  
  const getDisplayValue = (item: T, fieldName: string) => {
    const value = (item as any)[fieldName];
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0) || (typeof value === 'string' && value.trim() === '')) {
        return 'N/A';
    }
  
    const fieldConfig = formFields.find(f => f.name === fieldName);
  
    if ((fieldConfig?.type === 'multiselect' || fieldConfig?.type === 'checkboxgroup') && fieldConfig.optionsSource && appData) {
      // Fix: Cast sourceData to a more specific type array to ensure 'name' property exists.
      const sourceData = appData[fieldConfig.optionsSource] as (Teacher[] | Subject[] | GradeLevel[] | PhysicalRoom[]);
      if (Array.isArray(value) && value.length > 0) {
        return value.map(id => {
          let option: Teacher | Subject | GradeLevel | PhysicalRoom | undefined;
          if (fieldConfig.name === 'applicableParentGradeLevelIds') { 
            option = (sourceData as GradeLevel[]).find(opt => opt.id === id && !opt.name.includes('/'));
          } else {
            option = sourceData.find(opt => opt.id === id);
          }
          return (fieldConfig.optionsSource === "physicalRooms" ? formatRoomDisplay(option as any) : option?.name) || id;
        }).join(', ');
      }
      return 'N/A'; 
    }
  
    if (fieldConfig?.type === 'select') {
      if (fieldConfig.optionsSource && appData) {
        // Fix: Cast sourceData to a more specific type array.
        const sourceData = appData[fieldConfig.optionsSource] as (Teacher[] | Subject[] | GradeLevel[] | PhysicalRoom[]);
        const selectedOption = sourceData.find(opt => opt.id === value);
        if(selectedOption) {
            return (fieldConfig.optionsSource === "physicalRooms" ? formatRoomDisplay(selectedOption as any) : selectedOption.name) || String(value);
        }
        return String(value);

      } else if (fieldConfig.options) {
        const selectedOption = fieldConfig.options.find(opt => opt.value === value);
        return selectedOption ? selectedOption.label : String(value);
      }
    }
  
    if (fieldConfig?.type === 'checkbox') {
        return value ? 'Yes' : 'No';
    }
  
    if (fieldConfig?.type === 'color' && entityType === 'subjects' && fieldName === 'color') {
      return (
        <div className="flex items-center">
          <div style={{ backgroundColor: String(value) }} className="w-4 h-4 rounded-full border border-slate-300 mr-2"></div>
          {String(value)}
        </div>
      );
    }
    
    return String(value);
  };


  return (
    <div className="p-4 md:p-6 bg-white shadow-lg rounded-lg relative">
      {toastMessage && (
          <div className="fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-3 rounded-md shadow-lg z-50 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <Icons.CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className="font-medium">{toastMessage}</span>
          </div>
      )}
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center">
          {IconComponent && <IconComponent size={32} className="mr-3 text-blue-600" />}
          <h2 className="text-2xl font-semibold text-slate-800">Manage {entityNamePlural}</h2>
        </div>
        <div className="flex space-x-2">
          {entityType === 'teachers' && (() => {
              const currentUserEmail = appData.currentUser?.email || '';
              const isSuperAdmin = (appData?.authorizedAdmins || []).includes(currentUserEmail);
              const isAuthAdmin = (appData.authorizedAdmins || []).includes(currentUserEmail);
              const isAdmin = isSuperAdmin || isAuthAdmin;
              return (
            <button
              type="button"
              title={isAdmin ? "" : "สิทธิ์ในการซิงค์ปฏิทินถูกจำกัดไว้สำหรับผู้ดูแลระบบ (Admin) เท่านั้น"}
              onClick={async (e) => {
                e.preventDefault();
                if (!isAdmin) return;
                if (selectedTeacherEmails.length === 0) {
                    alert('กรุณาเลือกครูอย่างน้อย 1 ท่านเพื่อซิงค์ข้อมูล');
                    return;
                }
                if (window.confirm(`การดำเนินการนี้จะลบตารางเรียนเดิมในปฏิทินของครูที่เลือก (${selectedTeacherEmails.length} ท่าน) และแทนที่ด้วยตารางเรียนเวอร์ชันล่าสุด ยืนยันหรือไม่?`)) {
                  setIsSyncingTeachers(true);
                  try {
                    const selectedTeachers = items.filter(t => selectedTeacherEmails.includes((t as any).email));
                    const generatedEvents: any[] = [];
                    const teacherEntries = appData?.scheduleEntries?.filter(e => e.teacherIds.some(tid => selectedTeachers.find(t => t.id === tid))) || [];
                    if (appData?.periodSettings) {
                        const today = new Date();
                        const dayOfWeek = today.getDay();
                        const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
                        const baseDate = new Date(today);
                        baseDate.setDate(today.getDate() + daysUntilNextMonday);
                        baseDate.setHours(0,0,0,0);
                        
                        const dayMap: Record<string, number> = {
                            'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4, 'Saturday': 5, 'Sunday': 6
                        };

                        teacherEntries.forEach(entry => {
                            const period = appData.periodSettings[entry.period];
                            if (!period) return;
                            const offset = dayMap[entry.day] || 0;
                            const evDate = new Date(baseDate);
                            evDate.setDate(evDate.getDate() + offset);
                            
                            const [startH, startM] = period.startTime.split(':');
                            const [endH, endM] = period.endTime.split(':');
                            const start = new Date(evDate); start.setHours(parseInt(startH), parseInt(startM));
                            const end = new Date(evDate); end.setHours(parseInt(endH), parseInt(endM));
                            
                            const subject = appData.subjects.find(s => s.id === entry.subjectId);
                            const classNames = appData.gradeLevels.find(gl => gl.id === entry.gradeLevelId)?.name || '';
                            const roomObj = appData.physicalRooms.find(r => r.id === entry.physicalRoomId);
                            
                            const roomLocation = roomObj ? (roomObj.code ? `[${roomObj.code}] ${roomObj.name}` : roomObj.name) : '';
                            const subjectTitle = subject ? (subject.subjectCode ? `[${subject.subjectCode}] ${subject.name}` : subject.name) : 'Class';
                            
                            
                            const matchedTeachers = selectedTeachers.filter(t => entry.teacherIds.includes(t.id));
                            matchedTeachers.forEach(matchedTeacher => {
                                generatedEvents.push({
                                    targetTeacherEmail: (matchedTeacher as any).email,

                                summary: subjectTitle,
                                description: `Class(es): ${classNames}`,
                                location: roomLocation,
                                start: start.toISOString(),
                                end: end.toISOString()
                            });
                            });
                        });
                    }

                    const liveToken = googleAccessToken || localStorage.getItem('googleAccessToken');
                    if (!liveToken) {
                        throw new Error("ไม่พบสิทธิ์การใช้งาน Google Calendar สำหรับบัญชีนี้ กรุณาลงชื่อเข้าใช้งานใหม่อีกครั้ง");
                    }

                    const res = await fetch('/api/workspace/calendar/sync-teachers', { 
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${liveToken}`,
                            'X-User-Email': appData.currentUser?.email || '',
                            'X-Authorized-Admins': JSON.stringify(appData.authorizedAdmins || [])
                        },
                        body: JSON.stringify({
                            teachers: selectedTeachers,
                            events: generatedEvents,
                            semesterEndDate: appData?.organizationSettings?.semesterEndDate
                        })
                    });
                    
                    let data;
                    try {
                        const text = await res.text();
                        try {
                          data = JSON.parse(text);
                        } catch (e) {
                          data = { error: text || res.statusText };
                        }
                    } catch (e) {
                        data = { error: res.statusText };
                    }
                    
                    if (res.ok) {
                        alert(data.message || 'ซิงค์ข้อมูลสำเร็จ');
                    } else {
                        if (res.status === 403) {
                            throw new Error("ไม่พบสิทธิ์การใช้งาน Google Calendar สำหรับบัญชีนี้ กรุณาลงชื่อเข้าใช้งานใหม่อีกครั้ง");
                        }
                        throw new Error(`[${res.status}] ${data.error || res.statusText}`);
                    }
                  } catch (e: any) {
                    alert('เกิดข้อผิดพลาด: ' + e.message);
                  } finally {
                    setIsSyncingTeachers(false);
                  }
                }
              }}
              className="relative z-[9999] pointer-events-auto flex items-center bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-md shadow-md transition-colors duration-150 disabled:bg-slate-400 disabled:cursor-not-allowed"
              disabled={isSyncingTeachers}
            >
              {isSyncingTeachers ? (
                 <>
                   <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                       <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                       <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                   </svg>
                   กำลังซิงค์...
                 </>
              ) : (
                 <>
                    <Icons.Calendar size={20} className="mr-2" /> ซิงค์/อัปเดตปฏิทิน ({selectedTeacherEmails.length})
                 </>
              )}
            </button>
            );
          })()}
          <button
            onClick={openModalForNew}
            className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md shadow-md transition-colors duration-150"
          >
            <Icons.Add size={20} className="mr-2" /> Add New {entityNameSingular}
          </button>
        </div>
      </div>
      
      <div className="mb-4 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-grow">
          <input
              type="text"
              placeholder={`Search ${entityNamePlural.toLowerCase()}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full p-2 pl-10 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          />
          <Icons.Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
        </div>
        {entityType === 'physicalRooms' && (
          <div className="sm:w-64">
            <select
              value={selectedRoomType}
              onChange={(e) => setSelectedRoomType(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white font-medium text-slate-700"
            >
              <option value="">All Room Types (ทุกประเภทห้อง)</option>
              {(appData.resourceTypes || []).map((rt: any) => (
                <option key={rt.id} value={rt.name}>
                  {rt.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {filteredItems.length === 0 ? (
         <p className="text-slate-500 text-center py-8">
            {searchTerm ? `No ${entityNamePlural.toLowerCase()} found matching your search.` : `No ${entityNamePlural.toLowerCase()} found. Click "Add New ${entityNameSingular}" to get started.`}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                {entityType === 'teachers' && (
                    <th scope="col" className="px-4 py-3 w-10 text-left">
                        <label className="flex items-center space-x-2 text-slate-700 cursor-pointer">
                            <input 
                                type="checkbox" 
                                className="rounded text-blue-600 focus:ring-blue-500"
                                checked={filteredItems.filter(item => (item as any).email).length > 0 && selectedTeacherEmails.length === filteredItems.filter(item => (item as any).email).length}
                                onChange={(e) => {
                                    if (e.target.checked) {
                                        setSelectedTeacherEmails(filteredItems.map(item => (item as any).email).filter(Boolean));
                                    } else {
                                        setSelectedTeacherEmails([]);
                                    }
                                }}
                            />
                        </label>
                    </th>
                )}
                {formFields.map(field => (
                    <th key={field.name as string} scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        {field.label}
                    </th>
                ))}
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {filteredItems.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  {entityType === 'teachers' && (
                      <td className="px-4 py-3">
                          <input 
                              type="checkbox"
                              className="rounded text-blue-600 focus:ring-blue-500"
                              checked={selectedTeacherEmails.includes((item as any).email)}
                              onChange={(e) => {
                                  if (e.target.checked) {
                                      if ((item as any).email) {
                                          setSelectedTeacherEmails(prev => [...prev, (item as any).email]);
                                      }
                                  } else {
                                      setSelectedTeacherEmails(prev => prev.filter(email => email !== (item as any).email));
                                  }
                              }}
                          />
                      </td>
                  )}
                  {formFields.map(field => (
                    <td key={field.name as string} className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">
                        {entityType === 'gradeLevels' && field.name === 'groupEmail' ? (
                          <input 
                            type="email"
                            value={(item as any).groupEmail || ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              setItems(prev => prev.map(gl => gl.id === item.id ? { ...gl, groupEmail: value } : gl) as unknown as T[]);
                            }}
                            className="w-full p-1 border border-slate-300 rounded focus:ring-blue-500 focus:border-blue-500 text-xs"
                            placeholder="e.g., m1.1@utd.ac.th"
                          />
                        ) : entityType === 'gradeLevels' && field.name === 'description' ? (
                          <input 
                            type="text"
                            value={(item as any).description || ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              setItems(prev => prev.map(gl => gl.id === item.id ? { ...gl, description: value } : gl) as unknown as T[]);
                            }}
                            className="w-full p-1 border border-slate-300 rounded focus:ring-blue-500 focus:border-blue-500 text-xs"
                            placeholder="e.g., ห้องเรียน SMTE"
                          />
                        ) : (
                          getDisplayValue(item, field.name as string)
                        )}
                    </td>
                  ))}
                  <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-2">

                    <button
                      onClick={() => openModalForEdit(item)}
                      className="text-blue-600 hover:text-blue-800 transition-colors"
                      title={`Edit ${entityNameSingular}`}
                    >
                      <Icons.Edit size={18} />
                    </button>
                    {entityType !== 'physicalRooms' && (
                      <button
                        onClick={() => requestDelete(item.id)}
                        className={`transition-colors ${permissions.canPerformManagerActions ? 'text-red-600 hover:text-red-800' : 'text-slate-400 cursor-not-allowed'}`}
                        title={permissions.canPerformManagerActions ? `Delete ${entityNameSingular}` : "Deletion restricted to managers"}
                        disabled={!permissions.canPerformManagerActions}
                      >
                        <Icons.Delete size={18} />
                      </button>
                    )}
                    {entityType === 'gradeLevels' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openBulkPasteModal(item as any);
                        }}
                        className="text-green-600 hover:text-green-800 transition-colors ml-2 bg-green-50 px-2 py-1 rounded border border-green-200 inline-flex items-center gap-1"
                        title="Sync Members to Group"
                      >
                        <Icons.UploadCloud size={14} />
                        <span className="text-xs">Sync Members</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <Modal 
            isOpen={isModalOpen} 
            onClose={handleRequestCancel} 
            title={`${editingId ? 'Edit' : 'Add'} ${entityNameSingular}`}
            size="lg"
        >
          <form onSubmit={(e) => { e.preventDefault(); handleRequestSubmit(); }} className="space-y-4">
            {formError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">{formError}</p>}
            {formFields.map(field => {
              const isDisabled = field.disabled ? field.disabled(currentItem, appData) : false;
              if (field.type === 'multiselect') {
                let optionsSourceData = field.optionsSource ? appData[field.optionsSource] as Identifiable[] : [];
                if (field.optionsSource === 'gradeLevels') {
                    optionsSourceData = [...optionsSourceData].sort((a,b) => ((a as any).name || '').localeCompare(((b as any).name || ''), undefined, { numeric: true, sensitivity: 'base' }));
                } else if (field.optionsSource === 'physicalRooms') {
                    optionsSourceData = [...optionsSourceData].sort((a,b) => ((a as any).code || '').localeCompare(((b as any).code || ''), undefined, { numeric: true, sensitivity: 'base' }));
                }
                const options = field.name === 'applicableParentGradeLevelIds'
                    ? optionsSourceData.filter(opt => !((opt as any).name || '').includes('/')).map(opt => ({ value: (field.optionsSource === 'departments' || field.optionsSource === 'resourceTypes') ? (opt as any).name : opt.id, label: field.optionsSource === "physicalRooms" ? formatRoomDisplay(opt as any) : (opt as any).name }))
                    : (field.options || optionsSourceData.map(opt => ({ value: (field.optionsSource === 'departments' || field.optionsSource === 'resourceTypes') ? (opt as any).name : opt.id, label: field.optionsSource === "physicalRooms" ? formatRoomDisplay(opt as any) : (opt as any).name })));
                return (
                  <div key={field.name as string}>
                    <label htmlFor={field.name as string} className="block text-sm font-medium text-slate-700 mb-1">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    <select
                      multiple
                      id={field.name as string}
                      name={field.name as string}
                      value={(currentItem as any)?.[field.name as string] || []}
                      onChange={handleInputChange}
                      className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                      required={field.required}
                      disabled={isDisabled}
                      size={Math.min(5, options.length || 1)}
                    >
                      {options.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                );
              } 
              if (field.type === 'checkboxgroup') {
                let optionsSourceData = field.optionsSource ? appData[field.optionsSource] as GradeLevel[] : [];
                if (field.optionsSource === 'gradeLevels') {
                    optionsSourceData = [...optionsSourceData].sort((a,b) => (a.name || '').localeCompare((b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
                }
                // For 'applicableParentGradeLevelIds', filter options to show only parent grade levels
                const options = field.name === 'applicableParentGradeLevelIds' 
                    ? optionsSourceData.filter(gl => !gl.name.includes('/')).map(opt => ({ value: (field.optionsSource === 'departments' || field.optionsSource === 'resourceTypes') ? (opt as any).name : opt.id, label: field.optionsSource === "physicalRooms" ? formatRoomDisplay(opt as any) : opt.name }))
                    : (field.options || optionsSourceData.map(opt => ({ value: (field.optionsSource === 'departments' || field.optionsSource === 'resourceTypes') ? (opt as any).name : opt.id, label: field.optionsSource === "physicalRooms" ? formatRoomDisplay(opt as any) : (opt as any).name })));

                return (
                    <div key={field.name as string}>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            {field.label} {field.required && <span className="text-red-500">*</span>}
                        </label>
                        <div className="space-y-2 p-2 border border-slate-200 rounded-md max-h-48 overflow-y-auto">
                            {options.map(option => (
                                <label key={option.value} className="flex items-center space-x-2 text-sm text-slate-700">
                                    <input
                                        type="checkbox"
                                        name={field.name as string}
                                        value={option.value}
                                        checked={((currentItem as any)?.[field.name as string] || []).includes(option.value)}
                                        onChange={handleCheckboxGroupChange}
                                        className="rounded border-slate-400 text-blue-600 focus:ring-blue-500"
                                        disabled={isDisabled}
                                    />
                                    <span>{option.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                );
              }
              if (field.type === 'select') {
                let optionsSourceData = field.optionsSource ? appData[field.optionsSource] as Identifiable[] : [];
                if (field.optionsSource === 'gradeLevels') {
                    optionsSourceData = [...optionsSourceData].sort((a,b) => ((a as any).name || '').localeCompare(((b as any).name || ''), undefined, { numeric: true, sensitivity: 'base' }));
                } else if (field.optionsSource === 'physicalRooms') {
                    optionsSourceData = [...optionsSourceData].sort((a,b) => ((a as any).code || '').localeCompare(((b as any).code || ''), undefined, { numeric: true, sensitivity: 'base' }));
                }
                const options = field.options || optionsSourceData.map(opt => ({ 
                    value: (field.optionsSource === 'departments' || field.optionsSource === 'resourceTypes') ? (opt as any).name : opt.id, 
                    label: field.optionsSource === "physicalRooms" ? formatRoomDisplay(opt as any) : (opt as any).name 
                }));

                return (
                  <div key={field.name as string}>
                    <label htmlFor={field.name as string} className="block text-sm font-medium text-slate-700 mb-1">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    <select
                      id={field.name as string}
                      name={field.name as string}
                      value={(currentItem as any)?.[field.name as string] || ''}
                      onChange={handleInputChange}
                      className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                      required={field.required}
                      disabled={isDisabled}
                    >
                      <option value="" disabled>{field.placeholder || `Select ${field.label.toLowerCase()}`}</option>
                      {options.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (field.type === 'checkbox') {
                return (
                    <div key={field.name as string} className="flex items-center mt-2 mb-2">
                        <input
                            type="checkbox"
                            id={field.name as string}
                            name={field.name as string}
                            checked={(currentItem as any)?.[field.name as string] || false}
                            onChange={handleInputChange}
                            className="h-4 w-4 rounded border-slate-400 text-blue-600 focus:ring-blue-500 mr-2"
                            disabled={isDisabled}
                        />
                        <label htmlFor={field.name as string} className="text-sm font-medium text-slate-700">
                            {field.label} {field.required && <span className="text-red-500">*</span>}
                        </label>
                    </div>
                );
              }
              return (
                <div key={field.name as string}>
                  <label htmlFor={field.name as string} className="block text-sm font-medium text-slate-700 mb-1">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={field.type}
                    id={field.name as string}
                    name={field.name as string}
                    value={field.type === 'color' ? ((currentItem as any)?.[field.name as string] || '#000000') : ((currentItem as any)?.[field.name as string] || '')}
                    onChange={handleInputChange}
                    className={`w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm ${field.type === 'color' ? 'h-10' : ''} ${isDisabled ? 'bg-slate-50 cursor-not-allowed' : ''}`}
                    required={field.required}
                    placeholder={field.placeholder}
                    disabled={isDisabled}
                  />
                </div>
              );
            })}
            
            <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10">
              <button
                type="button"
                onClick={handleRequestCancel}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
              >
                {editingId ? 'Save Changes' : `Add ${entityNameSingular}`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {isBulkPasteModalOpen && bulkPasteClassroom && (
        <Modal 
            isOpen={isBulkPasteModalOpen} 
            onClose={() => setIsBulkPasteModalOpen(false)} 
            title={`จัดการอีเมลกลุ่มนักเรียน: ${bulkPasteClassroom.name}`}
            size="lg"
        >
          <div className="p-2 space-y-4">
              <div className="bg-blue-50 text-blue-800 p-3 rounded-md border border-blue-100 text-sm mb-4">
                  <strong>Student Group Email:</strong> {bulkPasteClassroom.groupEmail || <span className="text-red-500">Not set. กรุณาตั้งค่าก่อนในหน้าแก้ไขห้องเรียน</span>}
              </div>

              <div className="border-t border-slate-200 pt-4 pb-2">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-slate-700">
                    คัดลอกรหัสนักเรียนจาก Excel มาวางที่นี่ (1 รหัสต่อ 1 บรรทัด)
                  </label>
                  {pasteText && (
                    <button
                      type="button"
                      onClick={() => {
                          setPasteText('');
                          if (bulkPasteClassroom) {
                              localStorage.removeItem(`studentPasteText_${bulkPasteClassroom.id}`);
                          }
                      }}
                      className="text-xs text-red-600 hover:text-red-800 focus:outline-none flex items-center"
                    >
                      <Icons.Delete size={14} className="mr-1" />
                      ล้างข้อมูล (Clear)
                    </button>
                  )}
                </div>
                <textarea
                  className="w-full h-48 p-3 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm shadow-sm font-mono bg-slate-50"
                  placeholder="it12345&#10;it12346&#10;..."
                  value={pasteText}
                  onChange={e => {
                      const val = e.target.value;
                      setPasteText(val);
                      if (bulkPasteClassroom) {
                          localStorage.setItem(`studentPasteText_${bulkPasteClassroom.id}`, val);
                      }
                  }}
                ></textarea>
                
                {isResolvingStudents && (
                  <div className="mt-4 flex items-center text-sm text-blue-600">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    กำลังดึงข้อมูลนักเรียนจาก Workspace Directory...
                  </div>
                )}
                
                {resolveError && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-600 font-medium break-words">
                      {resolveError}
                    </p>
                  </div>
                )}
                
                {!isResolvingStudents && !resolveError && (parsedStudents || []).length > 0 && (
                  <div className="mt-4">
                    <div className="text-sm font-semibold text-blue-700 mb-2 flex items-center justify-between">
                      <span className="flex items-center">
                          <Icons.CheckCircle size={16} className="mr-2"/>
                          ตรวจพบรายชื่อนักเรียนทั้งหมด {(parsedStudents || []).length} คน
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-3 bg-white border border-slate-200 rounded-md shadow-inner">
                      {(parsedStudents || []).map((student, i) => (
                        <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                           {student?.fullName || 'Unknown'} ({student?.email || ''})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                {!bulkPasteClassroom?.groupEmail && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center">
                     <Icons.Warning size={14} className="mr-1"/> 
                     กรุณาตั้งค่า Student Group Email ให้กับห้องเรียนนี้ก่อน
                  </p>
                )}
              </div>

              <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-between items-center gap-3 z-50">
                {(() => {
                  const currentUserEmail = appData.currentUser?.email || '';
                  const isSuperAdmin = (appData?.authorizedAdmins || []).includes(currentUserEmail);
                  const isAuthAdmin = (appData.authorizedAdmins || []).includes(currentUserEmail);
                  const isAdmin = isSuperAdmin || isAuthAdmin;
                  return (
                <button
                  type="button"
                  title={isAdmin ? "" : "สิทธิ์ในการซิงค์ปฏิทินถูกจำกัดไว้สำหรับผู้ดูแลระบบ (Admin) เท่านั้น"}
                  onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      
                      if (!isAdmin) return;
                      if (!bulkPasteClassroom?.groupEmail) {
                          return;
                      }
                      if (isSyncingStudents) {
                          return;
                      }
                      if (isResolvingStudents) {
                          return;
                      }
                      if (resolveError) {
                          return;
                      }
                      if (!parsedStudents || parsedStudents.length === 0) {
                          return;
                      }

                      handleBatchInsertGoogleGroup(parsedStudents);
                  }}
                  className="relative z-[9999] pointer-events-auto bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-md text-sm font-medium shadow flex items-center transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed"
                  disabled={isSyncingStudents || !isAdmin}
                >
                  {isSyncingStudents ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {syncStatusText}
                    </>
                  ) : (
                    <>
                      <Icons.UploadCloud size={18} className="mr-2"/> 
                      ซิงค์/อัปเดตปฏิทิน
                    </>
                  )}
                </button>
                );
                })()}
                <button
                  type="button"
                  onClick={() => setIsBulkPasteModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
                >
                  Close
                </button>
              </div>
          </div>
        </Modal>
      )}

       <ConfirmationModal
        isOpen={isConfirmDeleteModalOpen}
        onClose={() => setIsConfirmDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title={`Confirm Delete ${entityNameSingular}`}
        message={`Are you sure you want to delete this ${entityNameSingular.toLowerCase()}? This action cannot be undone.`}
        confirmButtonText={`Delete ${entityNameSingular}`}
        icon={Icons.Warning}
      />
      <ConfirmationModal
        isOpen={isConfirmSubmitModalOpen}
        onClose={() => setIsConfirmSubmitModalOpen(false)}
        onConfirm={() => {
            executeSubmit();
            setIsConfirmSubmitModalOpen(false);
        }}
        title={`Confirm ${editingId ? 'Update' : 'Add'} ${entityNameSingular}`}
        message={`Are you sure you want to ${editingId ? 'update this' : 'add this new'} ${entityNameSingular.toLowerCase()}?`}
        confirmButtonText={editingId ? 'Update' : 'Add'}
        confirmButtonVariant="primary"
      />
      <ConfirmationModal
        isOpen={isConfirmCancelModalOpen}
        onClose={() => setIsConfirmCancelModalOpen(false)}
        onConfirm={() => {
            handleConfirmCancel();
            setIsConfirmCancelModalOpen(false);
        }}
        title="Confirm Cancel"
        message="Are you sure you want to cancel? Any unsaved changes will be lost."
        confirmButtonText="Yes, Cancel"
        confirmButtonVariant="danger"
      />

    </div>
  );
};

// Fix: Add default export for the component
export default EntityManagementScreen;
