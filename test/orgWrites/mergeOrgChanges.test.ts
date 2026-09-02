/**
 * Pure unit tests for the server-side merge engine (functions/src/orgWrites.ts).
 * These cover the data-loss regression and the subjectCode-uniqueness rules
 * without needing an emulator.
 */
import { describe, it, expect } from 'vitest';
import {
  mergeOrgChanges,
  sanitizeOrgChanges,
  OrgChangeError,
  type OrgChanges,
} from '../../functions/src/orgWrites';

const S = (id: string, code?: string, name = id) => ({ id, subjectCode: code, name });

describe('mergeOrgChanges — concurrent edits do not clobber', () => {
  it('a stale client that adds Y does NOT erase X added concurrently by another client', () => {
    // Server already has X (added by client A). Client B only knows it added Y.
    const server = { subjects: [S('x', 'X-CODE')] };
    const changes: OrgChanges = { subjects: { upsert: [S('y', 'Y-CODE')], deleteIds: [] } };

    const { updates } = mergeOrgChanges(server, changes, 'manager');

    expect(updates.subjects.map((s: any) => s.id).sort()).toEqual(['x', 'y']);
  });

  it('reverse order: client A adds X onto a server that already has B\'s Y', () => {
    const server = { teachers: [{ id: 'y', name: 'Y', department: 'Sci' }] };
    const changes: OrgChanges = { teachers: { upsert: [{ id: 'x', name: 'X', department: 'Math' }], deleteIds: [] } };
    const { updates } = mergeOrgChanges(server, changes, 'admin');
    expect(updates.teachers.map((t: any) => t.id).sort()).toEqual(['x', 'y']);
  });

  it('two admins editing different fields of the same subject both survive (field-level merge)', () => {
    const server = { subjects: [S('s1', 'C1', 'Original')] };
    // this client only changed the name
    const changes: OrgChanges = { subjects: { upsert: [{ id: 's1', name: 'Renamed' }], deleteIds: [] } };
    const { updates } = mergeOrgChanges(server, changes, 'manager');
    // subjectCode kept from server, name updated
    expect(updates.subjects[0]).toMatchObject({ id: 's1', subjectCode: 'C1', name: 'Renamed' });
  });

  it('an explicit delete removes only that id, keeping concurrently-added items', () => {
    const server = { gradeLevels: [{ id: 'a' }, { id: 'b' }, { id: 'c-new' }] };
    const changes: OrgChanges = { gradeLevels: { upsert: [], deleteIds: ['b'] } };
    const { updates } = mergeOrgChanges(server, changes, 'admin');
    expect(updates.gradeLevels.map((g: any) => g.id).sort()).toEqual(['a', 'c-new']);
  });

  it('empty changeset produces no updates', () => {
    const { updates } = mergeOrgChanges({ subjects: [S('s1')] }, {}, 'admin');
    expect(Object.keys(updates)).toHaveLength(0);
  });
});

describe('mergeOrgChanges — subjectCode uniqueness', () => {
  it('rejects a NEW subject whose code collides (case-insensitive, trimmed)', () => {
    const server = { subjects: [S('s1', 'MATH101')] };
    const changes: OrgChanges = { subjects: { upsert: [S('s2', '  math101 ')], deleteIds: [] } };
    expect(() => mergeOrgChanges(server, changes, 'manager')).toThrow(OrgChangeError);
    try {
      mergeOrgChanges(server, changes, 'manager');
    } catch (e: any) {
      expect(e.code).toBe('already-exists');
    }
  });

  it('allows updating a subject while keeping its own code', () => {
    const server = { subjects: [S('s1', 'MATH101', 'Maths')] };
    const changes: OrgChanges = { subjects: { upsert: [{ id: 's1', subjectCode: 'MATH101', name: 'Mathematics' }], deleteIds: [] } };
    expect(() => mergeOrgChanges(server, changes, 'manager')).not.toThrow();
  });

  it('a pre-existing duplicate among UNTOUCHED subjects does not block an unrelated save', () => {
    const server = { subjects: [S('s1', 'DUP'), S('s2', 'dup'), S('s3', 'OK')] };
    const changes: OrgChanges = { subjects: { upsert: [{ id: 's3', name: 'Renamed' }], deleteIds: [] } };
    expect(() => mergeOrgChanges(server, changes, 'admin')).not.toThrow();
  });

  it('rejects two concurrent NEW subjects racing for the same code (second one loses)', () => {
    // client A's add already merged onto the server
    const afterA = { subjects: [S('s1', 'CHEM')] };
    // client B (stale) tries to add a different subject with the same code
    const changesB: OrgChanges = { subjects: { upsert: [S('s2', 'chem')], deleteIds: [] } };
    expect(() => mergeOrgChanges(afterA, changesB, 'manager')).toThrow(/already-exists|ถูกใช้/);
  });

  it('subjects with no code are never flagged', () => {
    const server = { subjects: [S('s1', ''), S('s2', undefined)] };
    const changes: OrgChanges = { subjects: { upsert: [S('s3', '')], deleteIds: [] } };
    expect(() => mergeOrgChanges(server, changes, 'admin')).not.toThrow();
  });
});

