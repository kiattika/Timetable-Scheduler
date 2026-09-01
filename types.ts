

import React from 'react';

export enum DayOfWeek {
  Monday = "Monday",
  Tuesday = "Tuesday",
  Wednesday = "Wednesday",
  Thursday = "Thursday",
  Friday = "Friday",
  Saturday = "Saturday",
  Sunday = "Sunday",
}

export interface Identifiable {
  id: string;
}

export interface Teacher extends Identifiable {
  name: string; // ชื่อ-สกุล
  teacherCode?: string; // รหัสครู
  department?: string; // กลุ่มสาระการเรียนรู้
  homeroomGradeLevelIds?: string[]; // Changed: ครูที่ปรึกษาประจำชั้น (can be multiple)
  email?: string; // Added: Email for the teacher
}

export type SubjectTeachingMode = 'single' | 'multiple';
export type SubjectType = 'STANDARD' | 'TEACHER_ONLY' | 'STUDENT_ONLY';

export interface Subject extends Identifiable {
  name: string; // ชื่อวิชา
  color: string; // Hex color string
  subjectCode?: string; // รหัสวิชา
  department?: string; // Added: Department for the subject
  periodsPerWeek?: number; // คาบเรียน (จำนวนคาบต่อสัปดาห์)
  teachingMode?: SubjectTeachingMode; // 'single' (default) or 'multiple'
  schedulingPattern?: string; // e.g., "2/1/1", "2/2", "1/1/1/1"
  allowPhysicalRoomSharing?: boolean; // Added: Allows subject to share physical room with others
  allowClassroomSharing?: boolean; // Legacy/alias: Allows subject to share classroom with others
  isBroadAssignment?: boolean; // Added: For subjects like Scouts that apply to all child grades of a parent
  isHomeroomAdvisorySubject?: boolean; // Added: For subjects like Homeroom period linked to homeroom teacher
  autoLinkToHomeroomTeachers?: boolean; // Added: If true and isHomeroomAdvisorySubject, auto-link to homeroom teachers
  applicableParentGradeLevelIds?: string[]; // Added: IDs of parent grade levels this subject applies to (for homeroom linking)
  type?: SubjectType; // Added: Subject Type for special periods (PLC, Independent Study)
  restrictedRoomTypes?: string[]; // Added: Room types (ResourceTypes) this subject is restricted to use
}

export interface GradeLevel extends Identifiable {
  name: string; 
  homeroomPhysicalRoomId?: string; // ID of the homeroom physical room for this specific grade
  description?: string; // Added: Description for the classroom
}

export interface Department extends Identifiable {
  name: string;
}

export interface ResourceType extends Identifiable {
  name: string;
}

export type RoomType = string; // Changed from union type to string to support dynamic resource types


export interface PhysicalRoom extends Identifiable {
  code: string; // Unique string code for the room (e.g., '931', 'F001')
  name: string; // Location Name / Description
  type: RoomType; // Location Type
  capacity?: number; // Capacity
}

export interface PeriodSetting {
  id: string; // Unique ID for the period slot definition
  label: string; // e.g., "P0", "P1" (shortened)
  startTime: string; // e.g., "08:00"
  endTime: string; // e.g., "08:50"
}

export interface ScheduleEntry {
  id: string;
  gradeLevelId: string;
  day: DayOfWeek;
  period: number; // 0-indexed period, corresponds to index in periodSettings array
  subjectId: string;
  teacherIds: string[]; // Changed from teacherId: string
  physicalRoomId?: string;
  blockId?: string; // Optional ID for grouping entries
  blockIndex?: number; // Optional 0-indexed position within a block
  totalInBlock?: number; // Optional total number of entries in this block
  cohort?: string; // Optional student cohort for split classes
  cachedSubjectName?: string;
  cachedSubjectCode?: string;
}

export interface TeacherSubjectAssignment extends Identifiable {
  teacherId: string;
  subjectId: string;
  gradeLevelId: string; // Added: Specifies which grade level this assignment is for
  periodsPerWeek?: number; // Auto-populated from the subjects collection
  department?: string; // Auto-bound from user's assignedDepartments
}

