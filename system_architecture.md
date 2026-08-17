# Technical Documentation: School Timetable Management Application Architecture

This document provides a comprehensive and structured technical reference of the current system architecture, database schema, role-based permission system, and routing/scheduling logic. It is formatted to be fully digestible by human collaborators and AI systems alike.

---

## 1. Database Schema (Firebase Firestore)

The application utilizes a multi-tenant layout. Every collection stores data partitioned by organizational boundaries. Multi-tenancy is structured around key identifiers:
- **`organizationId`** (multi-tenant tenant boundary)
- **`termId`/`semester`** (academic period boundary)
- **`department`** (group/department boundary within an organization)

### Collection: `users`
Represents the user accounts authorized to access the system with specified role-based permissions.
* **Firestore Path:** `users/{userId}` or `organizations/{orgId}/users/{userId}`

| Field Name | Firestore Data Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `string` | Unique identifier of the user (often matches Auth UID). |
| `name` | `string` | `string` | Display name of the user. |
| `email` | `string` | `string` | Registered email address of the user. |
| `role` | `string` | `'admin' \| 'manager' \| 'assistant' \| 'guest'` | Role of the user determining global access permissions. |
| `assignedDepartments` | `array` of `string` | `string[]` | Optional departments assigned to the user (used for Assistant role scoping). |

---

### Collection: `teachers`
Represents the school teaching staff.
* **Firestore Path:** `organizations/{orgId}/teachers/{teacherId}`

| Field Name | Firestore Data Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `string` | Unique identifier of the teacher. |
| `name` | `string` | `string` | Teacher's Full Name (ชื่อ-สกุล). |
| `teacherCode` | `string` (Optional) | `string` | Employee or Ministry-issued Teacher Code (รหัสครู). Used for default sorting. |
| `department` | `string` (Optional) | `string` | Academic department/learning category (กลุ่มสาระการเรียนรู้) the teacher belongs to. |
| `homeroomGradeLevelIds` | `array` of `string` | `string[]` | List of GradeLevel IDs where this teacher serves as a homeroom advisor. |
| `email` | `string` (Optional) | `string` | Contact email address for calendar invites and identification. |

---

### Collection: `subjects`
Represents the academic curriculum courses.
* **Firestore Path:** `organizations/{orgId}/subjects/{subjectId}`

| Field Name | Firestore Data Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `string` | Unique identifier of the subject. |
| `name` | `string` | `string` | Title/Name of the course (ชื่อวิชา). |
| `color` | `string` | `string` | Hexadecimal color code representing the subject visually in schedule grids. |
| `subjectCode` | `string` (Optional) | `string` | Official course registration identifier (รหัสวิชา). |
| `periodsPerWeek` | `number` (Optional) | `number` | Total number of required instruction hours/slots per week (คาบเรียนต่อสัปดาห์). |
| `teachingMode` | `string` | `'single' \| 'multiple'` | Instruction mode: Single teacher or multiple co-teachers (e.g., team-teaching). |
| `schedulingPattern` | `string` (Optional) | `string` | Blocking pattern (e.g., `"2/1/1"` indicating one 2-period block and two 1-period blocks). |
| `allowClassroomSharing` | `boolean` (Optional) | `boolean` | Allows multiple subjects to occupy the same classroom space concurrently. |
| `isBroadAssignment` | `boolean` (Optional) | `boolean` | Flag for multi-room/grade assemblies, scouting groups, or global student blocks. |
| `isHomeroomAdvisorySubject`| `boolean` (Optional) | `boolean` | Designates homeroom periods that require automatic mapping to classroom advisory teachers. |
| `autoLinkToHomeroomTeachers`| `boolean` (Optional) | `boolean` | Activates automatic team links to homeroom teachers for advisory subject hours. |
| `applicableParentGradeLevelIds`| `array` of `string` | `string[]` | Specific parent grades applicable to automatically resolved homeroom assignments. |

---

### Collection: `grade_levels`
Represents classes, cohorts, or specific classroom sections (e.g., Grade 10, Sec 1/1).
* **Firestore Path:** `organizations/{orgId}/grade_levels/{gradeLevelId}`

