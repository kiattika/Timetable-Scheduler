/** rebuildEntityMirror (restore + backfill) must make every mirror doc EQUAL its source entity. */
import { describe, it, expect } from 'vitest';
import { rebuildEntityMirror } from '../../functions/src/orgWrites';

const fakeColl = (initial: Record<string, any>) => {
  const docs: Record<string, any> = { ...initial };
  const ref: any = {
    collection: () => ({
      listDocuments: async () => Object.keys(docs).map((id) => ({ id, delete: async () => { delete docs[id]; } })),
      doc: (id: string) => ({
        set: async (data: any, opts?: { merge?: boolean }) => {
          docs[id] = opts?.merge ? { ...(docs[id] || {}), ...data } : { ...data };
        },
      }),
    }),
  };
  return { ref, docs };
};

describe('rebuildEntityMirror', () => {
  it('drops fields the source entity no longer has (restore of an older backup)', async () => {
    const f = fakeColl({
      e1: { id: 'e1', subjectId: 's1', combinedGradeLevelIds: ['g2'] },
      gone: { id: 'gone' },
    });
    await rebuildEntityMirror(f.ref, 'scheduleEntries', [{ id: 'e1', subjectId: 's1' }, { id: 'e2', subjectId: 's2' }]);
    expect(f.docs).toEqual({ e1: { id: 'e1', subjectId: 's1' }, e2: { id: 'e2', subjectId: 's2' } });
  });
});