export interface OrganizationSettings {
  name: string; // ชื่อหน่วยงาน
  logoUrl?: string; // ตราประจำหน่วยงาน (base64 data URL)
  emblemUrl?: string; // รูปครุฑ (base64 data URL สำหรับเอกสารราชการ)
  address?: string; // ที่อยู่
  email?: string; // อีเมล์
  phone?: string; // เบอร์โทรศัพท์
  semester?: string; // ภาคเรียน
  academicYear?: string; // ปีการศึกษา
  directorName?: string; // ชื่อผู้อำนวยการ
  directorPosition?: string; // ตำแหน่งผู้อำนวยการ
  deputyDirectorName?: string; // ชื่อรองผู้อำนวยการ
  deputyDirectorPosition?: string; // ตำแหน่งรองผู้อำนวยการ
  semesterStartDate?: string; // วันเปิดภาคเรียน (YYYY-MM-DD)
  semesterEndDate?: string; // วันปิดภาคเรียน (YYYY-MM-DD)
  schoolHolidays?: string; // วันหยุด (คั่นด้วยบรรทัดใหม่)
  operatingDays?: DayOfWeek[]; // วันที่จัดการเรียนการสอน
  isLocked?: boolean; // ล็อคตารางเรียนประจำภาคเรียน
  allowedDomain?: string; // โดเมนที่อนุญาต
  schoolAdminEmail?: string; // อีเมลแอดมินโรงเรียน
  orderNumber?: string; // เลขที่คำสั่ง เช่น "371/2569"
  orderDate?: string; // วันที่ออกคำสั่ง เก็บเป็น string ISO เช่น "2026-08-27"
  department?: string; // กลุ่มบริหาร/กลุ่มงาน เช่น "กลุ่มบริหารวิชาการ"
  workGroupName?: string; // ชื่อกลุ่มงานเต็ม เช่น "กลุ่มงานวิชาการและหลักสูตร"
  proposerName?: string; // ชื่อผู้เสนอ (หัวหน้างานจัดตารางสอน)
  proposerPosition?: string; // ตำแหน่งผู้เสนอ เช่น "หัวหน้างานจัดตารางสอน"
  reviewerName?: string; // ชื่อผู้ตรวจสอบ (หัวหน้ากลุ่มงานวิชาการ)
  reviewerPosition?: string; // ตำแหน่งผู้ตรวจสอบ เช่น "หัวหน้ากลุ่มงานวิชาการและหลักสูตร"
  legalBasisText?: string; // อำนาจตามกฎหมาย (ข้อความยาว)
}

export type UserRole = 'admin' | 'manager' | 'teacher' | 'assistant' | 'guest';

export interface User extends Identifiable {
  name: string;
  email: string;
  role: UserRole;
  organizationId?: string;
  assignedDepartments?: string[];
  legacyUnclaimedRole?: string; // Flag for legacy accounts needing admin role re-confirmation via Custom Claims
}

export type ActivityLogAction = 'Added' | 'Removed' | 'Updated' | 'Cleared' | 'Logged In' | 'Login Failed';

export interface ActivityLog {
  id: string;
  timestamp: string;
  action: ActivityLogAction;
  description: string;
  user?: string; 
  details?: string;
}

export interface AppErrorLog {
  id: string;
  message: string;
  stack?: string;
  timestamp: string;
  userEmail?: string;
  userName?: string;
  url?: string;
  componentStack?: string;
  details?: string;
}

export interface AppData {
  teachers: Teacher[];
  subjects: Subject[];
  gradeLevels: GradeLevel[];
  physicalRooms: PhysicalRoom[];
  departments?: Department[];
  resourceTypes?: ResourceType[];
  scheduleEntries: ScheduleEntry[];
  periodSettings: PeriodSetting[];
  teacherSubjectAssignments: TeacherSubjectAssignment[];
  organizationSettings: OrganizationSettings | null;
  users: User[]; // Added for user management
  currentUser?: User | null; // Represents the "logged-in" user
  activityLogs?: ActivityLog[]; // Added for activity tracking
  authorizedAdmins?: string[]; // Dynamic in-app admin permission management
}

// EntityType now includes only main manageable entities via EntityManagementScreen
export type EntityType = 'teachers' | 'subjects' | 'gradeLevels' | 'classrooms' | 'physicalRooms' | 'departments' | 'resourceTypes';
// For TeacherSubjectAssignment specific management
export type TeacherAssignmentType = 'teacherSubjectAssignments';
// For PeriodSettings specific management
export type PeriodSettingsType = 'periodSettings';
// For User management
export type UserManagementType = 'users';
// For Academic Structure management
export type AcademicStructureType = 'academicStructure';
export type TeacherLoadReportType = 'teacherLoadReport';


export type ImportableEntityType = 'teachers' | 'subjects' | 'gradeLevels' | 'classrooms' | 'physicalRooms' | 'teacherSubjectAssignments';


export type Entity = Teacher | Subject | GradeLevel | PhysicalRoom | TeacherSubjectAssignment | User; // Added User

export interface FormField {
  name: keyof Teacher | keyof Subject | keyof GradeLevel | keyof PhysicalRoom | keyof TeacherSubjectAssignment | keyof PeriodSetting | keyof OrganizationSettings | keyof User | string;
  label: string;
  type: 'text' | 'color' | 'select' | 'number' | 'multiselect' | 'time' | 'textarea' | 'file' | 'email' | 'checkbox' | 'checkboxgroup'; // Added 'checkboxgroup'
  options?: { value: string; label: string }[]; 
  required?: boolean;
  placeholder?: string;
  optionsSource?: 'teachers' | 'subjects' | 'gradeLevels' | 'classrooms' | 'physicalRooms' | 'departments' | 'resourceTypes'; // For populating select from AppData
  accept?: string; // For file input
  disabled?: (currentItem: Partial<Entity> | null, appData?: AppData) => boolean; // Added for conditional disabling
}

