/**
 * Phase 1 — focused dual-write / backfill / consistency tests.
 *
 * Emulator only (FIRESTORE_EMULATOR_HOST). Run: npm run test:rules:emulate
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import {
  applyOrgChanges,
  rebuildEntityMirror,
  mirrorPeriodSettingsDoc,
  mirrorUserDoc,
  verifyOrgConsistency,
  MIRRORED_ENTITY_FIELDS,
  PERIOD_SETTINGS_MIRROR_DOC_ID,
} from '../../functions/src/orgWrites';

const EMULATED = !!process.env.FIRESTORE_EMULATOR_HOST;
const d = EMULATED ? describe : describe.skip;

const APP_DOC = 'apps/utd';
let app: App;
let db: Firestore;
const ref = () => db.doc(APP_DOC);

const SEED = {
  organizationId: 'utd',
  teachers: [{ id: 't1', name: 'One', department: 'Science' }, { id: 't2', name: 'Two', department: 'Math' }],
  subjects: [{ id: 's1', subjectCode: 'S1', name: 'Sub 1' }],
  gradeLevels: [{ id: 'g1', name: 'M.1' }],
  physicalRooms: [{ id: 'r1', code: '101', name: 'R1', type: 'x' }],
  teacherSubjectAssignments: [{ id: 'a1', teacherId: 't1', subjectId: 's1', gradeLevelId: 'g1' }],
  periodSettings: [
    { id: 'p0', label: 'P0', startTime: '07:40', endTime: '08:30' },
    { id: 'p1', label: 'P1', startTime: '08:30', endTime: '09:20' },
  ],
  scheduleEntries: [] as any[],
  users: [{ id: 'admin1', email: 'admin@utd.ac.th', role: 'admin', organizationId: 'utd' }],
  authorizedAdmins: ['admin@utd.ac.th'],
  organizationSettings: { name: 'UTD', schemaVersion: 1 },
};

const collIds = async (field: string) =>
  (await ref().collection(field).listDocuments()).map((r) => r.id).sort();
const wipeMirrors = async () => {
  for (const c of [...MIRRORED_ENTITY_FIELDS, 'users', 'periodSettings']) {
    const docs = await ref().collection(c).listDocuments();
    await Promise.all(docs.map((x) => x.delete()));
  }
};

beforeAll(() => {
  if (!EMULATED) return;
  app = initializeApp({ projectId: 'timetable-mirror-dualwrite-test' }, 'mirror-' + Date.now());
  db = getFirestore(app);
});
afterAll(async () => { if (app) await deleteApp(app); });

beforeEach(async () => {
  if (!EMULATED) return;
  await ref().set(SEED);
  await wipeMirrors();
});

d('applyOrgChanges — one call mirrors every changed entity type', () => {
  it('each changed entity lands in its mirror; periodSettings goes to the single ordered doc', async () => {
    // start consistent (post-backfill state)
    for (const f of MIRRORED_ENTITY_FIELDS) await rebuildEntityMirror(ref(), f, (SEED as any)[f] || []);
    await mirrorPeriodSettingsDoc(ref(), SEED.periodSettings);

    await applyOrgChanges(db, ref(), {
      teachers: { upsert: [{ id: 't3', name: 'Three', department: 'Science' }], deleteIds: [] },
      subjects: { upsert: [{ id: 's2', subjectCode: 'S2', name: 'Sub 2' }], deleteIds: [] },
      gradeLevels: { upsert: [{ id: 'g2', name: 'M.2' }], deleteIds: [] },
      physicalRooms: { upsert: [{ id: 'r2', code: '102', name: 'R2', type: 'x' }], deleteIds: [] },
      teacherSubjectAssignments: { upsert: [{ id: 'a2', teacherId: 't2', subjectId: 's1', gradeLevelId: 'g1' }], deleteIds: [] },
      periodSettings: { upsert: [{ id: 'p2', label: 'P2', startTime: '09:20', endTime: '10:10' }], deleteIds: [] },
      scheduleEntries: { upsert: [{ id: 'e1', gradeLevelId: 'g1', subjectId: 's1', teacherIds: ['t1'], day: 'Monday', period: 0 }], deleteIds: [] },
    }, 'admin');

    expect((await ref().collection('teachers').doc('t3').get()).exists).toBe(true);
    expect((await ref().collection('subjects').doc('s2').get()).exists).toBe(true);
    expect((await ref().collection('gradeLevels').doc('g2').get()).exists).toBe(true);
    expect((await ref().collection('physicalRooms').doc('r2').get()).exists).toBe(true);
    expect((await ref().collection('teacherSubjectAssignments').doc('a2').get()).exists).toBe(true);
    expect((await ref().collection('scheduleEntries').doc('e1').get()).exists).toBe(true);

    const ps = await ref().collection('periodSettings').doc(PERIOD_SETTINGS_MIRROR_DOC_ID).get();
    expect((ps.data() as any).items.map((p: any) => p.id)).toEqual(['p0', 'p1', 'p2']);
    expect(await collIds('periodSettings')).toEqual([PERIOD_SETTINGS_MIRROR_DOC_ID]);

    const report = await verifyOrgConsistency(ref());
    expect(report.ok, JSON.stringify(report.fields.filter((f) => !f.ok), null, 2)).toBe(true);
  });

  it('incremental: after a backfill, a later edit keeps the mirror in sync (no wipe)', async () => {
    // backfill first
    for (const f of MIRRORED_ENTITY_FIELDS) await rebuildEntityMirror(ref(), f, (SEED as any)[f] || []);
    await mirrorPeriodSettingsDoc(ref(), SEED.periodSettings);

    await applyOrgChanges(db, ref(), {
      teachers: { upsert: [{ id: 't1', department: 'Physics' }], deleteIds: ['t2'] },
    }, 'manager');

    expect(await collIds('teachers')).toEqual(['t1']);
    expect((await ref().collection('teachers').doc('t1').get()).data()).toEqual({ id: 't1', name: 'One', department: 'Physics' });
    const report = await verifyOrgConsistency(ref());
    expect(report.ok).toBe(true);
  });

  it('self-heal: a stale mirror is repaired when the same changeset is re-sent (no-op branch)', async () => {
    for (const f of MIRRORED_ENTITY_FIELDS) await rebuildEntityMirror(ref(), f, (SEED as any)[f] || []);
    await mirrorPeriodSettingsDoc(ref(), SEED.periodSettings);

    // simulate step-2 failure: doc gets the change, mirror does NOT
    await ref().update({ subjects: [...SEED.subjects, { id: 's-new', subjectCode: 'NEW', name: 'New' }] });
    expect((await ref().collection('subjects').doc('s-new').get()).exists).toBe(false); // mirror stale
    let report = await verifyOrgConsistency(ref());
    expect(report.ok).toBe(false);

    // client autosave re-sends the identical changeset; merge is a doc no-op,
    // the "no doc-field changes" branch still runs syncAllEntityMirrors
    await applyOrgChanges(db, ref(), {
      subjects: { upsert: [{ id: 's-new', subjectCode: 'NEW', name: 'New' }], deleteIds: [] },
    }, 'admin');

    expect((await ref().collection('subjects').doc('s-new').get()).exists).toBe(true);
    report = await verifyOrgConsistency(ref());
    expect(report.ok, JSON.stringify(report.fields.filter((f) => !f.ok))).toBe(true);
  });
});

d('backfill via rebuildEntityMirror — idempotent', () => {
  it('running the backfill 3× leaves an identical, consistent result; the 2nd run is a net no-op', async () => {
    const runBackfill = async () => {
      const results: Record<string, { upserts: number; deletes: number }> = {};
      for (const f of MIRRORED_ENTITY_FIELDS) {
        results[f] = await rebuildEntityMirror(ref(), f, (SEED as any)[f] || []);
      }
      await mirrorPeriodSettingsDoc(ref(), SEED.periodSettings);
      return results;
    };

    const first = await runBackfill();
    const snap1 = await Promise.all(MIRRORED_ENTITY_FIELDS.map(collIds));

    const second = await runBackfill();
    const snap2 = await Promise.all(MIRRORED_ENTITY_FIELDS.map(collIds));
    await runBackfill();
    const snap3 = await Promise.all(MIRRORED_ENTITY_FIELDS.map(collIds));

    expect(snap2).toEqual(snap1);
    expect(snap3).toEqual(snap1);
    // first run adds rows; subsequent runs delete nothing (idempotent)
    expect(first.teachers.upserts).toBe(2);
    for (const f of MIRRORED_ENTITY_FIELDS) expect(second[f].deletes).toBe(0);

    expect((await verifyOrgConsistency(ref())).ok).toBe(true);
  });

  it('backfill removes a mirror row that is no longer in the doc array (stale cleanup)', async () => {
    await ref().collection('teachers').doc('ghost').set({ id: 'ghost', name: 'not in doc' });
    const res = await rebuildEntityMirror(ref(), 'teachers', SEED.teachers);
    expect(res.deletes).toBe(1);
    expect(await collIds('teachers')).toEqual(['t1', 't2']);
  });
});

d('verifyOrgConsistency — detects divergence', () => {
  beforeEach(async () => {
    for (const f of MIRRORED_ENTITY_FIELDS) await rebuildEntityMirror(ref(), f, (SEED as any)[f] || []);
    await mirrorPeriodSettingsDoc(ref(), SEED.periodSettings);
    for (const u of SEED.users) await mirrorUserDoc(ref(), u);
  });

  it('flags a mirror doc whose content drifted from the array', async () => {
    await ref().collection('teachers').doc('t1').set({ id: 't1', name: 'TAMPERED', department: 'Science' });
    const report = await verifyOrgConsistency(ref());
    expect(report.ok).toBe(false);
    const teachers = report.fields.find((f) => f.field === 'teachers')!;
    expect(teachers.contentMismatch).toEqual(['t1']);
    expect(teachers.missingInMirror).toEqual([]);
  });

  it('flags an id present in the mirror but not the doc array, and vice-versa', async () => {
    await ref().collection('subjects').doc('extra').set({ id: 'extra', name: 'x' });
    await ref().update({ gradeLevels: FieldValue.arrayUnion({ id: 'gX', name: 'M.X' }) });
    const report = await verifyOrgConsistency(ref());
    expect(report.fields.find((f) => f.field === 'subjects')!.extraInMirror).toEqual(['extra']);
    expect(report.fields.find((f) => f.field === 'gradeLevels')!.missingInMirror).toEqual(['gX']);
  });

  it('flags a periodSettings RE-ORDER even when the id set matches', async () => {
    await mirrorPeriodSettingsDoc(ref(), [SEED.periodSettings[1], SEED.periodSettings[0]]); // swapped
    const report = await verifyOrgConsistency(ref());
    const ps = report.fields.find((f) => f.field === 'periodSettings')!;
    expect(ps.ok).toBe(false);
    expect(ps.contentMismatch).toContain('__order__');
  });

  it('includeUsers: consistent after mirroring the users array, diverges if one is stale', async () => {
    let report = await verifyOrgConsistency(ref(), { includeUsers: true });
    expect(report.fields.find((f) => f.field === 'users')!.ok).toBe(true);

    await ref().update({ users: FieldValue.arrayUnion({ id: 'u2', email: 'u2@utd.ac.th', role: 'teacher' }) });
    report = await verifyOrgConsistency(ref(), { includeUsers: true });
    expect(report.fields.find((f) => f.field === 'users')!.missingInMirror).toEqual(['u2']);

    await mirrorUserDoc(ref(), { id: 'u2', email: 'u2@utd.ac.th', role: 'teacher' });
    report = await verifyOrgConsistency(ref(), { includeUsers: true });
    expect(report.ok).toBe(true);
  });
});
