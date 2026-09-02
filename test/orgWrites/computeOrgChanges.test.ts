/**
 * Pure unit tests for the client-side change-set computation
 * (lib/orgChangesClient.ts). Verifies the client sends only its OWN diff and
 * never emits deletes without a baseline.
 */
import { describe, it, expect } from 'vitest';
import { diffById, computeOrgChanges } from '../../lib/orgChangesClient';

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