| Field Name | Firestore Data Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `string` | Unique identifier. Supports hierarchal names (e.g., `"M.1/1"` as a child of parent `"M.1"`). |
| `name` | `string` | `string` | Grade or level label displayed in options and schedule titles. |
| `homeroomClassroomId` | `string` (Optional) | `string` | Classroom ID mapped as the fixed homeroom folder/location for this cohort. |

---

### Collection: `classrooms`
Represents available physical locations or laboratories.
* **Firestore Path:** `organizations/{orgId}/classrooms/{classroomId}`

| Field Name | Firestore Data Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `string` | Unique identifier. |
| `name` | `string` | `string` | Descriptive title of the classroom/lab (e.g., "Science Lab A"). |
| `roomNumber` | `string` (Optional) | `string` | Numeric room label or room code (เลขห้อง). Used for default sorting. |

---

### Collection: `teacher_subject_links`
Establishes many-to-many relationships defining which teachers are authorized to teach which subjects to which grade levels.
* **Firestore Path:** `organizations/{orgId}/teacher_subject_links/{linkId}`

| Field Name | Firestore Data Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `string` | Unique identifier. |
| `teacherId` | `string` | `string` | Associated Teacher ID. |
| `subjectId` | `string` | `string` | Associated Subject ID. |
| `gradeLevelId` | `string` | `string` | Target Grade Level ID cohort. |

---

### Collection: `schedule_entries`
The core schedule records representing scheduled periods in the master calendar.
* **Firestore Path:** `organizations/{orgId}/terms/{termId}/schedule_entries/{entryId}`

| Field Name | Firestore Data Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `string` | Unique identifier. |
| `gradeLevelId` | `string` | `string` | Targeted Grade cohort ID. |
| `day` | `string` | `DayOfWeek` | Scheduled day: `"Monday" \| "Tuesday" \| "Wednesday" \| "Thursday" \| "Friday"`. |
| `period` | `number` | `number` | Zero-indexed integer indicating the assigned period slot in `periodSettings`. |
| `subjectId` | `string` | `string` | Scheduled Course/Subject ID. |
| `teacherIds` | `array` of `string` | `string[]` | Teaching staff IDs assigned to this slot (supports multi-member arrays). |
| `classroomId` | `string` | `string` | Scheduled Classroom ID. |
| `blockId` | `string` (Optional) | `string` | Shared grouping GUID for linking continuous hours (e.g., double period classes). |
| `blockIndex` | `number` (Optional) | `number` | Zero-indexed placement sequence of this hours segment inside the continuous block. |
| `totalInBlock` | `number` (Optional) | `number` | Total span count of cohesive slots in the containing block. |

---

### Collection: `period_settings`
Determines the configuration of instruction hours and intervals.
* **Firestore Path:** `organizations/{orgId}/period_settings/{settingId}`

| Field Name | Firestore Data Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `string` | Unique ID. |
| `label` | `string` | `string` | Header period code (e.g., `"P1"`, `"คาบที่ 1"`). |
| `startTime` | `string` | `string` | Clock start boundaries in standard 24h format (e.g., `"08:00"`). |
| `endTime` | `string` | `string` | Clock ending boundaries in standard 24h format (e.g., `"08:50"`). |

---

### Collection: `school_info`
Maintains settings representing the institution’s meta attributes and printing options.
* **Firestore Path:** `organizations/{orgId}/school_info` (Single document)