export type ScheduleViewType = 'gradeLevelPlanner' | 'teacherSchedules' | 'roomUsage';


// Structure for data copied to clipboard for pasting.
// Does not include id, day, period, or block linking info, as these are context-specific on paste.
export type CopiedScheduleEntryData = Omit<ScheduleEntry, 'id' | 'day' | 'period' | 'blockId' | 'blockIndex' | 'totalInBlock'>;


// currentAssignment in ScheduleScreen will use this structure
export interface CurrentAssignmentState {
  gradeLevelId?: string;
  subjectId?: string;
  teacherIds?: string[]; 
  physicalRoomId?: string;
  day?: DayOfWeek; 
  period?: number;  
  assignmentDuration?: number; // Added for creating blocks via modal
  cohort?: string; // Optional student cohort for split classes
}

export interface AssignmentModalContext {
  viewType: ScheduleViewType;
  day: DayOfWeek;
  period: number;
  // ID of the entity that is fixed in this view, if any
  fixedGradeLevelId?: string; 
  fixedTeacherId?: string; 
  fixedPhysicalRoomId?: string;
  editingFromChildPerspectiveOfParentEntry?: boolean; // Added flag
}

// Context Menu Types
export interface ContextMenuItemAction {
  label: string;
  icon?: React.ElementType;
  action: () => void;
  disabled?: boolean;
  isSeparator?: boolean;
}

export interface ContextMenuTargetInfo {
  day: DayOfWeek;
  period: number;
  entryId?: string; // ID of the schedule entry in the slot, if any
  currentGradeLevelId?: string; // For GradeLevelPlannerView context
  currentTeacherId?: string;    // For TeacherScheduleView context
  currentPhysicalRoomId?: string;  // For RoomUsageView context
  viewType: ScheduleViewType;   // The view from which the context menu was opened
}

export interface ContextMenuState {
  x: number;
  y: number;
  isOpen: boolean;
  items: ContextMenuItemAction[];
  targetInfo: ContextMenuTargetInfo; // Made non-optional when isOpen is true
}

// Props for screens that need access control based on user role/permissions
export interface ScreenAccessProps {
    permissions: {
        canPerformAdminActions: boolean; // For user management
        canPerformManagerActions: boolean; // For general admin tasks like user management, org settings, period settings, entity management (delete)
        canModifyScheduleEntries: boolean; // For adding, editing, deleting schedule entries in SchedulePlanner
        canModifyTeacherSubjectLinks: boolean; // For adding, editing, deleting teacher-subject links
    };
}

// Props for SlotAvailabilityInspectorModal
export interface SlotAvailabilityInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  appData: AppData;
  day: DayOfWeek;
  period: number;
  periodSettings: PeriodSetting[]; // To display period label and time
  currentGradeLevelId?: string; // Optional, to show context if available
}

// For Print Options Modal
export type PrintItemScope = 'current' | 'all' | 'selected';
export type PrintLayoutOption = '1_per_page' | '1x2_per_page' | '2x2_per_page' | '2x3_per_page' | '2x4_per_page';
export type PrintOrientation = 'portrait' | 'landscape';
export type PrintOutputFormat = 'print' | 'pdf';

export interface PrintOptions {
  itemType: 'teacher' | 'gradeLevel' | 'classroom' | 'physicalRoom';
  scope: PrintItemScope;
  selectedItemIds: string[]; // IDs of teachers, grade levels, or classrooms to print
  layout: PrintLayoutOption;
  orientation: PrintOrientation;
  outputFormat?: PrintOutputFormat;
}

// Props for PrintWithOptionsModal
export interface PrintWithOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmPrint: (options: PrintOptions) => void;
  itemType: 'teacher' | 'gradeLevel' | 'classroom' | 'physicalRoom';
  currentItemId: string | null; // ID of the currently viewed item (teacher, grade, room)
  allItems: Identifiable[]; // All available items (teachers, grades, rooms) for multi-select
  appData: AppData; // To resolve names for selection list
}

// Props for individual schedule table rendering components (for batch printing)
export interface SingleScheduleTableProps {
  appData: AppData;
  periodSettings: PeriodSetting[];
  itemId: string; // teacherId, gradeLevelId, or physicalRoomId
  getEntryDisplay: (entry: ScheduleEntry) => { subject?: Subject, teachers: Teacher[], physicalRoom?: PhysicalRoom, gradeLevel?: GradeLevel };
  tableView: 'daysAsCols' | 'periodsAsCols'; // To maintain consistency with view's table
  isPrint?: boolean; // Added to distinguish printing view
  startTouchDrag?: (e: React.TouchEvent, entryId: string, entryData: ScheduleEntry) => void;
  handleTouchMove?: (e: React.TouchEvent) => void;
  finishTouchDrag?: (e: React.TouchEvent) => void;
}