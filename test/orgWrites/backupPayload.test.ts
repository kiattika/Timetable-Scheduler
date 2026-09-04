/**
 * Phase 0 — the "Backup Data (JSON)" payload is the safety net for the upcoming
 * subcollection migration, so it MUST losslessly capture every `apps/{orgId}`
 * field the migration will move. This pins that, and guards against future drift
 * between `AppData` (types.ts) and the payload builder (utils/backup.ts).
 */
import { describe, it, expect } from 'vitest';
import { buildTimetableBackupPayload } from '../../utils/backup';
import type { AppData } from '../../types';

// Every field the migration touches, each with a distinctive value we can assert
// round-trips into the backup unchanged.
const fullAppData: AppData = {
  teachers: [{ id: 't1', name: 'T One', teacherCode: 'T1', department: 'Science', email: 't1@utd.ac.th', homeroomGradeLevelIds: ['g1'] }],
  subjects: [{
    id: 's1', name: 'Physics', color: '#123456', subjectCode: 'PHY1', department: 'Science',
    periodsPerWeek: 3, teachingMode: 'single', schedulingPattern: '2/1', type: 'STANDARD',
    restrictedRoomTypes: ['lab'], applicableParentGradeLevelIds: ['g1'],
  }],
  gradeLevels: [{ id: 'g1', name: 'M.1', homeroomPhysicalRoomId: 'r1', description: 'first year' }],
  physicalRooms: [{ id: 'r1', code: '101', name: 'Room 101', type: 'ห้องเรียนทั่วไป', capacity: 40 }],
  departments: [{ id: 'd1', name: 'Science' }],
  resourceTypes: [{ id: 'rt1', name: 'ห้องปฏิบัติการ' }],
  scheduleEntries: [{ id: 'e1', gradeLevelId: 'g1', day: 'Monday' as any, period: 0, subjectId: 's1', teacherIds: ['t1'], physicalRoomId: 'r1', blockId: 'b1', blockIndex: 0, totalInBlock: 2 }],
  periodSettings: [{ id: 'p1', label: 'P1', startTime: '08:30', endTime: '09:20' }],
  teacherSubjectAssignments: [{ id: 'a1', teacherId: 't1', subjectId: 's1', gradeLevelId: 'g1', periodsPerWeek: 3, department: 'Science' }],
  organizationSettings: { name: 'UTD School', semester: '1', academicYear: '2569', isLocked: true, schemaVersion: 1 },
  users: [
    { id: 'u1', name: 'Admin', email: 'admin@utd.ac.th', role: 'admin', organizationId: 'utd', assignedDepartments: [] },
    { id: 'u2', name: 'Asst', email: 'asst@utd.ac.th', role: 'assistant', assignedDepartments: ['Science'] }, // no organizationId
  ],
  authorizedAdmins: ['admin@utd.ac.th'],
  activityLogs: [
    { id: 'log-fresh', timestamp: new Date().toISOString(), action: 'Added', description: 'recent' },
    { id: 'log-old', timestamp: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(), action: 'Updated', description: 'over a year old' },
  ],
  currentUser: { id: 'u1', name: 'Admin', email: 'admin@utd.ac.th', role: 'admin' },
};

// Passed through as-is by the payload builder.
const PASSTHROUGH_ENTITIES = [
  'teachers', 'gradeLevels', 'physicalRooms',
  'teacherSubjectAssignments', 'periodSettings', 'scheduleEntries',
] as const;

describe('buildTimetableBackupPayload — migration safety-net coverage', () => {
  const { backupData } = buildTimetableBackupPayload(fullAppData);

  it('captures every pass-through migration-touched entity array, element-for-element', () => {
    for (const key of PASSTHROUGH_ENTITIES) {
      expect(backupData.data[key], `${key} missing / altered in backup`).toEqual((fullAppData as any)[key]);
    }
  });

  it('captures subjects with every original field preserved (load-time defaults may be added)', () => {
    const orig = fullAppData.subjects[0];
    const backed = backupData.data.subjects[0];
    expect(backed).toMatchObject(orig);
    for (const k of Object.keys(orig)) {
      expect(backed, `subject field "${k}" dropped`).toHaveProperty(k, (orig as any)[k]);
    }
  });

  it('captures organizationSettings (incl. schemaVersion) both top-level and in data', () => {
    expect(backupData.organizationSettings).toEqual(fullAppData.organizationSettings);
    expect(backupData.data.organizationSettings).toEqual(fullAppData.organizationSettings);
    expect((backupData.organizationSettings as any).schemaVersion).toBe(1);
  });

  it('captures users (the persisted fields) and authorizedAdmins', () => {
    expect(backupData.data.authorizedAdmins).toEqual(['admin@utd.ac.th']);
    const u1 = backupData.data.users.find((u) => u.id === 'u1')!;
    expect(u1).toMatchObject({ id: 'u1', name: 'Admin', email: 'admin@utd.ac.th', role: 'admin', organizationId: 'utd', assignedDepartments: [] });
  });

  it('a user with no organizationId falls back to the org id, NOT the literal "default"', () => {
    const u2 = backupData.data.users.find((u) => u.id === 'u2')!;
    expect(u2.organizationId).toBe('utd');
    expect(u2.organizationId).not.toBe('default');
  });

  it('activity logs are NOT pruned to 7 days — the whole in-memory snapshot is kept', () => {
    const ids = backupData.data.activityLogs.map((l) => l.id).sort();
    expect(ids).toEqual(['log-fresh', 'log-old']);
  });

  it('summary counts match the data arrays', () => {
    expect(backupData.summary.teachersCount).toBe(1);
    expect(backupData.summary.subjectsCount).toBe(1);
    expect(backupData.summary.scheduleEntriesCount).toBe(1);
    expect(backupData.summary.teacherSubjectAssignmentsCount).toBe(1);
    expect(backupData.summary.usersCount).toBe(2);
  });

  it('does NOT leak the live session (currentUser) into the backup', () => {
    expect(JSON.stringify(backupData)).not.toContain('"currentUser"');
  });
});