| Field Name | Firestore Data Type | TypeScript Type | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | `string` | Name of the School or Organization. |
| `logoUrl` | `string` (Optional) | `string` | Base64-encoded Data URL or Firebase Storage reference to the logo image. |
| `address` | `string` (Optional) | `string` | Institution mailing location. |
| `email` | `string` (Optional) | `string` | Official contact address. |
| `phone` | `string` (Optional) | `string` | Phone contacts. |
| `semester` | `string` (Optional) | `string` | Target study epoch (e.g., `"ภาคเรียนที่ 1"`). |
| `academicYear` | `string` (Optional) | `string` | Current school year (e.g., `"2569"`). |
| `directorName` | `string` (Optional) | `string` | Director's Name (for schedule print footnotes). |
| `directorPosition` | `string` (Optional) | `string` | Official title (e.g., `"ผู้อำนวยการวิทยาลัย..."`). |
| `deputyDirectorName`| `string` (Optional) | `string` | Assistant Director's Name. |
| `deputyDirectorPosition`| `string` (Optional)| `string` | Deputy position title. |
| `operatingDays` | `array` of `string` | `DayOfWeek[]` | Weekly teaching days (usually Mon-Fri). |

---

## 2. User Roles & Permissions Matrix

The school platform implements a robust 4-tier Role-Based Access Control (RBAC) model. Permissions are parsed client-side via the boolean settings defined in `ScreenAccessProps['permissions']`.

```
                    [ 1. Administrator (ผู้ดูแลระบบ) ]
                                    │
               [ 2. School Timetable Manager (ผู้จัดตารางสอน) ]
                                    │
               [ 3. Scheduler Assistant (ผู้ช่วยแผนกวิชา) ]
                                    │
                      [ 4. Guest (ผู้ใช้ทั่วไป) ]
```

### Roles Breakdown

#### A. Administrator (ผู้ดูแลระบบ)
* **Global Configuration Scope:** Complete system ownership.
* **Privileges:**
  * Read/Write access to all database collections.
  * Can modify `users` collection, assign system-wide roles, and configure department alignments.
  * Accesses institutional configs, global database logs, and system restores.
* **Visual Scope:** Unrestricted view of administrative configurations and utility menus.

#### B. School Timetable Manager (ผู้จัดตารางสอน ปวช./ปวส.)
* **Timetable Configuration Scope:** Oversees scheduling, structures, and institutional master layouts.
* **Privileges:**
  * Can modify `teachers`, `subjects`, `classrooms`, and `grade_levels` (academic entities).
  * Authorized to create, edit, move, delete, or clear all `schedule_entries` across all cohorts.
  * Full management of teacher syllabus links (`teacher_subject_links`).
  * Edit school details and director/deputy labels.
* **Design Restriction:** Cannot edit the `users` credentials database or modify other administrators.

#### C. Scheduler Assistant (ผู้ช่วยจัดตารางสอนแผนกวิชา)
* **Department Isolated Scope:** Scoped strictly to specialized subject fields or departments.
* **Privileges:**
  * Can add, modify, delete, and schedule entries **only** for subjects and teachers associated with their authorized departments listed in `assignedDepartments`.
  * Cannot execute global bulk updates, clear database terms, or alter institution settings.
  * Restricted from deleting root categories (such as master subject catalogs or classroom structures).
* **Security Validation Enforced:**
  ```typescript
  if (appData.currentUser?.role === 'assistant') {
      const assignedDepts = appData.currentUser?.assignedDepartments || [];
      eligibleTeachers = eligibleTeachers.filter(t => t.department && assignedDepts.includes(t.department));
  }
  ```

#### D. Guest (ผู้ใช้ทั่วไป/ครูผู้สอน)
* **Read-Only Scope:** Casual observers, standard teachers, and administrative readers.
* **Privileges:**
  * Read-only view of grade schedules, room usages, and teacher agendas.
  * Export options to personal Google Calendars or local static files for reading.
* **Visual boundaries:** Creation dialogs, interactive edit handles (brings up drag cursors), floating action menus, and edit paths are automatically deactivated and hidden in the viewport.

---

## 3. Master Scheduling and Allocation Logic

The allocation process enforces strict integrity checks of academic scheduling elements, running on every assignment request or Drag-and-Drop update.

### A. Conflict Checking Constraint Rules
Prior to persisting any `ScheduleEntry` update, the system checks validations on three distinct parameters. If an issue is flagged, assignment is blocked, and an alert is shown:

