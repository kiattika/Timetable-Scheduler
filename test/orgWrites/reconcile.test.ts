/**
 * Issue A — a Firestore snapshot arriving during the autosave debounce used to
 * replace appData wholesale, silently dropping an entity the user had just added
 * locally. reconcileServerWithLocal preserves this client's not-yet-persisted work.
 */
import { describe, it, expect } from 'vitest';
import { reconcileServerWithLocal, diffAssistantEntities, failureKey, classifySaveError } from '../../lib/orgChangesClient';

const doc = (over: Record<string, any> = {}) => ({
  teachers: [], subjects: [], gradeLevels: [], physicalRooms: [], departments: [],
  resourceTypes: [], teacherSubjectAssignments: [], periodSettings: [], scheduleEntries: [],
  organizationSettings: {}, ...over,
});

describe('reconcileServerWithLocal — Issue A (local unsaved work survives a snapshot)', () => {
  it('keeps a subject added locally that has not been persisted yet', () => {
    const baseline = doc({ subjects: [{ id: 's1', name: 'Math' }] });
    const local = doc({ subjects: [{ id: 's1', name: 'Math' }, { id: 's-new', name: 'ภาษาญี่ปุ่น 1' }] });
    // server snapshot (another user's edit landed) — does NOT have s-new yet
    const server = doc({ subjects: [{ id: 's1', name: 'Math' }, { id: 's2', name: 'Physics (by other user)' }] });

    const merged = reconcileServerWithLocal(server, local, baseline);
    const ids = merged.subjects.map((s: any) => s.id).sort();
    expect(ids).toEqual(['s-new', 's1', 's2']); // local add kept, other user's add kept
  });

  it('the reverse-order race: two clients each add one subject, snapshot lands mid-debounce', () => {
    const baseline = doc({ subjects: [] });
    const local = doc({ subjects: [{ id: 'a', name: 'A' }] });      // this client added A
    const server = doc({ subjects: [{ id: 'b', name: 'B' }] });     // other client's B already persisted
    const merged = reconcileServerWithLocal(server, local, baseline);
    expect(merged.subjects.map((s: any) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps a local in-progress EDIT when the server has not changed that entity', () => {
    const baseline = doc({ teachers: [{ id: 't1', name: 'Old' }] });
    const local = doc({ teachers: [{ id: 't1', name: 'New (typing)' }] });
    const server = doc({ teachers: [{ id: 't1', name: 'Old' }], subjects: [{ id: 's9', name: 'unrelated server add' }] });
    const merged = reconcileServerWithLocal(server, local, baseline);
    expect(merged.teachers[0].name).toBe('New (typing)');
    expect(merged.subjects.map((s: any) => s.id)).toEqual(['s9']);
  });

  it('honours a local delete that has not synced yet', () => {
    const baseline = doc({ subjects: [{ id: 's1' }, { id: 's2' }] });
    const local = doc({ subjects: [{ id: 's1' }] }); // user deleted s2 locally
    const server = doc({ subjects: [{ id: 's1' }, { id: 's2' }] });
    const merged = reconcileServerWithLocal(server, local, baseline);
    expect(merged.subjects.map((s: any) => s.id)).toEqual(['s1']);
  });

  it('accepts another user\'s delete (id gone from server, not a local edit)', () => {
    const baseline = doc({ subjects: [{ id: 's1' }, { id: 's2' }] });
    const local = doc({ subjects: [{ id: 's1' }, { id: 's2' }] });
    const server = doc({ subjects: [{ id: 's1' }] }); // other user deleted s2
    const merged = reconcileServerWithLocal(server, local, baseline);
    expect(merged.subjects.map((s: any) => s.id)).toEqual(['s1']);
  });

  it('no baseline -> returns the server view untouched (nothing to protect)', () => {
    const server = doc({ subjects: [{ id: 's1' }] });
    expect(reconcileServerWithLocal(server, doc({ subjects: [{ id: 'x' }] }), null)).toBe(server);
  });

  it('organizationSettings: local un-synced key change survives a server snapshot', () => {
    const baseline = doc({ organizationSettings: { name: 'School', semester: '1' } });
    const local = doc({ organizationSettings: { name: 'School', semester: '2' } });   // admin editing
    const server = doc({ organizationSettings: { name: 'School Renamed', semester: '1' } }); // other change
    const merged = reconcileServerWithLocal(server, local, baseline);
    expect(merged.organizationSettings).toEqual({ name: 'School Renamed', semester: '2' });
  });
});

describe('diffAssistantEntities — Issue B (permanent failure not retried forever)', () => {
  it('suppresses an op whose entity still hashes to a known-failed value', () => {
    const before = [{ id: 't1', name: 'A' }];
    const after = [{ id: 't1', name: 'A' }, { id: 'bad', name: 'X', department: 'ไม่ใช่ของฉัน' }];

    const known = new Map<string, string>();
    const first = diffAssistantEntities(before, after, known, 'teachers');
    expect(first.ops.map(o => o.id)).toEqual(['bad']);

    // caller records the permanent failure
    known.set('teachers:bad', failureKey('create', after[1]));

    const second = diffAssistantEntities(before, after, known, 'teachers');
    expect(second.ops).toEqual([]);
    expect(second.suppressed).toBe(1);
  });

  it('stops suppressing once the entity content changes (user edited it)', () => {
    const known = new Map<string, string>();
    const failed = { id: 'bad', name: 'X', department: 'wrong' };
    known.set('teachers:bad', failureKey('create', failed));

    const edited = { id: 'bad', name: 'X', department: 'CORRECT-NOW' };
    const { ops, suppressed } = diffAssistantEntities([], [edited], known, 'teachers');
    expect(ops.map(o => o.id)).toEqual(['bad']);
    expect(suppressed).toBe(0);
  });
});

describe('classifySaveError — Issue B', () => {
  it('permission / uniqueness / conflict are PERMANENT', () => {
    expect(classifySaveError({ code: 'functions/permission-denied' })).toBe('permanent');
    expect(classifySaveError({ code: 'functions/already-exists' })).toBe('permanent');
    expect(classifySaveError({ message: 'รหัสวิชา "M1" ถูกใช้แล้ว' })).toBe('permanent');
    expect(classifySaveError({ message: '409_CONFLICT_ASSIGNMENT_IN_USE' })).toBe('permanent');
    expect(classifySaveError({ message: 'Entity belongs to a department outside your assignment (X)' })).toBe('permanent');
  });
  it('aborted / quota / network are RETRYABLE', () => {
    expect(classifySaveError({ code: 'functions/aborted' })).toBe('retryable');
    expect(classifySaveError({ code: 'functions/resource-exhausted' })).toBe('retryable');
    expect(classifySaveError({ code: 'functions/deadline-exceeded' })).toBe('retryable');
    expect(classifySaveError({ message: 'network request failed' })).toBe('retryable');
  });
});
