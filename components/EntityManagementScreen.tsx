import { computeSubjectColors, SubjectColorMode } from '../utils/subjectColors';
import { computeHomeroomLinkDrift, applyHomeroomLinkDrift } from '../utils/homeroomLinks';
import { normalizeSubjectFlags, subjectFlagLockReason, SubjectFlagField } from '../utils/subjectFlags';
import { formatRoomDisplay } from "../utils/stringUtils";
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
// Fix: Ensure all types used from appData for optionsSource are correctly typed to have a 'name' property.
import { AppData, Entity, EntityType, FormField, Identifiable, Subject as SubjectType, Teacher as TeacherType, SubjectTeachingMode, ScreenAccessProps, GradeLevel as GradeLevelType, PhysicalRoom as ClassroomType, TeacherSubjectAssignment, Teacher, Subject, GradeLevel, PhysicalRoom, ScheduleEntry } from '../types'; // Renamed Subject to avoid conflict
import Modal from './Modal';
import SearchableSelect from './SearchableSelect';
import { thaiGradeName } from '../utils/subjectCode';
import ConfirmationModal from './ConfirmationModal'; // Import ConfirmationModal
import { Icons, PREDEFINED_SUBJECT_COLORS } from '../constants';
import { getParentGradeLevelId, isParentGrade as checkIsParentGradeUtil, getChildGradeLevelIds, subjectOfferedInSemester } from './scheduleUtils'; // Import from new utils file


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
}: EntityManagementScreenProps<T>) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<Partial<T> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  // Subjects page: department filter + bulk colour tool
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState('');
  const [isColorToolOpen, setIsColorToolOpen] = useState(false);
  const [colorMode, setColorMode] = useState<SubjectColorMode>('gradient');
  const [colorBase, setColorBase] = useState('#3B82F6');
  const [selectedRoomType, setSelectedRoomType] = useState('');
  const [selectedTeacherDept, setSelectedTeacherDept] = useState('');
  const [selectedTeacherHomeroom, setSelectedTeacherHomeroom] = useState('');
  
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const [itemToDeleteId, setItemToDeleteId] = useState<string | null>(null);

  const [isConfirmSubmitModalOpen, setIsConfirmSubmitModalOpen] = useState(false);
  const [isConfirmCancelModalOpen, setIsConfirmCancelModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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
    return appData.subjects.filter(s => subjectOfferedInSemester(s, appData.organizationSettings?.semester) && (
        s.autoLinkToHomeroomTeachers || 
        s.subjectCode === 'HR' || 
        s.subjectCode === 'CZ' ||
        s.name.includes('โฮมรูม') ||
        s.name.includes('เขตพื้นที่') ||
        s.isHomeroomAdvisorySubject
    ));
  }, [appData?.subjects, appData?.organizationSettings?.semester]);


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
      if (subjectItem.restrictedRoomTypes === undefined) {
        setCurrentItem(prev => ({ ...prev, restrictedRoomTypes: [] } as Partial<T>));
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
      } else if (field.name === 'allowPhysicalRoomSharing' && entityType === 'subjects') {
        (acc as any)[field.name] = false; 
      } else if (field.name === 'allowClassroomSharing' && entityType === 'subjects') {
        (acc as any)[field.name] = false; 
      } else if (field.name === 'isHomeroomAdvisorySubject' && entityType === 'subjects') {
        (acc as any)[field.name] = false; 
      } else if (field.name === 'autoLinkToHomeroomTeachers' && entityType === 'subjects') {
        (acc as any)[field.name] = false;
      } else if (field.name === 'applicableParentGradeLevelIds' && entityType === 'subjects') { // Initialize new field
        (acc as any)[field.name] = [];
      } else if (field.name === 'restrictedRoomTypes' && entityType === 'subjects') {
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
        if (!('allowPhysicalRoomSharing' in itemToEdit) || itemToEdit.allowPhysicalRoomSharing === undefined) {
            (itemToEdit as Partial<SubjectType>).allowPhysicalRoomSharing = (itemToEdit as any).allowClassroomSharing ?? false;
        }
        if (!('allowClassroomSharing' in itemToEdit) || itemToEdit.allowClassroomSharing === undefined) {
            (itemToEdit as Partial<SubjectType>).allowClassroomSharing = (itemToEdit as any).allowPhysicalRoomSharing ?? false;
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

  // Duplicate a subject: opens the "new" form pre-filled with all details, code left blank to be filled in
  const openModalForCopy = (item: T) => {
    openModalForEdit(item);
    setEditingId(null);
    setCurrentItem(prev => {
      const copy: any = { ...(prev as any) };
      delete copy.id;
      copy.subjectCode = '';
      return copy as Partial<T>;
    });
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

      // subjectCode must be unique (case-insensitive, trimmed). Checked against the
      // FULL subject list (appData.subjects), not the filtered `items` prop. This is
      // fast client feedback; the server (commitOrgChanges / assistantUpdateEntity)
      // enforces it authoritatively against a fresh read.
      const code = (subjectItem.subjectCode || '').trim().toLowerCase();
      if (code) {
        const clash = (appData?.subjects || []).find(
          s => s.id !== editingId && (s.subjectCode || '').trim().toLowerCase() === code
        );
        if (clash) {
          setFormError(`รหัสวิชา "${subjectItem.subjectCode}" ถูกใช้โดยวิชา "${clash.name}" อยู่แล้ว (subjectCode ต้องไม่ซ้ำ)`);
          return false;
        }
      }

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

    let processedItem = entityType === 'subjects' ? normalizeSubjectFlags({ ...currentItem } as any) as typeof currentItem : { ...currentItem };

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
                const currentScheduleEntries = Array.isArray(appData.scheduleEntries) ? appData.scheduleEntries : [];
                const affectedEntries = currentScheduleEntries.filter(entry => 
                    entry.gradeLevelId === oldRoomId && 
                    entry.teacherIds?.includes(editingId) && 
                    hrCzSubjectIds.includes(entry.subjectId)
                );
                
                if (affectedEntries.length > 0) {
                    const newRoomName = appData.gradeLevels.find(g => g.id === newRoomId)?.name || newRoomId;
                    for (const entry of affectedEntries) {
                        const conflict = currentScheduleEntries.find(e => 
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
        // Keep the periods-per-week snapshot stored on this subject's links in sync with the subject
        if (editingId && typeof savedSubject.periodsPerWeek === 'number') {
            const ppw = savedSubject.periodsPerWeek;
            setAppData(prev => prev ? ({
                ...prev,
                teacherSubjectAssignments: prev.teacherSubjectAssignments.map(l =>
                    l.subjectId === newId && l.periodsPerWeek !== ppw ? { ...l, periodsPerWeek: ppw } : l)
            }) : prev);
        }
        if (savedSubject.autoLinkToHomeroomTeachers && savedSubject.applicableParentGradeLevelIds && savedSubject.applicableParentGradeLevelIds.length > 0) {
            // Make this subject's links match the current homeroom advisors: add missing, remove stale
            const drift = computeHomeroomLinkDrift({
                teachers: appData.teachers,
                subjects: [savedSubject],
                gradeLevels: appData.gradeLevels,
                links: appData.teacherSubjectAssignments,
                currentSemester: appData.organizationSettings?.semester,
            });
            let applyStale = true;
            if (drift.stale.length > 0) {
                applyStale = window.confirm(`พบลิงก์ของวิชานี้ ${drift.stale.length} รายการที่ครูไม่ได้เป็นที่ปรึกษาห้องนั้น\nต้องการลบลิงก์เหล่านี้ด้วยหรือไม่?\n(ตกลง = ลบและเพิ่มลิงก์ให้ตรงกับครูที่ปรึกษา, ยกเลิก = เพิ่มอย่างเดียว)`);
            }
            const toApply = { missing: drift.missing, stale: applyStale ? drift.stale : [] };
            setAppData(prev => prev ? ({ ...prev, teacherSubjectAssignments: applyHomeroomLinkDrift(prev.teacherSubjectAssignments, toApply) }) : prev);
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
        const updatedVal = isCheckbox ? (e.target as HTMLInputElement).checked : value;
        setCurrentItem(prev => {
          if (!prev) return null;
          const next = {
            ...prev,
            [name]: updatedVal,
          };
          // Subject type / Homeroom / Broad decide which special checkboxes are usable: clear the ones that no longer apply.
          return (entityType === 'subjects' ? normalizeSubjectFlags(next as any) : next) as Partial<T>;
        });
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
        // Department first (Thai collation), then teacher code, then name
        const deptA = (a as any).department || '';
        const deptB = (b as any).department || '';
        if (!deptA !== !deptB) return deptA ? -1 : 1; // teachers without a department go last
        if (deptA !== deptB) return String(deptA).localeCompare(String(deptB), 'th', { sensitivity: 'base' });
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
    if (entityType === 'subjects') {
      return [...items].sort((a, b) => {
        const codeA = String((a as any).subjectCode || '').trim();
        const codeB = String((b as any).subjectCode || '').trim();
        if (!codeA !== !codeB) return codeA ? -1 : 1; // subjects without a code go last
        if (codeA !== codeB) return codeA.localeCompare(codeB, 'th', { numeric: true, sensitivity: 'base' });
        return String((a as any).name || '').localeCompare(String((b as any).name || ''), 'th', { sensitivity: 'base' });
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

    if (entityType === 'teachers') {
      const t = item as any;
      if (selectedTeacherDept && t.department !== selectedTeacherDept) return false;
      if (selectedTeacherHomeroom) {
        const ids: string[] = t.homeroomGradeLevelIds || [];
        if (selectedTeacherHomeroom === '__none__' ? ids.length > 0 : !ids.includes(selectedTeacherHomeroom)) return false;
      }
    }

    if (entityType === 'subjects' && selectedDepartmentFilter) {
      if ((item as any).department !== selectedDepartmentFilter) {
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
            option = sourceData.find(opt => opt.id === id || (opt as any).name === id);
          }
          return (fieldConfig.optionsSource === "physicalRooms" ? formatRoomDisplay(option as any) : option?.name) || id;
        }).join(', ');
      }
      return 'N/A'; 
    }
  
    if (entityType === 'subjects' && fieldName === 'type') {
      const shortType: Record<string, string> = { STANDARD: 'ปกติ', TEACHER_ONLY: 'เฉพาะครู', STUDENT_ONLY: 'เฉพาะนักเรียน' };
      if (shortType[String(value)]) return shortType[String(value)];
    }

    if (entityType === 'subjects' && fieldName === 'applicableSemesters' && Array.isArray(value)) {
      return value.map(v => `ภาค ${v}`).join(', ');
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


  // Subjects table shows only the key columns so it fits the screen; everything else is in the edit form
  const SUBJECT_TABLE_FIELDS = ['name', 'subjectCode', 'department', 'periodsPerWeek', 'color', 'type', 'applicableParentGradeLevelIds', 'applicableSemesters'];
  const tableFields = entityType === 'subjects' ? formFields.filter(f => SUBJECT_TABLE_FIELDS.includes(f.name as string)) : formFields;
  const teacherDepartments = useMemo(() => {
    if (entityType !== 'teachers') return [] as string[];
    return Array.from(new Set((items as any[]).map(t => t.department).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'th')) as string[];
  }, [items, entityType]);

  const subjectDepartments = useMemo(() => {
    if (entityType !== 'subjects') return [] as string[];
    return Array.from(new Set((items as unknown as SubjectType[]).map(s => s.department).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'th'));
  }, [items, entityType]);
  const colorPreview = useMemo(() => {
    if (!isColorToolOpen || entityType !== 'subjects') return new Map<string, string>();
    return computeSubjectColors(filteredItems as unknown as SubjectType[], colorMode, colorBase);
  }, [isColorToolOpen, entityType, filteredItems, colorMode, colorBase]);

  const applyColorTool = () => {
    const map = colorPreview;
    setItems(prev => prev.map(it => (map.has(it.id) ? { ...it, color: map.get(it.id) } : it)) as unknown as T[]);
    setIsColorToolOpen(false);
    setToastMessage?.(`ปรับสีรายวิชา ${map.size} รายการแล้ว`);
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    let dataAOA: (string | number | boolean | undefined)[][] = [];
    let sheetName = entityNameSingular;

    if (entityType === 'teachers') {
      const headers = ["ชื่อ-สกุล", "รหัสครู", "อีเมล", "กลุ่มสาระการเรียนรู้", "ห้องประจำชั้น/ที่ปรึกษา"];
      const rows = (filteredItems as unknown as Teacher[]).map(t => {
        const homeroomNames = (t.homeroomGradeLevelIds || [])
          .map(id => appData.gradeLevels.find(g => g.id === id)?.name || id)
          .join(', ');
        return [t.name || '', t.teacherCode || '', t.email || '', t.department || '', homeroomNames];
      });
      dataAOA = [headers, ...rows];
    } else if (entityType === 'subjects') {
      const headers = [
        "ชื่อวิชา", "รหัสวิชา", "จำนวนคาบ/สัปดาห์", "กลุ่มสาระการเรียนรู้", "สีประจำวิชา",
        "รูปแบบการสอน", "รูปแบบการจัดคาบ", "อนุญาตให้ใช้ห้องร่วม", "วิชาเรียนรวม",
        "วิชาโฮมรูม/แนะแนว", "ผูกกับครูประจำชั้นอัตโนมัติ", "ระดับชั้นที่เปิดสอน", "ประเภทห้องที่จำกัด", "ภาคเรียนที่เปิดสอน"
      ];
      const rows = (filteredItems as unknown as Subject[]).map(s => {
        const applicableGrades = (s.applicableParentGradeLevelIds || [])
          .map(id => appData.gradeLevels.find(g => g.id === id)?.name || id)
          .join(', ');
        const restrictedRooms = (s.restrictedRoomTypes || []).join(', ');
        return [
          s.name || '', s.subjectCode || '', s.periodsPerWeek ?? 1, s.department || '', s.color || '#3B82F6',
          s.teachingMode || 'single', s.schedulingPattern || '',
          (s.allowPhysicalRoomSharing ?? s.allowClassroomSharing) ? 'ใช่' : 'ไม่ใช่',
          s.isBroadAssignment ? 'ใช่' : 'ไม่ใช่',
          s.isHomeroomAdvisorySubject ? 'ใช่' : 'ไม่ใช่',
          s.autoLinkToHomeroomTeachers ? 'ใช่' : 'ไม่ใช่',
          applicableGrades,
          restrictedRooms,
          (s.applicableSemesters || []).join(', ')
        ];
      });
      dataAOA = [headers, ...rows];
    } else if (entityType === 'gradeLevels' || entityType === 'classrooms') {
      const headers = [entityType === 'classrooms' ? "ชื่อห้องเรียน" : "ชื่อระดับชั้น", "ห้องประจำ/โฮมรูม", "คำอธิบาย"];
      const rows = (filteredItems as unknown as GradeLevel[]).map(g => {
        const room = appData.physicalRooms.find(r => r.id === g.homeroomPhysicalRoomId);
        return [g.name || '', room ? formatRoomDisplay(room) : '', g.description || ''];
      });
      dataAOA = [headers, ...rows];
    } else if (entityType === 'physicalRooms') {
      const headers = ["รหัสห้อง", "ชื่อห้อง", "ประเภทห้อง", "ความจุ (คน)"];
      const rows = (filteredItems as unknown as PhysicalRoom[]).map(r => [
        r.code || '', r.name || '', r.type || 'ห้องเรียนทั่วไป', r.capacity ?? 40
      ]);
      dataAOA = [headers, ...rows];
    } else {
      const headers = formFields.map(f => f.label);
      const rows = filteredItems.map(item => formFields.map(f => (item as any)[f.name] || ''));
      dataAOA = [headers, ...rows];
    }

    const ws = XLSX.utils.aoa_to_sheet(dataAOA);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${entityNamePlural}_export.xlsx`);
  };

  return (
    <div className="p-4 md:p-6 bg-white shadow-lg rounded-lg relative">
      {toastMessage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none print:hidden">
            <div className="pointer-events-auto w-full max-w-sm bg-slate-800 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 animate-in fade-in zoom-in-95 duration-200">
              <Icons.CheckCircle className="w-5 h-5 shrink-0 text-emerald-400" />
              <span className="font-medium min-w-0 break-words">{toastMessage}</span>
            </div>
          </div>
      )}
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center">
          {IconComponent && <IconComponent size={32} className="mr-3 text-blue-600" />}
          <h2 className="text-2xl font-semibold text-slate-800">Manage {entityNamePlural}</h2>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-3.5 rounded-md shadow-sm transition-colors duration-150 text-sm"
            title={`ส่งออกข้อมูล ${entityNamePlural} เป็นไฟล์ Excel (.xlsx)`}
          >
            <Icons.Download size={16} className="mr-1.5" /> Export Excel
          </button>
          <button
            onClick={openModalForNew}
            className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md shadow-md transition-colors duration-150 text-sm"
          >
            <Icons.Add size={18} className="mr-1.5" /> Add New {entityNameSingular}
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
        {entityType === 'subjects' && (
          <>
            <div className="sm:w-64">
              <SearchableSelect
                value={selectedDepartmentFilter}
                onChange={setSelectedDepartmentFilter}
                placeholder="ค้นหากลุ่มสาระฯ"
                options={[{ value: '', label: 'ทุกกลุ่มสาระฯ (All Departments)' }, ...subjectDepartments.map(d => ({ value: d, label: d }))]}
              />
            </div>
            <button
              type="button"
              onClick={() => setIsColorToolOpen(true)}
              disabled={filteredItems.length === 0}
              className="px-3 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 rounded-md border border-slate-300 shadow-sm whitespace-nowrap disabled:opacity-50"
              title="กำหนดสีให้รายวิชาที่แสดงอยู่ทีเดียว"
            >
              🎨 จัดสีรายวิชา
            </button>
          </>
        )}
        {entityType === 'physicalRooms' && (
          <div className="sm:w-64">
            <SearchableSelect
              value={selectedRoomType}
              onChange={setSelectedRoomType}
              placeholder="ค้นหาประเภทห้อง"
              options={[{ value: '', label: 'All Room Types (ทุกประเภทห้อง)' }, ...(appData.resourceTypes || []).map((rt: any) => ({ value: rt.name, label: rt.name }))]}
            />
          </div>
        )}
        {entityType === 'teachers' && (
          <>
            <div className="sm:w-64">
              <SearchableSelect
                value={selectedTeacherDept}
                onChange={setSelectedTeacherDept}
                placeholder="ค้นหากลุ่มสาระฯ"
                options={[{ value: '', label: 'ทุกกลุ่มสาระฯ (All Departments)' }, ...teacherDepartments.map(d => ({ value: d, label: d }))]}
              />
            </div>
            <div className="sm:w-56">
              <SearchableSelect
                value={selectedTeacherHomeroom}
                onChange={setSelectedTeacherHomeroom}
                placeholder="ค้นหาห้องประจำชั้น"
                options={[
                  { value: '', label: 'ทุกห้องประจำชั้น' },
                  { value: '__none__', label: 'ไม่ได้เป็นครูที่ปรึกษา' },
                  ...[...appData.gradeLevels]
                    .filter(g => g.name.includes('/'))
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                    .map(g => ({ value: g.id, label: thaiGradeName(g.name), searchText: `${g.name} ${thaiGradeName(g.name)}` })),
                ]}
              />
            </div>
          </>
        )}
      </div>

      {filteredItems.length === 0 ? (
         <p className="text-slate-500 text-center py-8">
            {searchTerm ? `No ${entityNamePlural.toLowerCase()} found matching your search.` : `No ${entityNamePlural.toLowerCase()} found. Click "Add New ${entityNameSingular}" to get started.`}
        </p>
      ) : (
        <div className={`overflow-auto rounded-md border border-slate-200 max-h-[68vh]`}>
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                {tableFields.map(field => (
                    <th key={field.name as string} scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                        {field.label}
                    </th>
                ))}
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider sticky right-0 bg-slate-50">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {filteredItems.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  {tableFields.map(field => (
                    <td key={field.name as string} className={`px-4 py-3 text-sm text-slate-700 ${entityType === 'subjects' && field.name === 'name' ? 'min-w-[12rem]' : 'whitespace-nowrap'}`}>
                        {entityType === 'gradeLevels' && field.name === 'description' ? (
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
                  <td className={`px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-2 ${entityType === 'subjects' ? 'sticky right-0 bg-white' : ''}`}>
                    {entityType === 'subjects' && (
                      <button
                        onClick={() => openModalForCopy(item)}
                        className="text-emerald-600 hover:text-emerald-800 transition-colors"
                        title="คัดลอกรายวิชา (สร้างใหม่จากรายละเอียดเดิม แล้วแก้รหัสวิชา)"
                      >
                        <Icons.Copy size={18} />
                      </button>
                    )}

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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isColorToolOpen && entityType === 'subjects' && (
        <Modal isOpen={isColorToolOpen} onClose={() => setIsColorToolOpen(false)} title="จัดสีรายวิชา" size="lg">
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              ใช้กับรายวิชาที่แสดงอยู่ <b>{filteredItems.length}</b> รายการ
              {selectedDepartmentFilter ? ` (กลุ่มสาระฯ: ${selectedDepartmentFilter})` : ''} — เรียงตามรหัสวิชา
              <br /><span className="text-xs text-slate-500">ใช้ช่องค้นหา/ตัวกรองกลุ่มสาระฯ เพื่อเลือกกลุ่มย่อย เช่น ค้นหา "ฟิสิกส์" หรือ "ว3"</span>
            </p>
            <div className="space-y-2">
              {([
                ['solid', 'สีเดียวกันทั้งหมด'],
                ['gradient', 'ไล่เฉดสีจากสีหลัก (เข้ม → อ่อน ตามรหัสวิชา)'],
                ['byDepartment', 'แยกสีตามกลุ่มสาระฯ และไล่เฉดภายในกลุ่ม'],
              ] as [SubjectColorMode, string][]).map(([m, label]) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="colorMode" checked={colorMode === m} onChange={() => setColorMode(m)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {colorMode !== 'byDepartment' && (
              <div className="flex items-center gap-3">
                <span className="text-slate-700">สีหลัก</span>
                <input type="color" value={colorBase} onChange={e => setColorBase(e.target.value.toUpperCase())} className="h-9 w-14 border border-slate-300 rounded" />
                <span className="font-mono text-slate-600">{colorBase}</span>
              </div>
            )}
            <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
              {(filteredItems as unknown as SubjectType[]).map(sj => (
                <div key={sj.id} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-4 h-4 rounded-full border border-slate-300 shrink-0" style={{ backgroundColor: sj.color }} title="สีเดิม" />
                  <span className="text-slate-400">→</span>
                  <span className="w-4 h-4 rounded-full border border-slate-300 shrink-0" style={{ backgroundColor: colorPreview.get(sj.id) }} title="สีใหม่" />
                  <span className="font-mono text-xs text-slate-500 w-24 shrink-0">{sj.subjectCode || '-'}</span>
                  <span className="truncate">{sj.name}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setIsColorToolOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300">ยกเลิก</button>
              <button type="button" onClick={applyColorTool} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm">ใช้สีใหม่ ({colorPreview.size})</button>
            </div>
          </div>
        </Modal>
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
                        <label htmlFor={field.name as string} className={`text-sm font-medium ${isDisabled ? 'text-slate-400' : 'text-slate-700'}`}>
                            {field.label} {field.required && <span className="text-red-500">*</span>}
                        </label>
                        {entityType === 'subjects' && isDisabled && subjectFlagLockReason(currentItem, field.name as SubjectFlagField) && (
                          <span className="ml-2 text-xs text-slate-400">({subjectFlagLockReason(currentItem, field.name as SubjectFlagField)})</span>
                        )}
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
