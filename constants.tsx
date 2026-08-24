
import React from 'react';
import { DayOfWeek } from './types';
// Fix: Add Eye and EyeOff to the import
import { Users, BookOpen, Home, Briefcase, CalendarDays, PlusCircle, Edit3, Trash2, X, ChevronDown, ChevronUp, GripVertical, FileText, Settings, Search, Repeat, Move, Link2, UserCog, Building, UploadCloud, Copy, ClipboardPaste, Landmark, UsersRound, AlertTriangle, LogOut, Sparkles, Layers, Printer, Download, DatabaseBackup, DatabaseZap, Eye, EyeOff, CheckCircle, Activity } from 'lucide-react';

export const DAYS_OF_WEEK_ORDERED: DayOfWeek[] = [
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
];

// Default period settings if none are loaded - up to Period 11 (12 periods total)
// P0: 08:00 - 08:50
// P1: 08:50 - 09:40
// ...
// P11: 17:10 - 18:00
export const DEFAULT_PERIOD_SETTINGS = Array.from({ length: 12 }, (_, i) => {
  const startHour = 8 + Math.floor((i * 50) / 60);
  const startMinute = (i * 50) % 60;
  const endHour = 8 + Math.floor(((i + 1) * 50) / 60);
  const endMinute = ((i + 1) * 50) % 60;
  return {
    id: `p${i}`,
    label: `P${i}`, // Changed from `Period ${i}`
    startTime: `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`,
    endTime: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`,
  };
});


export const PREDEFINED_SUBJECT_COLORS: string[] = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FED766', '#2AB7CA',
  '#F0B67F', '#8A6FBF', '#F9ADA0', '#06D6A0', '#EF476F',
  '#118AB2', '#073B4C', '#FFD166', '#7F2CCB', '#F79256'
];

// Icons
export const Icons = {
  Activity: Activity,
  DatabaseZap: DatabaseZap,
  UsersRound: UsersRound,
  AlertTriangle: AlertTriangle,
  Teacher: Users, // Note: `Users` is also used for general user management icon in some contexts
  Subject: BookOpen,
  GradeLevel: Home, 
  Classroom: Briefcase, 
  PhysicalRoom: Building,
  Schedule: CalendarDays,
  Add: PlusCircle,
  Edit: Edit3,
  Delete: Trash2,
  Close: X,
  DropdownOpen: ChevronDown,
  DropdownClose: ChevronUp,
  DragHandle: GripVertical, // Could be used for drag handle explicitly
  Move: Move, // General move icon
  FileText: FileText,
  DataManagement: FileText,
  Settings: Settings,
  Search: Search,
  SwitchView: Repeat,
  Link: Link2, // Added for Teacher-Subject Links
  TeacherSchedules: UserCog, // For Teacher Schedules Tab
  RoomUsage: Building, // For Room Usage Tab
  Import: UploadCloud, // Added for Import Data
  Copy: Copy, // Added for context menu
  Paste: ClipboardPaste, // Added for context menu
  Landmark: Landmark, // Added for Organization Settings
  Users: UsersRound, // Added for User Management
  Warning: AlertTriangle, // Added for confirmation modals
  Logout: LogOut, // Added for Logout button
  Sparkles: Sparkles, // Added for AI features
  Layers: Layers, // Added for Academic Structure
  Printer: Printer, // Added for Print functionality
  Backup: DatabaseBackup, // Added for Backup Data
  Restore: DatabaseZap,   // Added for Restore Data
  Download: Download, // Added for Download functionality
  // Fix: Add Eye and EyeOff icons
  Eye: Eye,
  EyeOff: EyeOff,
  CheckCircle: CheckCircle,
  UploadCloud: UploadCloud,
  // GoogleSheet icon removed as functionality is removed
};

export const APP_TITLE = "โปรแกรมจัดตารางสอน"; // Timetable Scheduler Program
