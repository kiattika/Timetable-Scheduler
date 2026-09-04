/**
 * Phase 0 migration safety net — full entity-lifecycle integration tests.
 *
 * These exercise the REAL server write path (`applyOrgChanges` / `applyOrgReplace`
 * from functions/src/orgWrites.ts) against the Firestore emulator, end to end:
 * create → fresh read → update → fresh read → delete → fresh read. They pin the
 * CURRENT behaviour of `apps/{orgId}` so that if the upcoming subcollection
 * migration changes it (an entity silently vanishing, a field bleeding across,
 * a count drifting), one of these fails immediately.
 *
 * Requires the Firestore emulator (FIRESTORE_EMULATOR_HOST). Run via:
 *   npm run test:rules:emulate
 * When the emulator is not running these tests skip themselves.
 *
 * Scope note: several assertions here document a BASELINE, not a guarantee of
 * correctness — see the "known gap" markers. Phase 0 does not fix them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { applyOrgChanges } from '../../functions/src/orgWrites';

const EMULATED = !!process.env.FIRESTORE_EMULATOR_HOST;
const d = EMULATED ? describe : describe.skip;

const APP_DOC = 'apps/utd';
let app: App;
let db: Firestore;

const readDoc = async () => (await db.doc(APP_DOC).get()).data()!;
const scheduleDoc = (id: string) => db.doc(APP_DOC).collection('scheduleEntries').doc(id).get();

beforeAll(() => {
  if (!EMULATED) return;
  app = initializeApp({ projectId: 'timetable-entitylifecycle-test' }, 'entitylifecycle-' + Date.now());
  db = getFirestore(app);
});

afterAll(async () => {
  if (app) await deleteApp(app);
});

beforeEach(async () => {
  if (!EMULATED) return;
  // A clean, minimal but realistic org. `users` / `authorizedAdmins` are the
  // identity fields the content write path must never touch.
  await db.doc(APP_DOC).set({
    organizationId: 'utd',
    teachers: [{ id: 't-seed', name: 'Seed Teacher', department: 'Science', email: 'seed@utd.ac.th' }],
    subjects: [{ id: 's-seed', subjectCode: 'SEED1', name: 'Seed Subject' }],
    gradeLevels: [{ id: 'g1', name: 'M.1' }],
    physicalRooms: [{ id: 'r1', code: '101', name: 'Room 101', type: 'ห้องเรียนทั่วไป' }],
    teacherSubjectAssignments: [],
    periodSettings: [{ id: 'p1', label: 'P1', startTime: '08:30', endTime: '09:20' }],
    scheduleEntries: [],
    users: [{ id: 'admin1', email: 'admin@utd.ac.th', role: 'admin' }],
    authorizedAdmins: ['admin@utd.ac.th'],
    organizationSettings: { name: 'UTD', isLocked: false, schemaVersion: 1 },
  });
  // subcollection may carry over between tests in the same emulator run
  const existing = await db.doc(APP_DOC).collection('scheduleEntries').listDocuments();
  await Promise.all(existing.map((docRef) => docRef.delete()));
});

// ---------------------------------------------------------------------------
// 1. Teacher lifecycle
// ---------------------------------------------------------------------------
d('Teacher lifecycle', () => {
  it('create → fresh read shows it with every field; seed teacher untouched', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [{ id: 't-new', name: 'Ada Lovelace', department: 'Mathematics', email: 'ada@utd.ac.th', teacherCode: 'T900' }], deleteIds: [] },
    }, 'manager');

    const doc = await readDoc();
    const created = (doc.teachers as any[]).find((t) => t.id === 't-new');
    expect(created).toEqual({ id: 't-new', name: 'Ada Lovelace', department: 'Mathematics', email: 'ada@utd.ac.th', teacherCode: 'T900' });
    expect((doc.teachers as any[]).map((t) => t.id).sort()).toEqual(['t-new', 't-seed']);
  });

  it('partial update changes ONLY the sent field (field-level merge by id)', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [{ id: 't-new', name: 'Grace Hopper', department: 'Science', email: 'grace@utd.ac.th' }], deleteIds: [] },
    }, 'admin');

    // send only { id, department } — name / email must survive
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [{ id: 't-new', department: 'Mathematics' }], deleteIds: [] },
    }, 'admin');

    const created = (await readDoc()).teachers.find((t: any) => t.id === 't-new');
    expect(created).toEqual({ id: 't-new', name: 'Grace Hopper', department: 'Mathematics', email: 'grace@utd.ac.th' });
  });

  it('delete removes exactly that teacher and nothing else', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [{ id: 't-new', name: 'Temp' }], deleteIds: [] },
    }, 'manager');
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [], deleteIds: ['t-new'] },
    }, 'manager');

    const doc = await readDoc();
    expect((doc.teachers as any[]).map((t) => t.id)).toEqual(['t-seed']);
    // untouched neighbours
    expect((doc.subjects as any[]).map((s) => s.id)).toEqual(['s-seed']);
    expect((doc.users as any[]).map((u) => u.id)).toEqual(['admin1']);
  });
});

// ---------------------------------------------------------------------------
// 2. Subject lifecycle + subjectCode uniqueness
// ---------------------------------------------------------------------------
d('Subject lifecycle', () => {
  it('create → read → rename (code preserved) → delete', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      subjects: { upsert: [{ id: 's-eng', subjectCode: 'ENG101', name: 'English', color: '#abc' }], deleteIds: [] },
    }, 'manager');
    expect((await readDoc()).subjects.find((s: any) => s.id === 's-eng')).toMatchObject({ subjectCode: 'ENG101', name: 'English' });

    await applyOrgChanges(db, db.doc(APP_DOC), {
      subjects: { upsert: [{ id: 's-eng', name: 'English (Core)' }], deleteIds: [] },
    }, 'manager');
    expect((await readDoc()).subjects.find((s: any) => s.id === 's-eng')).toMatchObject({ subjectCode: 'ENG101', name: 'English (Core)', color: '#abc' });

    await applyOrgChanges(db, db.doc(APP_DOC), {
      subjects: { upsert: [], deleteIds: ['s-eng'] },
    }, 'manager');
    expect((await readDoc()).subjects.map((s: any) => s.id)).toEqual(['s-seed']);
  });

  it('a NEW subject whose subjectCode collides (case-insensitive) is rejected, not written', async () => {
    const res = await applyOrgChanges(db, db.doc(APP_DOC), {
      subjects: { upsert: [{ id: 's-dup', subjectCode: '  seed1 ', name: 'Colliding' }], deleteIds: [] },
    }, 'admin');

    expect(res.rejected.map((r) => r.id)).toEqual(['s-dup']);
    expect((await readDoc()).subjects.map((s: any) => s.id)).toEqual(['s-seed']);
  });

  it('renaming a subject while keeping its own code is allowed', async () => {
    const res = await applyOrgChanges(db, db.doc(APP_DOC), {
      subjects: { upsert: [{ id: 's-seed', subjectCode: 'SEED1', name: 'Seed Subject Renamed' }], deleteIds: [] },
    }, 'manager');
    expect(res.rejected).toEqual([]);
    expect((await readDoc()).subjects.find((s: any) => s.id === 's-seed').name).toBe('Seed Subject Renamed');
  });
});

// ---------------------------------------------------------------------------
// 3. Teacher–Subject assignment lifecycle + referential-integrity BASELINE
// ---------------------------------------------------------------------------
d('Teacher–Subject assignment lifecycle', () => {
  it('create an assignment linking a teacher + subject; both sides resolve', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [{ id: 't-a', name: 'Teacher A', department: 'Science' }], deleteIds: [] },
      subjects: { upsert: [{ id: 's-a', subjectCode: 'SCI200', name: 'Physics' }], deleteIds: [] },
      teacherSubjectAssignments: { upsert: [{ id: 'asm-1', teacherId: 't-a', subjectId: 's-a', gradeLevelId: 'g1' }], deleteIds: [] },
    }, 'admin');

    const doc = await readDoc();
    const asm = (doc.teacherSubjectAssignments as any[]).find((a) => a.id === 'asm-1');
    expect(asm).toMatchObject({ teacherId: 't-a', subjectId: 's-a', gradeLevelId: 'g1' });
    expect((doc.teachers as any[]).some((t) => t.id === asm.teacherId)).toBe(true);
    expect((doc.subjects as any[]).some((s) => s.id === asm.subjectId)).toBe(true);
  });

  it('KNOWN-GAP BASELINE: deleting the teacher leaves a DANGLING assignment (no server-side cascade)', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [{ id: 't-a', name: 'Teacher A', department: 'Science' }], deleteIds: [] },
      subjects: { upsert: [{ id: 's-a', subjectCode: 'SCI200', name: 'Physics' }], deleteIds: [] },
      teacherSubjectAssignments: { upsert: [{ id: 'asm-1', teacherId: 't-a', subjectId: 's-a', gradeLevelId: 'g1' }], deleteIds: [] },
    }, 'admin');

    // delete only the teacher
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [], deleteIds: ['t-a'] },
    }, 'admin');

    const doc = await readDoc();
    expect((doc.teachers as any[]).some((t) => t.id === 't-a')).toBe(false);
    // >>> Documented current behaviour: the assignment is NOT cascade-deleted and
    //     now points at a teacher that no longer exists. The server enforces no
    //     referential integrity between these arrays. Any cleanup today is
    //     client-side only (App.tsx) and is bypassed by this direct write path.
    //     Phase 0 does NOT fix this — it is flagged for the migration plan.
    const asm = (doc.teacherSubjectAssignments as any[]).find((a) => a.id === 'asm-1');
    expect(asm).toBeDefined();
    expect(asm.teacherId).toBe('t-a');
    expect((doc.teachers as any[]).some((t) => t.id === asm.teacherId)).toBe(false); // dangling
  });

  it('an assignment NOT on the timetable can be deleted; one that IS on it is rejected', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teacherSubjectAssignments: {
        upsert: [
          // asm-free references a subject that is NOT on the timetable
          { id: 'asm-free', teacherId: 't-seed', subjectId: 's-other', gradeLevelId: 'g1' },
          { id: 'asm-used', teacherId: 't-seed', subjectId: 's-seed', gradeLevelId: 'g1' },
        ],
        deleteIds: [],
      },
      scheduleEntries: {
        upsert: [{ id: 'se-x', gradeLevelId: 'g1', subjectId: 's-seed', teacherIds: ['t-seed'], day: 'Monday', period: 0 }],
        deleteIds: [],
      },
    }, 'admin');

    const res = await applyOrgChanges(db, db.doc(APP_DOC), {
      teacherSubjectAssignments: { upsert: [], deleteIds: ['asm-free', 'asm-used'] },
    }, 'admin');

    // asm-used matches se-x (subject + teacher + grade) → rejected & kept
    expect(res.rejected.map((r) => r.id)).toEqual(['asm-used']);
    const ids = (await readDoc()).teacherSubjectAssignments.map((a: any) => a.id);
    expect(ids).toEqual(['asm-used']);
  });
});

// ---------------------------------------------------------------------------
// 4. Schedule entry lifecycle (doc field + subcollection mirror)
// ---------------------------------------------------------------------------
d('Schedule entry lifecycle', () => {
  it('create → queryable in BOTH the doc field and the subcollection', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      scheduleEntries: {
        upsert: [{ id: 'se-1', gradeLevelId: 'g1', subjectId: 's-seed', teacherIds: ['t-seed'], physicalRoomId: 'r1', day: 'Monday', period: 0 }],
        deleteIds: [],
      },
    }, 'manager');

    expect((await readDoc()).scheduleEntries.find((e: any) => e.id === 'se-1')).toMatchObject({ subjectId: 's-seed', period: 0 });
    const sub = await scheduleDoc('se-1');
    expect(sub.exists).toBe(true);
    expect(sub.data()).toMatchObject({ id: 'se-1', gradeLevelId: 'g1', teacherIds: ['t-seed'] });
  });

  it('update → both views reflect the new period; delete → gone from both', async () => {
    await applyOrgChanges(db, db.doc(APP_DOC), {
      scheduleEntries: { upsert: [{ id: 'se-1', gradeLevelId: 'g1', subjectId: 's-seed', teacherIds: ['t-seed'], day: 'Monday', period: 0 }], deleteIds: [] },
    }, 'manager');

    await applyOrgChanges(db, db.doc(APP_DOC), {
      scheduleEntries: { upsert: [{ id: 'se-1', gradeLevelId: 'g1', subjectId: 's-seed', teacherIds: ['t-seed'], day: 'Monday', period: 3 }], deleteIds: [] },
    }, 'manager');
    expect((await readDoc()).scheduleEntries.find((e: any) => e.id === 'se-1').period).toBe(3);
    expect((await scheduleDoc('se-1')).data()!.period).toBe(3);

    await applyOrgChanges(db, db.doc(APP_DOC), {
      scheduleEntries: { upsert: [], deleteIds: ['se-1'] },
    }, 'manager');
    expect((await readDoc()).scheduleEntries.find((e: any) => e.id === 'se-1')).toBeUndefined();
    expect((await scheduleDoc('se-1')).exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Cross-entity read consistency — the test most likely to catch a migration bug
// ---------------------------------------------------------------------------
d('Cross-entity read consistency', () => {
  it('a sequence of mixed writes leaves exactly the expected shape and counts', async () => {
    // add 2 teachers, 3 subjects, 2 assignments, 1 schedule entry
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [{ id: 't1', name: 'One', department: 'Science' }, { id: 't2', name: 'Two', department: 'Mathematics' }], deleteIds: [] },
      subjects: {
        upsert: [
          { id: 'x1', subjectCode: 'X1', name: 'X1' },
          { id: 'x2', subjectCode: 'X2', name: 'X2' },
          { id: 'x3', subjectCode: 'X3', name: 'X3' },
        ],
        deleteIds: [],
      },
      teacherSubjectAssignments: {
        upsert: [
          { id: 'a1', teacherId: 't1', subjectId: 'x1', gradeLevelId: 'g1' },
          { id: 'a2', teacherId: 't2', subjectId: 'x2', gradeLevelId: 'g1' },
        ],
        deleteIds: [],
      },
      scheduleEntries: {
        upsert: [{ id: 'e1', gradeLevelId: 'g1', subjectId: 'x1', teacherIds: ['t1'], day: 'Tuesday', period: 1 }],
        deleteIds: [],
      },
    }, 'admin');

    // then delete one teacher and one subject
    await applyOrgChanges(db, db.doc(APP_DOC), {
      teachers: { upsert: [], deleteIds: ['t2'] },
      subjects: { upsert: [], deleteIds: ['x3'] },
    }, 'admin');

    const doc = await readDoc();
    expect((doc.teachers as any[]).map((t) => t.id).sort()).toEqual(['t-seed', 't1']);
    expect((doc.subjects as any[]).map((s) => s.id).sort()).toEqual(['s-seed', 'x1', 'x2']);
    expect((doc.teacherSubjectAssignments as any[]).map((a) => a.id).sort()).toEqual(['a1', 'a2']); // NB: a2 now dangles (t2 gone) — see known-gap baseline above
    expect((doc.gradeLevels as any[]).map((g) => g.id)).toEqual(['g1']);
    expect((doc.physicalRooms as any[]).map((r) => r.id)).toEqual(['r1']);
    expect((doc.periodSettings as any[]).map((p) => p.id)).toEqual(['p1']);

    // subcollection mirror in sync with the doc field
    const subIds = (await db.doc(APP_DOC).collection('scheduleEntries').listDocuments()).map((r) => r.id).sort();
    expect(subIds).toEqual(['e1']);
    expect((doc.scheduleEntries as any[]).map((e) => e.id)).toEqual(['e1']);

    // identity + settings never touched by the content path
    expect((doc.users as any[]).map((u) => u.id)).toEqual(['admin1']);
    expect(doc.authorizedAdmins).toEqual(['admin@utd.ac.th']);
    expect(doc.organizationSettings).toMatchObject({ name: 'UTD', schemaVersion: 1 });
    expect(doc.organizationId).toBe('utd');
  });
});

// ---------------------------------------------------------------------------
// 6. KNOWN GAP — no server-side double-booking / conflict detection
// ---------------------------------------------------------------------------
d('Schedule conflict detection — KNOWN GAP (documented, not fixed in Phase 0)', () => {
  it.todo('server rejects a scheduleEntry that double-books a teacher / room / class — NOT IMPLEMENTED (see architecture review)');

  it('BASELINE: the server currently ACCEPTS a schedule entry that double-books a teacher in the same day+period', async () => {
    const res = await applyOrgChanges(db, db.doc(APP_DOC), {
      scheduleEntries: {
        upsert: [
          { id: 'clash-a', gradeLevelId: 'g1', subjectId: 's-seed', teacherIds: ['t-seed'], physicalRoomId: 'r1', day: 'Wednesday', period: 2 },
          // same teacher, same room, same day+period, different class — a real conflict
          { id: 'clash-b', gradeLevelId: 'g1', subjectId: 's-seed', teacherIds: ['t-seed'], physicalRoomId: 'r1', day: 'Wednesday', period: 2 },
        ],
        deleteIds: [],
      },
    }, 'admin');

    // >>> No conflict detection exists server-side. Both entries are written and
    //     nothing is rejected. This assertion documents the gap; it is NOT an
    //     assertion that the permissive behaviour is correct. Conflict detection
    //     is a separate, later priority per the architecture review.
    expect(res.rejected).toEqual([]);
    const ids = (await readDoc()).scheduleEntries.map((e: any) => e.id).sort();
    expect(ids).toEqual(['clash-a', 'clash-b']);
  });
});
