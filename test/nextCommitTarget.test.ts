import { describe, it, expect } from 'vitest';
import { computeOrgChanges, nextCommitTarget } from '../lib/orgChangesClient';

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `S${i}` }));

describe('nextCommitTarget', () => {
  it('sends small changesets in one step', () => {
    const cur: any = { subjects: [] };
    const next: any = { subjects: mk(5) };
    const { changes } = computeOrgChanges(cur, next);
    const r = nextCommitTarget(cur, next, changes, 100);
    expect(r.isFinal).toBe(true);
    expect(r.target).toBe(next);
  });

  it('splits a big import into chunks that converge on the target', () => {
    let cur: any = { subjects: [] };
    const next: any = { subjects: mk(250) };
    let steps = 0;
    for (;;) {
      const { changes, hasChanges } = computeOrgChanges(cur, next);
      if (!hasChanges) break;
      const r = nextCommitTarget(cur, next, changes, 100);
      steps++;
      expect(r.target.subjects.length - cur.subjects.length).toBeLessThanOrEqual(100);
      cur = r.target;
      if (r.isFinal) break;
    }
    expect(steps).toBe(3);
    expect(cur.subjects.length).toBe(250);
  });
});