```
                  ┌──────────────────────────────┐
                  │ Assignment/Drag Request-Slot │
                  └──────────────┬───────────────┘
                                 │
         ┌───────────────────────┼──────────────────────┐
         ▼                       ▼                      ▼
┌─────────────────┐     ┌─────────────────┐    ┌─────────────────┐
│ Teacher Busy?   │     │ Classroom Free? │    │ Cohort Available│
└────────┬────────┘     └────────┬────────┘    └────────┬────────┘
         │                       │                      │
         └───────────────────────┼──────────────────────┘
                                 ▼
                    [ OK / PERSIST SCHEDULE ]
```

1. **Teacher Busy Check (ครูผู้สอนไม่ซ้ำซ้อน):**
   * Verifies that none of the teachers specified in `teacherIds` are booked in another cohort segment during the same Day and Period index.
2. **Classroom Busy Check (ห้องเรียนไม่ถูกจองซ้ำ):**
   * Asserts that the specified `classroomId` is vacant. This check is bypassed **only** if the course subject metadata features `allowClassroomSharing: true`.
3. **Cohort/Grade Busy Check (ระดับชั้นไม่เรียนซ้อน):**
   * Guarantees that the specific `gradeLevelId` (or its child/parent structural references) is not already processing another scheduling segment in the target slot.

---

### B. Block & Course Patterns Allocation
The application processes multi-hour unified assignments (e.g., 3-period continuous workshop courses) using a linear auto-booking algorithm based on `schedulingPattern`:

1. When assigning a slot with duration values $> 1$ (e.g. `assignmentDuration = 3` hours):
2. The grid checks feasibility for the next consecutive periods: `Period`, `Period + 1`, and `Period + 2` on the target day.
3. If all slots pass conflict validations, it generates contiguous `ScheduleEntry` documents containing a identical random UUID in `blockId`.
4. It sets consecutive sequencing tags in `blockIndex` (`0`, `1`, `2`) alongside total count constraints `totalInBlock` (`3`).
5. When the user drags or deletes any single segment of the cohesive block, the system automatically replicates the modification (moving or removing) across all entries matching the common `blockId` seamlessly.

---

### C. Advisory (Homeroom) & Co-Teaching Configurations
- **Advisory (Homeroom) Resolution:** For subjects flagged as `isHomeroomAdvisorySubject` (like weekly morning assembly and advisors' hours), if `autoLinkToHomeroomTeachers` is active, the assistant automatically routes assigned teachers based on the homeroom assignments stored in the `grade_levels` document.
- **Co-Teaching Modes:** Courses with `teachingMode: 'multiple'` authorize multiple teacher selection within the scheduling controls. Co-teacher arrays are checked collectively for scheduling overlaps.

---

## 4. UI Rendering & Formatting Guidelines

- **Day Formats (รูปแบบการแสดงชื่อวัน):**
  - **Screen Layout Grid:** Displays names abbreviated to **the first three letters** (e.g. `"Mon"`, `"Tue"`, `"Wed"`, `"Thu"`, `"Fri"`) to preserve valuable negative space and maintain structured horizontal sizing.
  - **Printed Paper Copies:** Resolves names to **full representations** (e.g. `"Monday"`, `"Tuesday"`, `"Wednesday"`, `"Thursday"`, `"Friday"`) automatically by checking `isPrint: true` on rendering.
- **Default Display Sorting:**
  * **Teachers List:** Sorted by `teacherCode` first (natural numeric comparison, e.g. Coach `T1` before `T2`), then by name.
  * **Classrooms List:** Sorted by physical `roomNumber` first, then by name.
  * **Grade Levels:** Sorted hierarchically (parent grades then cohort subgroups).
- **Batch Print Sizing Rules:**
  - Standard headers are hidden during prints (`@media print`).
  - Print views generate responsive components rendered as clean HTML via `ReactDOMServer.renderToStaticMarkup`. Double column layouts fit sheets nicely up to A4 boundaries.

---

This framework is optimized for modularity, database consistency, and reliable operations. Developers or collaborating AI agents can use these models to safely interface with the codebase.
