/**
 * Pure unit tests for the client-side change-set computation
 * (lib/orgChangesClient.ts). Verifies the client sends only its OWN diff and
 * never emits deletes without a baseline.
 */
import { describe, it, expect } from 'vitest';
import { diffById, computeOrgChanges, canonicalKey, sameEntity } from '../../lib/orgChangesClient';

describe('canonicalKey / sameEntity — the spurious-update regression', () => {
  it('two objects with identical fields in DIFFERENT key order are equal', () => {
    const a = { name: 'Dr Smith', teacherCode: 'T1', department: 'Sci', email: 'x@utd.ac.th' };
    const b = { email: 'x@utd.ac.th', department: 'Sci', name: 'Dr Smith', teacherCode: 'T1' };
    expect(canonicalKey(a)).toBe(canonicalKey(b));
    expect(sameEntity(a, b)).toBe(true);
  });

  it('nested objects with reordered keys are equal', () => {
    const a = { id: 's1', meta: { a: 1, b: 2 }, tags: ['x', 'y'] };
    const b = { tags: ['x', 'y'], id: 's1', meta: { b: 2, a: 1 } };
    expect(sameEntity(a, b)).toBe(true);
  });

  it('ARRAY order is still significant (teacherIds / operatingDays)', () => {
    expect(sameEntity({ teacherIds: ['a', 'b'] }, { teacherIds: ['b', 'a'] })).toBe(false);
  });

  it('a real field change is still detected', () => {
    expect(sameEntity({ a: 1, b: 2 }, { b: 2, a: 999 })).toBe(false);
  });

  it('a missing key vs an extra key is a real difference (normalisation must be unified)', () => {
    expect(sameEntity({ a: 1 }, { a: 1, b: false })).toBe(false);
  });

  it('undefined-valued keys are ignored (JSON semantics)', () => {
    expect(sameEntity({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});

describe('diffById', () => {
  it('detects adds, updates and deletes by id', () => {
    const baseline = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }];
    const current = [{ id: 'a', n: 1 }, { id: 'b', n: 99 }, { id: 'd', n: 4 }];
    const { upsert, deleteIds } = diffById(baseline, current);
    expect(upsert.map((x) => x.id).sort()).toEqual(['b', 'd']); // b changed, d new
    expect(deleteIds).toEqual(['c']);
  });

  it('ignores entries without a string id', () => {
    const { upsert } = diffById([], [{ id: 'ok' }, { n: 1 } as any, null as any]);
    expect(upsert).toEqual([{ id: 'ok' }]);
  });
});

describe('computeOrgChanges', () => {
  it('an untouched entity with reordered keys is NOT flagged as changed (the bug)', () => {
    const baseline = {
      teachers: [
        { name: 'A', teacherCode: 'T1', department: 'Sci' },
        { name: 'B', teacherCode: 'T2', department: 'Math' },
      ],
      subjects: [{ id: 's1', name: 'Math', subjectCode: 'M1' }],
    };
    // same data, every object's keys reordered (simulates a fresh Firestore deserialisation)
    const current = {
      teachers: [
        { department: 'Sci', name: 'A', teacherCode: 'T1' },
        { teacherCode: 'T2', department: 'Math', name: 'B' },
      ],
      subjects: [{ subjectCode: 'M1', id: 's1', name: 'Math' }],
    };
    const { changes, hasChanges } = computeOrgChanges(baseline, current);
    expect(hasChanges).toBe(false);
    expect(changes).toEqual({});
  });

  it('emits only the fields this client changed', () => {
    const baseline = {
      teachers: [{ id: 't1', name: 'A' }],
      subjects: [{ id: 's1', name: 'Math' }],
      organizationSettings: { name: 'School', semester: '1' },
      activityLogs: [{ id: 'l1' }],
    };
    const current = {
      teachers: [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }], // added t2
      subjects: [{ id: 's1', name: 'Math' }], // unchanged
      organizationSettings: { name: 'School', semester: '1' }, // unchanged
      activityLogs: [{ id: 'l1' }, { id: 'l2' }], // new log
    };
    const { changes, newActivityLogs, hasChanges } = computeOrgChanges(baseline, current);

    expect(hasChanges).toBe(true);
    expect(Object.keys(changes)).toEqual(['teachers']);
    expect(changes.teachers).toEqual({ upsert: [{ id: 't2', name: 'B' }], deleteIds: [] });
    expect(newActivityLogs.map((l: any) => l.id)).toEqual(['l2']);
  });

  it('NEVER emits deletes when baseline is null (unknown)', () => {
    const current = { subjects: [{ id: 's1' }, { id: 's2' }] };
    const { changes } = computeOrgChanges(null, current);
    expect(changes.subjects.deleteIds).toEqual([]);
    expect(changes.subjects.upsert.map((s: any) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('emits a delete when baseline proves the client removed an item', () => {
    const baseline = { subjects: [{ id: 's1' }, { id: 's2' }] };
    const current = { subjects: [{ id: 's1' }] };
    const { changes } = computeOrgChanges(baseline, current);
    expect(changes.subjects).toEqual({ upsert: [], deleteIds: ['s2'] });
  });

  it('organizationSettings: only changed keys are sent', () => {
    const baseline = { organizationSettings: { name: 'S', semester: '1', year: '2568' } };
    const current = { organizationSettings: { name: 'S', semester: '2', year: '2568' } };
    const { changes } = computeOrgChanges(baseline, current);
    expect(changes.organizationSettings).toEqual({ set: { semester: '2' } });
  });

  it('no changes -> hasChanges false', () => {
    const doc = { teachers: [{ id: 't1' }], subjects: [], organizationSettings: { a: 1 } };
    const { hasChanges } = computeOrgChanges(doc, JSON.parse(JSON.stringify(doc)));
    expect(hasChanges).toBe(false);
  });
});
