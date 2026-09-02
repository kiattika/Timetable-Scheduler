/**
 * Emulator integration test: proves the end-to-end concurrency fix.
 *
 * Requires the Firestore emulator (FIRESTORE_EMULATOR_HOST). Run via:
 *   npm run test:rules:emulate
 * When the emulator is not running these tests skip themselves.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { applyOrgChanges, applyOrgReplace } from '../../functions/src/orgWrites';

const EMULATED = !!process.env.FIRESTORE_EMULATOR_HOST;
const d = EMULATED ? describe : describe.skip;

const APP_DOC = 'apps/utd';
let app: App;
let db: Firestore;

beforeAll(() => {
  if (!EMULATED) return;
  app = initializeApp({ projectId: 'timetable-orgwrites-test' }, 'orgwrites-' + Date.now());
  db = getFirestore(app);
});

afterAll(async () => {
  if (app) await deleteApp(app);
});

beforeEach(async () => {
  if (!EMULATED) return;
  await db.doc(APP_DOC).set({
    organizationId: 'utd',
    teachers: [{ id: 't1', name: 'T One', department: 'Science' }],
    subjects: [],
    scheduleEntries: [],
    users: [{ id: 'admin1', email: 'admin@utd.ac.th', role: 'admin' }],
    authorizedAdmins: ['admin@utd.ac.th'],
    organizationSettings: { name: 'UTD', isLocked: false },
  });
});

d('applyOrgChanges — concurrent writers do not lose data', () => {
  it('sequential: stale client B adding Y does not erase X added by client A', async () => {
    // Client A adds subject X.
    await applyOrgChanges(db, db.doc(APP_DOC), {
      subjects: { upsert: [{ id: 'x', subjectCode: 'X1', name: 'Subject X' }], deleteIds: [] },
    }, 'manager');

    // Client B never saw X; it only knows it added Y.
    await applyOrgChanges(db, db.doc(APP_DOC), {
      subjects: { upsert: [{ id: 'y', subjectCode: 'Y1', name: 'Subject Y' }], deleteIds: [] },
    }, 'admin');

    const snap = await db.doc(APP_DOC).get();
    const ids = (snap.data()!.subjects as any[]).map((s) => s.id).sort();
    expect(ids).toEqual(['x', 'y']);
  });

  it('true race: two concurrent applyOrgChanges both land (precondition + retry)', async () => {
    const results = await Promise.all([
      applyOrgChanges(db, db.doc(APP_DOC), {
        subjects: { upsert: [{ id: 'a', subjectCode: 'A', name: 'A' }], deleteIds: [] },
      }, 'admin'),
      applyOrgChanges(db, db.doc(APP_DOC), {
        teachers: { upsert: [{ id: 't2', name: 'T Two', department: 'Math' }], deleteIds: [] },
      }, 'admin'),
    ]);

    const snap = await db.doc(APP_DOC).get();
    const data = snap.data()!;
    expect((data.subjects as any[]).map((s) => s.id)).toContain('a');
    expect((data.teachers as any[]).map((t) => t.id).sort()).toEqual(['t1', 't2']);
    // at least one call had to retry past a conflict, or both serialised cleanly
    expect(results.every((r) => r.attempts >= 1)).toBe(true);
  });

  it('many concurrent adds of distinct subjects all survive', async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        applyOrgChanges(db, db.doc(APP_DOC), {
          subjects: { upsert: [{ id: `s${i}`, subjectCode: `C${i}`, name: `S${i}` }], deleteIds: [] },
        }, 'manager'),
      ),
    );
    const snap = await db.doc(APP_DOC).get();
    const ids = (snap.data()!.subjects as any[]).map((s) => s.id).sort();
    expect(ids).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
  });

  it('rejects a concurrent duplicate subjectCode (exactly one wins)', async () => {
    const settled = await Promise.allSettled([
      applyOrgChanges(db, db.doc(APP_DOC), {
        subjects: { upsert: [{ id: 'p', subjectCode: 'SAME', name: 'P' }], deleteIds: [] },
      }, 'admin'),
      applyOrgChanges(db, db.doc(APP_DOC), {
        subjects: { upsert: [{ id: 'q', subjectCode: 'same', name: 'Q' }], deleteIds: [] },
      }, 'admin'),
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled').length;
    const failed = settled.filter((s) => s.status === 'rejected');
    expect(ok).toBe(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason.code).toBe('already-exists');

    const snap = await db.doc(APP_DOC).get();
    const codes = (snap.data()!.subjects as any[]).map((s) => String(s.subjectCode).toLowerCase());
    expect(codes.filter((c) => c === 'same')).toHaveLength(1);
  });

  it('syncs the scheduleEntries subcollection from the explicit diff', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      scheduleEntries: {
        upsert: [{ id: 'e1', gradeLevelId: 'g1', subjectId: 's1', day: 'Monday', period: 1 }],
        deleteIds: [],
      },
    }, 'manager');
    const sub = await db.doc(APP_DOC).collection('scheduleEntries').doc('e1').get();
    expect(sub.exists).toBe(true);

    await applyOrgChanges(db, db.doc(APP_DOC), {
      scheduleEntries: { upsert: [], deleteIds: ['e1'] },
    }, 'manager');
    const sub2 = await db.doc(APP_DOC).collection('scheduleEntries').doc('e1').get();
    expect(sub2.exists).toBe(false);
  });
});

d('applyOrgReplace — restore never nukes the user list', () => {
  it('replaces content but preserves users / authorizedAdmins', async () => {
    await applyOrgReplace(db, db.doc(APP_DOC), {
      teachers: [{ id: 'new-t', name: 'Restored' }],
      subjects: [{ id: 'new-s', subjectCode: 'R1', name: 'Restored Subject' }],
      users: [{ id: 'ATTACKER', role: 'admin' }], // must be ignored
      authorizedAdmins: ['attacker@evil.com'], // must be ignored
      organizationSettings: { name: 'Restored School' },
    });
    const data = (await db.doc(APP_DOC).get()).data()!;
    expect((data.teachers as any[]).map((t) => t.id)).toEqual(['new-t']);
    expect((data.users as any[]).map((u) => u.id)).toEqual(['admin1']); // untouched
    expect(data.authorizedAdmins).toEqual(['admin@utd.ac.th']); // untouched
    expect(data.organizationSettings.name).toBe('Restored School');
  });
});
