/**
 * Phase 3 step 2 — teacherSubjectAssignments are subcollection-only.
 * applyOrgChanges against a small in-memory Firestore fake (the emulator suite covers the real SDK).
 */
import { describe, it, expect } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { applyOrgChanges, applyOrgReplace } from '../../functions/src/orgWrites';

type Docs = Map<string, Record<string, any>>; // path -> data

const makeFakeDb = (seed: Record<string, Record<string, any>>) => {
  const docs: Docs = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  let clock = 1;
  const times = new Map<string, number>();
  const applyWrite = (path: string, data: Record<string, any>, merge: boolean) => {
    const base = merge ? { ...(docs.get(path) || {}) } : {};
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof FieldValue) delete base[k];
      else base[k] = JSON.parse(JSON.stringify(v));
    }
    docs.set(path, base);
    times.set(path, clock++);
  };
  const snapOf = (path: string) => {
    const id = path.split('/').pop()!;
    const data = docs.get(path);
    return {
      id,
      exists: data !== undefined,
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
      updateTime: { toMillis: () => times.get(path) ?? 0, t: times.get(path) ?? 0 },
    };
  };
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapOf(path),
    set: async (data: any, opts?: { merge?: boolean }) => applyWrite(path, data, !!opts?.merge),
    update: async (data: any, pre?: { lastUpdateTime: any }) => {
      if (!docs.has(path)) throw Object.assign(new Error('not found'), { code: 5 });
      if (pre && pre.lastUpdateTime.t !== (times.get(path) ?? 0)) throw Object.assign(new Error('precondition'), { code: 9 });
      applyWrite(path, data, true);
    },
    delete: async () => { docs.delete(path); },
    collection: (name: string) => collRef(`${path}/${name}`),
  });
  const childrenOf = (prefix: string) =>
    Array.from(docs.keys()).filter((k) => k.startsWith(prefix + '/') && !k.slice(prefix.length + 1).includes('/'));
  const query = (prefix: string, filter?: (d: any) => boolean): any => ({
    get: async () => {
      const ds = childrenOf(prefix).map(snapOf).filter((s) => !filter || filter(s.data()));
      return { docs: ds, size: ds.length, empty: ds.length === 0 };
    },
  });
  const collRef = (prefix: string): any => ({
    doc: (id: string) => docRef(`${prefix}/${id}`),
    ...query(prefix),
    where: (f: string, _op: string, v: any) => query(prefix, (d) => d?.[f] === v),
    listDocuments: async () => childrenOf(prefix).map((p) => docRef(p)),
  });
  const db: any = { getAll: async (...refs: any[]) => Promise.all(refs.map((r) => r.get())) };
  return { db, docs, app: docRef('apps/utd') };
};

const A = (id: string, t: string, s: string, g: string) => ({ id, teacherId: t, subjectId: s, gradeLevelId: g });

describe('applyOrgChanges — links are subcollection-only', () => {
  it('first commit: moves the legacy array into the subcollection (missing docs only) and drops it from the main doc', async () => {
    const f = makeFakeDb({
      'apps/utd': { organizationSettings: { name: 'UTD' }, teacherSubjectAssignments: [A('a1', 't1', 's1', 'g1'), A('a2', 't2', 's2', 'g2')] },
      'apps/utd/teacherSubjectAssignments/a1': A('a1', 't1', 's1', 'g1'), // mirror already has a1, lacks a2
    });
    await applyOrgChanges(f.db, f.app, { teachers: { upsert: [{ id: 't9', name: 'X' }] } }, 'admin');
    expect('teacherSubjectAssignments' in f.docs.get('apps/utd')!).toBe(false);
    expect(f.docs.get('apps/utd/teacherSubjectAssignments/a2')).toEqual(A('a2', 't2', 's2', 'g2'));
  });

  it('upserts and deletes go to the subcollection; a delete in the same commit is not undone by the fold-in', async () => {
    const f = makeFakeDb({
      'apps/utd': { teacherSubjectAssignments: [A('a1', 't1', 's1', 'g1')] },
      'apps/utd/teacherSubjectAssignments/a1': A('a1', 't1', 's1', 'g1'),
    });
    const res = await applyOrgChanges(f.db, f.app, {
      teacherSubjectAssignments: { upsert: [A('a3', 't3', 's3', 'g3')], deleteIds: ['a1'] },
    }, 'manager');
    expect(f.docs.has('apps/utd/teacherSubjectAssignments/a1')).toBe(false);
    expect(f.docs.get('apps/utd/teacherSubjectAssignments/a3')).toEqual(A('a3', 't3', 's3', 'g3'));
    expect(res.summary.teacherSubjectAssignments).toMatchObject({ upserts: 1, deletes: 1 });
    expect('teacherSubjectAssignments' in f.docs.get('apps/utd')!).toBe(false);
  });

  it('keeps a link that is still on the timetable and reports it', async () => {
    const f = makeFakeDb({
      'apps/utd': {},
      'apps/utd/teacherSubjectAssignments/a1': A('a1', 't1', 's1', 'g1'),
      'apps/utd/teacherSubjectAssignments/a2': A('a2', 't2', 's2', 'g2'),
      'apps/utd/scheduleEntries/e1': { id: 'e1', teacherIds: ['t1'], subjectId: 's1', gradeLevelId: 'g1' },
    });
    const res = await applyOrgChanges(f.db, f.app, { teacherSubjectAssignments: { deleteIds: ['a1', 'a2'] } }, 'admin');
    expect(f.docs.has('apps/utd/teacherSubjectAssignments/a1')).toBe(true);
    expect(f.docs.has('apps/utd/teacherSubjectAssignments/a2')).toBe(false);
    expect(res.rejected).toEqual([{ field: 'teacherSubjectAssignments', id: 'a1', reason: '409_CONFLICT_ASSIGNMENT_IN_USE' }]);
  });

  it('semester reset shape (many subjects, timetable already empty) deletes every link', async () => {
    const seed: Record<string, any> = { 'apps/utd': { organizationSettings: { isLocked: true } } };
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) { const id = `a${i}`; ids.push(id); seed[`apps/utd/teacherSubjectAssignments/${id}`] = A(id, `t${i}`, `s${i}`, 'g1'); }
    const f = makeFakeDb(seed);
    await applyOrgChanges(f.db, f.app, {
      teacherSubjectAssignments: { deleteIds: ids },
      organizationSettings: { set: { isLocked: false, semester: '1', academicYear: '2570' } },
    }, 'admin');
    expect(Array.from(f.docs.keys()).filter((k) => k.includes('/teacherSubjectAssignments/'))).toEqual([]);
    expect(f.docs.get('apps/utd')!.organizationSettings).toEqual({ isLocked: false, semester: '1', academicYear: '2570' });
  });
});

describe('applyOrgReplace — restore rebuilds the link subcollection', () => {
  it('replaces the links exactly and leaves no array on the main doc', async () => {
    const f = makeFakeDb({
      'apps/utd': { teacherSubjectAssignments: [A('old', 't', 's', 'g')] },
      'apps/utd/teacherSubjectAssignments/old': A('old', 't', 's', 'g'),
    });
    await applyOrgReplace(f.db, f.app, { teacherSubjectAssignments: [A('b1', 't1', 's1', 'g1')], teachers: [] });
    expect('teacherSubjectAssignments' in f.docs.get('apps/utd')!).toBe(false);
    expect(f.docs.has('apps/utd/teacherSubjectAssignments/old')).toBe(false);
    expect(f.docs.get('apps/utd/teacherSubjectAssignments/b1')).toEqual(A('b1', 't1', 's1', 'g1'));
  });
});
