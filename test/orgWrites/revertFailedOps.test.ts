import { describe, it, expect } from 'vitest';
import { revertFailedOps, type FailedAssistantOp } from '../../lib/revertFailedOps';
import { diffAssistantEntities } from '../../lib/orgChangesClient';

type Slot = { id: string; day: string; period: number; teacherIds: string[] };
const slot = (id: string, day = 'Monday', period = 0, teacherIds: string[] = ['t1']): Slot => ({ id, day, period, teacherIds });
const K = 'scheduleEntries';

describe('revertFailedOps — rejected slots come off the grid without a refresh', () => {
  it('rejected create: the ghost card is removed, everything else stays', () => {
    const list = [slot('a'), slot('ghost', 'Tuesday')];
    const failed: FailedAssistantOp[] = [{ key: K, op: 'create', id: 'ghost' }];
    expect(revertFailedOps(list, failed, K).map((e) => e.id)).toEqual(['a']);
  });

  it('rejected update: the entry goes back to its persisted version', () => {
    const persisted = slot('a', 'Monday', 0, ['t-own']);
    const edited = slot('a', 'Monday', 0, ['t-own', 't-other']);
    const out = revertFailedOps([edited, slot('b')], [{ key: K, op: 'update', id: 'a', prior: persisted }], K);
    expect(out.find((e) => e.id === 'a')).toEqual(persisted);
    expect(out).toHaveLength(2);
  });

  it('rejected delete: the entry is restored', () => {
    const persisted = slot('a');
    expect(revertFailedOps([slot('b')], [{ key: K, op: 'delete', id: 'a', prior: persisted }], K).map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('update with no known persisted version: removes the unsaved entry', () => {
    expect(revertFailedOps([slot('a')], [{ key: K, op: 'update', id: 'a' }], K)).toEqual([]);
  });

  it('only touches the given key and the failed ids (edits made meanwhile survive)', () => {
    const list = [slot('a'), slot('new-edit-made-while-saving', 'Friday', 3), slot('ghost')];
    const failed: FailedAssistantOp[] = [
      { key: K, op: 'create', id: 'ghost' },
      { key: 'teachers', op: 'create', id: 'a' }, // other entity type: must be ignored here
    ];
    expect(revertFailedOps(list, failed, K).map((e) => e.id)).toEqual(['a', 'new-edit-made-while-saving']);
  });

  it('does not mutate the input list; no failures returns an equal copy', () => {
    const list = [slot('a')];
    const out = revertFailedOps(list, [], K);
    expect(out).toEqual(list);
    expect(out).not.toBe(list);
    expect(revertFailedOps(undefined, [], K)).toEqual([]);
  });
});

describe('full flow: assistant adds slots, server rejects them all -> local list equals the persisted baseline', () => {
  it('HR for 5 days rejected -> all 5 ghost cards disappear', () => {
    const persisted: Slot[] = [slot('keep-1', 'Monday', 1)];
    const local: Slot[] = [...persisted, ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d, i) => slot(`hr-${i}`, d, 0, ['t-math']))];

    const { ops } = diffAssistantEntities(persisted, local, undefined, K);
    expect(ops.map((o) => o.op)).toEqual(Array(5).fill('create'));

    // every op fails permanently -> App records them as failedOps exactly like persistAssistantChanges does
    const failedOps: FailedAssistantOp[] = ops.map((o) => ({ key: K, op: o.op as any, id: o.id, prior: persisted.find((e) => e.id === o.id) }));
    const reverted = revertFailedOps(local, failedOps, K);

    expect(reverted).toEqual(persisted);
    // and nothing is left to sync, so there is no retry loop
    expect(diffAssistantEntities(persisted, reverted, undefined, K).ops).toEqual([]);
  });
});