describe('mergeOrgChanges — guards', () => {
  it('a non-admin manager cannot toggle isLocked', () => {
    const server = { organizationSettings: { isLocked: false, name: 'S' } };
    const changes: OrgChanges = { organizationSettings: { set: { isLocked: true } } };
    expect(() => mergeOrgChanges(server, changes, 'manager')).toThrow(/admin/i);
    expect(() => mergeOrgChanges(server, changes, 'admin')).not.toThrow();
  });

  it('organizationSettings is shallow-merged key by key', () => {
    const server = { organizationSettings: { name: 'School', semester: '1', academicYear: '2568' } };
    const changes: OrgChanges = { organizationSettings: { set: { semester: '2' } } };
    const { updates } = mergeOrgChanges(server, changes, 'manager');
    expect(updates.organizationSettings).toEqual({ name: 'School', semester: '2', academicYear: '2568' });
  });

  it('blocks deleting a teacherSubjectAssignment that is still on the timetable', () => {
    const server = {
      teacherSubjectAssignments: [{ id: 'a1', teacherId: 't1', subjectId: 's1', gradeLevelId: 'g1' }],
      scheduleEntries: [{ id: 'e1', teacherIds: ['t1'], subjectId: 's1', gradeLevelId: 'g1' }],
    };
    const changes: OrgChanges = { teacherSubjectAssignments: { upsert: [], deleteIds: ['a1'] } };
    try {
      mergeOrgChanges(server, changes, 'admin');
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(OrgChangeError);
      expect(e.code).toBe('409_CONFLICT_ASSIGNMENT_IN_USE');
    }
  });

  it('allows deleting a teacherSubjectAssignment that is NOT on the timetable', () => {
    const server = {
      teacherSubjectAssignments: [{ id: 'a1', teacherId: 't1', subjectId: 's1', gradeLevelId: 'g1' }],
      scheduleEntries: [{ id: 'e1', teacherIds: ['t9'], subjectId: 's9', gradeLevelId: 'g9' }],
    };
    const changes: OrgChanges = { teacherSubjectAssignments: { upsert: [], deleteIds: ['a1'] } };
    const { updates } = mergeOrgChanges(server, changes, 'admin');
    expect(updates.teacherSubjectAssignments).toEqual([]);
  });
});

describe('sanitizeOrgChanges — never accept protected/unknown fields', () => {
  it('drops users / authorizedAdmins even if the client sends them', () => {
    const raw = {
      teachers: { upsert: [{ id: 't1', name: 'T' }], deleteIds: [] },
      users: { upsert: [{ id: 'u1', role: 'admin' }], deleteIds: ['victim'] },
      authorizedAdmins: { upsert: [], deleteIds: ['x'] },
      randomGarbage: { upsert: [{ id: 'z' }] },
    };
    const clean = sanitizeOrgChanges(raw);
    expect(clean.teachers).toBeDefined();
    expect((clean as any).users).toBeUndefined();
    expect((clean as any).authorizedAdmins).toBeUndefined();
    expect((clean as any).randomGarbage).toBeUndefined();
  });

  it('drops upsert entries without a string id and non-string deleteIds', () => {
    const clean = sanitizeOrgChanges({
      subjects: { upsert: [{ id: 's1' }, { name: 'no id' }, null, 5], deleteIds: ['ok', 123, null] },
    });
    expect(clean.subjects?.upsert).toEqual([{ id: 's1' }]);
    expect(clean.subjects?.deleteIds).toEqual(['ok']);
  });
});
