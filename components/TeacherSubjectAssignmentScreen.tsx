import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Teacher, Subject, TeacherSubjectAssignment, GradeLevel, AppData, FormField, Identifiable, ScreenAccessProps } from '../types';
import Modal from './Modal';
import ConfirmationModal from './ConfirmationModal'; // Import ConfirmationModal
import { Icons } from '../constants';
import { ArrowUp, ArrowDown, Search, X } from 'lucide-react';

interface TeacherSubjectAssignmentScreenProps extends ScreenAccessProps {
  appData: AppData; // Pass full AppData
  assignments: TeacherSubjectAssignment[];
  setAssignments: React.Dispatch<React.SetStateAction<TeacherSubjectAssignment[]>>;
  getIcon: () => React.ElementType;
  fields: FormField[]; // Pass fields for dynamic options
}

const TeacherSubjectAssignmentScreen: React.FC<TeacherSubjectAssignmentScreenProps> = ({
  appData,
  assignments,
  setAssignments,
  getIcon,
  fields,
  permissions,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAssignment, setNewAssignment] = useState<{ teacherId: string; subjectId: string; selectedGradeLevelIds: string[] }>({ 
    teacherId: '',
    subjectId: '',
    selectedGradeLevelIds: [], 
  });
  const [error, setError] = useState<string | null>(null);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const [assignmentToDeleteId, setAssignmentToDeleteId] = useState<string | null>(null);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);

  // Sorting & Filtering States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGradeLevelId, setSelectedGradeLevelId] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [sortField, setSortField] = useState<'teacher' | 'subject' | 'gradeLevel'>('teacher');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const IconComponent = getIcon();

  const openModal = () => {
    setNewAssignment({ teacherId: '', subjectId: '', selectedGradeLevelIds: [] }); 
    setError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setError(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value, options } = e.target;
    if (name === 'selectedGradeLevelIds') {
      const selectedIds = Array.from(options)
        .filter((option: any) => option.selected)
        .map((option: any) => option.value);
      setNewAssignment(prev => ({ ...prev, selectedGradeLevelIds: selectedIds }));
    } else if (name === 'subjectId') {
      const selectedSub = appData.subjects.find(s => s.id === value);
      let teacherId = newAssignment.teacherId;
      let selectedGradeLevelIds = newAssignment.selectedGradeLevelIds;

      if (selectedSub?.type === 'TEACHER_ONLY') {
        selectedGradeLevelIds = ['Non-Student'];
        if (teacherId === 'No Teacher Assigned') {
          teacherId = '';
        }
      } else if (selectedSub?.type === 'STUDENT_ONLY') {
        teacherId = 'No Teacher Assigned';
        if (selectedGradeLevelIds.length === 1 && selectedGradeLevelIds[0] === 'Non-Student') {
          selectedGradeLevelIds = [];
        }
      } else {
        if (teacherId === 'No Teacher Assigned') {
          teacherId = '';
        }
        if (selectedGradeLevelIds.length === 1 && selectedGradeLevelIds[0] === 'Non-Student') {
          selectedGradeLevelIds = [];
        }
      }
      setNewAssignment(prev => ({
        ...prev,
        subjectId: value,
        teacherId,
        selectedGradeLevelIds
      }));
    } else {
      setNewAssignment(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const targetSubject = appData.subjects.find(s => s.id === newAssignment.subjectId);
    const isTeacherOnly = targetSubject?.type === 'TEACHER_ONLY';
    const isStudentOnly = targetSubject?.type === 'STUDENT_ONLY';

    const teacherIdVal = isStudentOnly ? 'No Teacher Assigned' : newAssignment.teacherId;
    const selectedGradeLevelIdsVal = isTeacherOnly ? ['Non-Student'] : newAssignment.selectedGradeLevelIds;

    if (!teacherIdVal || !newAssignment.subjectId || !selectedGradeLevelIdsVal || selectedGradeLevelIdsVal.length === 0) { 
      setError('ข้อผิดพลาดการตรวจพบ: กรุณากรอกหัวข้อเลือกให้ครบถ้วน');
      return;
    }

    // Verify entities actually exist in appData (prevent "Unknown Grade" or orphaned data)
    const teacherExists = teacherIdVal === 'No Teacher Assigned' || appData.teachers.some(t => t.id === teacherIdVal);
    if (!teacherExists) {
      setError('ข้อผิดพลาดการตรวจพบ: ไม่พบข้อมูลครูผู้สอนผู้นี้ในฐานข้อมูลของโรงเรียน');
      return;
    }

    const subjectExists = appData.subjects.some(s => s.id === newAssignment.subjectId);
    if (!subjectExists) {
      setError('ข้อผิดพลาดการตรวจพบ: ไม่พบวิชารายวิชานี้ในฐานข้อมูลวิชาเรียน');
      return;
    }

    const invalidGradeId = selectedGradeLevelIdsVal.find(id => id !== 'Non-Student' && !appData.gradeLevels.some(gl => gl.id === id));
    if (invalidGradeId) {
      setError('ข้อผิดพลาดการตรวจพบ: ไม่พบข้อมูลระดับชั้นเรียน/ห้องเรียนสำหรับการประสานงาน');
      return;
    }

    const periodsPerWeekToBind = targetSubject?.periodsPerWeek || 0;
    
    const targetTeacher = appData.teachers.find(t => t.id === teacherIdVal);
    const departmentToBind = appData.currentUser?.role === 'assistant'
      ? (appData.currentUser?.assignedDepartments?.[0] || targetTeacher?.department || targetSubject?.department || '')
      : (targetTeacher?.department || targetSubject?.department || '');

    const newEntriesToAdd: TeacherSubjectAssignment[] = [];
    const skippedMessages: string[] = [];

    selectedGradeLevelIdsVal.forEach(gradeId => {
      const existingAssignment = assignments.find(
        asm => asm.teacherId === teacherIdVal && 
               asm.subjectId === newAssignment.subjectId &&
               asm.gradeLevelId === gradeId 
      );

      if (existingAssignment) {
        const teacherName = getTeacherName(teacherIdVal);
        const subjectName = getSubjectName(newAssignment.subjectId);
        const gradeName = getGradeLevelName(gradeId);
        skippedMessages.push(`ข้ามการนำเข้า ${gradeName} เนื่องจากมีการจับคู่ครู ${teacherName} สอนวิชา ${subjectName} แล้ว`);
      } else {
        newEntriesToAdd.push({
          id: crypto.randomUUID(),
          teacherId: teacherIdVal,
          subjectId: newAssignment.subjectId,
          gradeLevelId: gradeId,
          periodsPerWeek: periodsPerWeekToBind,
          department: departmentToBind,
        });
      }
    });

    if (newEntriesToAdd.length > 0) {
      setAssignments(prev => [...prev, ...newEntriesToAdd]);
    }
    
    let finalMessage = "";
    if (newEntriesToAdd.length > 0) {
      finalMessage += `บันทึกรายการเชื่อมโยงใหม่สำเร็จจำนวน ${newEntriesToAdd.length} รายการ. `;
    }
    if (skippedMessages.length > 0) {
      finalMessage += `ตรวจพบข้อมูลเดิมรายการซ้ำ ข้ามจำนวน ${skippedMessages.length} รายการ.`;
    }
    
    if (finalMessage) {
      alert(finalMessage.trim()); 
    }
    
    if (newEntriesToAdd.length > 0) {
        closeModal(); 
    } else if (skippedMessages.length === selectedGradeLevelIdsVal.length && selectedGradeLevelIdsVal.length > 0) {
        setError("ประวัติข้อมูลเชื่อมโยงนี้ได้รับจัดคู่ทั้งหมดแล้วในระบบ");
    }
  };

  const requestDelete = (id: string) => {
    if (!permissions.canModifyTeacherSubjectLinks) {
        alert('คุณไม่มีสิทธิ์ในการลบการเชื่อมโยงครู-วิชา');
        return;
    }

    const assignment = assignments.find(a => a.id === id);
    if (assignment) {
        const scheduleEntries = Array.isArray(appData.scheduleEntries) ? appData.scheduleEntries : [];
        const hasDependencies = scheduleEntries.some(entry => 
            entry.subjectId === assignment.subjectId && 
            entry.teacherIds?.includes(assignment.teacherId) && 
            entry.gradeLevelId === assignment.gradeLevelId
        );
        if (hasDependencies) {
            setIsBlockModalOpen(true);
            return;
        }
    }

    setAssignmentToDeleteId(id);
    setIsConfirmDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (assignmentToDeleteId) {
      setAssignments(prev => prev.filter(asm => asm.id !== assignmentToDeleteId));
    }
    setIsConfirmDeleteModalOpen(false);
    setAssignmentToDeleteId(null);
  };

  const getTeacherName = (teacherId: string) => {
    if (teacherId === 'No Teacher Assigned') return 'No Teacher Assigned (Student-Only)';
    return appData.teachers.find(t => t.id === teacherId)?.name || 'Unknown Teacher';
  };
  
  // Format update: "[Code] Subject Name"
  const getSubjectName = (subjectId: string) => {
    const subject = appData.subjects.find(s => s.id === subjectId);
    if (!subject) return 'Unknown Subject';
    return subject.subjectCode ? `[${subject.subjectCode}] ${subject.name}` : subject.name;
  };

  const getGradeLevelName = (gradeLevelId: string) => {
    if (gradeLevelId === 'Non-Student') return 'Non-Student (Teacher-Only)';
    return appData.gradeLevels.find(gl => gl.id === gradeLevelId)?.name || 'Unknown Grade';
  };

  // Get unique departments from both subjects and teachers
  const departments = useMemo(() => {
    const depts = new Set<string>();
    appData.subjects.forEach(s => { if (s.department) depts.add(s.department); });
    appData.teachers.forEach(t => { if (t.department) depts.add(t.department); });
    return Array.from(depts).sort((a, b) => a.localeCompare(b, 'th', { sensitivity: 'base' }));
  }, [appData.subjects, appData.teachers]);

  // Filtering Logic
  const filteredAssignments = useMemo(() => {
    return assignments.filter(asm => {
      const teacher = appData.teachers.find(t => t.id === asm.teacherId);
      const subject = appData.subjects.find(s => s.id === asm.subjectId);
      
      const teacherName = teacher?.name || '';
      const teacherCode = teacher?.teacherCode || '';
      
      const matchSearch = searchQuery.trim() === '' || 
        teacherName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        teacherCode.toLowerCase().includes(searchQuery.toLowerCase());
        
      const matchGrade = selectedGradeLevelId === '' || asm.gradeLevelId === selectedGradeLevelId;
      const matchSubject = selectedSubjectId === '' || asm.subjectId === selectedSubjectId;
      
      const matchDept = selectedDepartment === '' || 
        asm.department === selectedDepartment || 
        teacher?.department === selectedDepartment || 
        subject?.department === selectedDepartment;
        
      return matchSearch && matchGrade && matchSubject && matchDept;
    });
  }, [assignments, appData.teachers, appData.subjects, searchQuery, selectedGradeLevelId, selectedSubjectId, selectedDepartment]);

  // Sorting Logic (Locale-aware & Numeric supported)
  const sortedAssignments = useMemo(() => {
    const list = [...filteredAssignments];
    list.sort((a, b) => {
      let valA = '';
      let valB = '';
      
      if (sortField === 'teacher') {
        const teacherA = appData.teachers.find(t => t.id === a.teacherId);
        const teacherB = appData.teachers.find(t => t.id === b.teacherId);
        valA = teacherA?.name || '';
        valB = teacherB?.name || '';
      } else if (sortField === 'subject') {
        const subjectA = appData.subjects.find(s => s.id === a.subjectId);
        const subjectB = appData.subjects.find(s => s.id === b.subjectId);
        valA = subjectA?.subjectCode || subjectA?.name || '';
        valB = subjectB?.subjectCode || subjectB?.name || '';
      } else if (sortField === 'gradeLevel') {
        const gradeA = appData.gradeLevels.find(g => g.id === a.gradeLevelId);
        const gradeB = appData.gradeLevels.find(g => g.id === b.gradeLevelId);
        valA = gradeA?.name || '';
        valB = gradeB?.name || '';
      }
      
      const comparison = valA.localeCompare(valB, 'th', { sensitivity: 'base', numeric: true });
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return list;
  }, [filteredAssignments, sortField, sortDirection, appData.teachers, appData.subjects, appData.gradeLevels]);

  const hasActiveFilters = searchQuery !== '' || selectedGradeLevelId !== '' || selectedDepartment !== '' || selectedSubjectId !== '' || sortField !== 'teacher' || sortDirection !== 'asc';

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedGradeLevelId('');
    setSelectedDepartment('');
    setSelectedSubjectId('');
    setSortField('teacher');
    setSortDirection('asc');
  };

  const modalFields: FormField[] = [
    { name: 'teacherId', label: 'Teacher (ครูผู้สอน)', type: 'select', optionsSource: 'teachers', required: true },
    { name: 'subjectId', label: 'Subject (วิชาหลัก/วิชาเลือก)', type: 'select', optionsSource: 'subjects', required: true },
    { name: 'gradeLevelId', label: 'Grade Level/Rooms (ระดับชั้น/ห้องเรียน)', type: 'select', optionsSource: 'gradeLevels', required: true }
  ];

  const renderSelectField = (field: FormField, isMultiSelect: boolean = false) => {
    if (field.type !== 'select' || !field.optionsSource) return null;
    
    const selectedSub = appData.subjects.find(s => s.id === newAssignment.subjectId);
    const isTeacherOnly = selectedSub?.type === 'TEACHER_ONLY';
    const isStudentOnly = selectedSub?.type === 'STUDENT_ONLY';

    if (field.name === 'gradeLevelId' && isTeacherOnly) {
      return null;
    }
    if (field.name === 'teacherId' && isStudentOnly) {
      return null;
    }

    let sourceData = appData[field.optionsSource] as Identifiable[];

    const isAssistant = appData.currentUser?.role === 'assistant';
    const assignedDepts = appData.currentUser?.assignedDepartments || [];

    if (isAssistant) {
      if (field.optionsSource === 'teachers') {
        sourceData = (sourceData as Teacher[]).filter(t => t.department && assignedDepts.includes(t.department));
      } else if (field.optionsSource === 'subjects') {
        sourceData = (sourceData as Subject[]).filter(s => {
          if ((s as any).department && assignedDepts.includes((s as any).department)) return true;
          return appData.teacherSubjectAssignments.some(link => 
            link.subjectId === s.id && 
            appData.teachers.some(t => t.id === link.teacherId && t.department && assignedDepts.includes(t.department))
          );
        });
      }
    }

    if (field.optionsSource === 'gradeLevels' || field.optionsSource === 'physicalRooms') {
        sourceData = [...sourceData].sort((a, b) => ((a as any).name || '').localeCompare((b as any).name || '', undefined, { numeric: true, sensitivity: 'base' }));
    } else if (field.optionsSource === 'teachers') {
        sourceData = [...sourceData].sort((a, b) => {
            const codeA = (a as any).teacherCode || '';
            const codeB = (b as any).teacherCode || '';
            if (codeA !== codeB) {
                return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
            }
            return ((a as any).name || '').localeCompare(((b as any).name || ''), undefined, { sensitivity: 'base' });
        });
    } else if (field.optionsSource === 'subjects') {
        sourceData = [...sourceData].sort((a, b) => ((a as any).subjectCode || '').localeCompare(((b as any).subjectCode || ''), undefined, { numeric: true, sensitivity: 'base' }));
    }

    const options = sourceData.map(item => {
        let label = (item as any).name || item.id;
        if (field.optionsSource === 'teachers' && (item as any).teacherCode) {
            label = `${(item as any).name} (${(item as any).teacherCode})`;
        } else if (field.optionsSource === 'subjects' && (item as any).subjectCode) {
            // Updated Format consistent with column
            label = `[${(item as any).subjectCode}] ${(item as any).name}`;
        }
        return { value: item.id, label };
    });
    
    const fieldName = isMultiSelect ? 'selectedGradeLevelIds' : (field.name as string);
    const fieldValue = isMultiSelect ? (newAssignment.selectedGradeLevelIds || []) : ((newAssignment as any)[fieldName] || '');

    return (
        <div key={fieldName}>
            <label htmlFor={fieldName} className="block text-sm font-medium text-slate-700 mb-1">
            {field.label} <span className="text-red-500">*</span>
            </label>
            <select
              id={fieldName}
              name={fieldName}
              value={fieldValue}
              onChange={handleInputChange}
              multiple={isMultiSelect}
              size={isMultiSelect ? 5 : undefined}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              required
            >
            {!isMultiSelect && <option value="" disabled>Select {field.label}</option>}
            {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            </select>
        </div>
    );
  };

  const handleExportAssignmentsExcel = () => {
    const wb = XLSX.utils.book_new();
    const headers = [
      "ครูผู้สอน", 
      "รหัสครู", 
      "รายวิชา", 
      "รหัสวิชา", 
      "ระดับชั้น/ห้องเรียน", 
      "กลุ่มสาระการเรียนรู้", 
      "จำนวนคาบ/สัปดาห์"
    ];
    const rows = filteredAssignments.map(a => {
      const teacher = appData.teachers.find(t => t.id === a.teacherId);
      const subject = appData.subjects.find(s => s.id === a.subjectId);
      const grade = appData.gradeLevels.find(g => g.id === a.gradeLevelId);
      return [
        teacher?.name || a.teacherId,
        teacher?.teacherCode || '',
        subject?.name || a.subjectId,
        subject?.subjectCode || '',
        grade?.name || a.gradeLevelId,
        subject?.department || teacher?.department || '',
        subject?.periodsPerWeek ?? 1
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, "การมอบหมายสอน");
    XLSX.writeFile(wb, `การมอบหมายสอน_export.xlsx`);
  };

  return (
    <div className="p-4 md:p-6 bg-white shadow-lg rounded-lg">
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center">
          {IconComponent && <IconComponent size={32} className="mr-3 text-blue-600" />}
          <h2 className="text-2xl font-semibold text-slate-800">Manage Teacher-Subject Links</h2>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleExportAssignmentsExcel}
            className="flex items-center bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-3.5 rounded-md shadow-sm transition-colors duration-150 text-sm"
            title="ส่งออกรายการมอบหมายการสอนเป็นไฟล์ Excel (.xlsx)"
          >
            <Icons.Download size={16} className="mr-1.5" /> Export Excel ({filteredAssignments.length})
          </button>
          <button
            onClick={openModal}
            className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md shadow-md transition-colors duration-150 text-sm"
          >
            <Icons.Add size={18} className="mr-1.5" /> Add New Link
          </button>
        </div>
      </div>

      {/* Advanced Filtering Toolbar */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 shadow-sm">
        <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Icons.Search size={18} className="text-slate-500" />
          <span>เครื่องมือค้นหาและกรองข้อมูล (Filters & Search)</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Text Search Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">ค้นหาครูผู้สอน (Teacher Name/Code)</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ชื่อครู หรือ รหัสครู..."
                className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
              <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Grade Level Filter */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">ระดับชั้นเรียน (Grade Level)</label>
            <select
              value={selectedGradeLevelId}
              onChange={(e) => setSelectedGradeLevelId(e.target.value)}
              className="w-full py-2 px-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">ทั้งหมด (Show All)</option>
              {appData.gradeLevels.map(gl => (
                <option key={gl.id} value={gl.id}>{gl.name}</option>
              ))}
            </select>
          </div>

          {/* Department Filter */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">กลุ่มสาระการเรียนรู้ (Department)</label>
            <select
              value={selectedDepartment}
              onChange={(e) => {
                setSelectedDepartment(e.target.value);
                setSelectedSubjectId('');
              }}
              className="w-full py-2 px-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">ทั้งหมด (Show All)</option>
              {departments.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          </div>

          {/* Subject Filter */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">รายวิชา (Subject)</label>
            <select
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="w-full py-2 px-3 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">ทั้งหมด (Show All)</option>
              {appData.subjects
                .filter(s => !selectedDepartment || s.department === selectedDepartment)
                .map(sub => (
                  <option key={sub.id} value={sub.id}>
                    {sub.subjectCode ? `[${sub.subjectCode}] ${sub.name}` : sub.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Action and Sort Row */}
        <div className="flex flex-col sm:flex-row items-center justify-between mt-4 pt-3 border-t border-slate-200 gap-4">
          {/* Quick Sort Dropdown Selection */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">เรียงลำดับ (Sort By):</span>
            <select
              value={`${sortField}-${sortDirection}`}
              onChange={(e) => {
                const [field, direction] = e.target.value.split('-');
                setSortField(field as any);
                setSortDirection(direction as any);
              }}
              className="py-1 px-3 text-xs border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-700"
            >
              <option value="teacher-asc">ชื่อครูผู้สอน (ก-ฮ)</option>
              <option value="teacher-desc">ชื่อครูผู้สอน (ฮ-ก)</option>
              <option value="subject-asc">รหัสวิชา (ก-ฮ)</option>
              <option value="subject-desc">รหัสวิชา (ฮ-ก)</option>
              <option value="gradeLevel-asc">ระดับชั้น (น้อย-มาก)</option>
              <option value="gradeLevel-desc">ระดับชั้น (มาก-น้อย)</option>
            </select>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <span className="text-xs text-slate-500">
              พบ {sortedAssignments.length} รายการ จากทั้งหมด {assignments.length} รายการ
            </span>
            
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <X size={14} />
                <span>ล้างตัวกรองทั้งหมด (Clear All)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {sortedAssignments.length === 0 ? (
        <p className="text-slate-500 text-center py-8 bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
          {assignments.length === 0 
            ? 'No teacher-subject links found. Click "Add New Link" to get started.' 
            : 'ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา/ตัวกรอง'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                {fields.map((field, index) => {
                  let fieldSortKey: 'teacher' | 'subject' | 'gradeLevel' | null = null;
                  if (index === 0) fieldSortKey = 'teacher';
                  else if (index === 1) fieldSortKey = 'subject';
                  else if (index === 2) fieldSortKey = 'gradeLevel';
                  
                  const isSorted = sortField === fieldSortKey;
                  
                  return (
                     <th 
                        key={field.name as string} 
                        scope="col" 
                        onClick={() => {
                          if (fieldSortKey) {
                            if (sortField === fieldSortKey) {
                              setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setSortField(fieldSortKey);
                              setSortDirection('asc');
                            }
                          }
                        }}
                        className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:bg-slate-100 transition-colors group"
                     >
                        <div className="flex items-center gap-1">
                          <span>{field.label}</span>
                          {fieldSortKey && (
                            <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
                              {isSorted ? (
                                sortDirection === 'asc' ? <ArrowUp size={14} className="inline ml-0.5" /> : <ArrowDown size={14} className="inline ml-0.5" />
                              ) : (
                                <span className="opacity-40 group-hover:opacity-100 text-[10px] text-slate-300 ml-0.5">↕</span>
                              )}
                            </span>
                          )}
                        </div>
                     </th>
                  );
                })}
                <th scope="col" className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {sortedAssignments.map(asm => (
                <tr key={asm.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700">
                    {getTeacherName(asm.teacherId)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-700 font-medium">
                    {getSubjectName(asm.subjectId)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-600">
                    {getGradeLevelName(asm.gradeLevelId)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => requestDelete(asm.id)}
                      className={`transition-colors p-1 rounded-md ${permissions.canModifyTeacherSubjectLinks ? 'text-red-600 hover:text-red-800 hover:bg-red-50' : 'text-slate-400 cursor-not-allowed'}`}
                      title={permissions.canModifyTeacherSubjectLinks ? "Delete Link" : "Deletion restricted to managers"}
                      disabled={!permissions.canModifyTeacherSubjectLinks}
                    >
                      <Icons.Delete size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={closeModal} title="Add Teacher-Subject Link">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md mb-4 shadow-sm">
              <div className="flex">
                <div className="shrink-0">
                  <Icons.Warning className="h-5 w-5 text-red-500" aria-hidden="true" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-semibold text-red-800">{error}</p>
                </div>
              </div>
            </div>
          )}
          {modalFields.map(field => {
            const isGradeLevelField = field.name === 'gradeLevelId' && field.optionsSource === 'gradeLevels';
            return renderSelectField(field, isGradeLevelField);
          })}
           {newAssignment.selectedGradeLevelIds.length > 0 && (
                <p className="text-xs text-slate-500">
                    Selected {newAssignment.selectedGradeLevelIds.length} grade level(s).
                </p>
            )}
          <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
            >
              Add Link(s)
            </button>
          </div>
        </form>
      </Modal>
      
      <ConfirmationModal
        isOpen={isConfirmDeleteModalOpen}
        onClose={() => setIsConfirmDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Confirm Delete Link"
        message="คุณแน่ใจหรือไม่ที่จะลบลิงค์นี้?"
        confirmButtonText="Delete Link"
        icon={Icons.Warning}
      />

      <ConfirmationModal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        onConfirm={() => setIsBlockModalOpen(false)}
        title="ไม่สามารถลบลิงค์มอบหมายงานได้ (Action Blocked)"
        message="รายวิชานี้ของรายชื่อครูดังกล่าว ถูกจัดวางลงบนตารางเรียน (Timetable Grid) ไปเรียบร้อยแล้ว หากต้องการลบลิงค์นี้ กรุณาไปลบคาบเรียนของวิชานี้ออกจากตารางสอนของห้องดังกล่าวให้หมดก่อน จึงจะกลับมาทำรายการลบลิงค์นี้ได้"
        confirmButtonText="ตกลง (OK)"
        confirmButtonVariant="primary"
        icon={Icons.Warning}
        hideCancelButton={true}
      />
    </div>
  );
};

export default TeacherSubjectAssignmentScreen;
