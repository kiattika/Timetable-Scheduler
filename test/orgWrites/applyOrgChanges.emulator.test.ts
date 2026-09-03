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
import { computeOrgChanges } from '../../lib/orgChangesClient';

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

  it('ISSUE A: two clients each add ONE subject via the real client flow (read -> computeOrgChanges -> commit), concurrently — both survive', async () => {
    // each "client" reads the server, diffs its own local state, and commits — the
    // exact path the app takes. Client B reads BEFORE A commits (stale).
    const serverForA = (await db.doc(APP_DOC).get()).data()!;
    const serverForB = (await db.doc(APP_DOC).get()).data()!;

    const localA = { ...serverForA, subjects: [...(serverForA.subjects || []), { id: 'jp1', subjectCode: 'JP1', name: 'ภาษาญี่ปุ่น 1' }] };
    const localB = { ...serverForB, subjects: [...(serverForB.subjects || []), { id: 'kr1', subjectCode: 'KR1', name: 'ภาษาเกาหลี 1' }] };

    const chA = computeOrgChanges(serverForA, localA).changes;
    const chB = computeOrgChanges(serverForB, localB).changes;

    await Promise.all([
      applyOrgChanges(db, db.doc(APP_DOC), chA as any, 'admin'),
      applyOrgChanges(db, db.doc(APP_DOC), chB as any, 'manager'),
    ]);

    const finalIds = ((await db.doc(APP_DOC).get()).data()!.subjects as any[]).map((s) => s.id).sort();
    expect(finalIds).toEqual(['jp1', 'kr1']);
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

  it('a concurrent duplicate subjectCode is skipped (not thrown) — exactly one lands', async () => {
    const [ra, rb] = await Promise.all([
      applyOrgChanges(db, db.doc(APP_DOC), {
        subjects: { upsert: [{ id: 'p', subjectCode: 'SAME', name: 'P' }], deleteIds: [] },
      }, 'admin'),
      applyOrgChanges(db, db.doc(APP_DOC), {
        subjects: { upsert: [{ id: 'q', subjectCode: 'same', name: 'Q' }], deleteIds: [] },
      }, 'admin'),
    ]);
    // both calls succeed; exactly one reports a rejection
    const totalRejected = ra.rejected.length + rb.rejected.length;
    expect(totalRejected).toBe(1);

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
