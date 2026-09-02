/**
 * Firestore Rules — emulator tests for Phase 1 role/department authorization.
 *
 * Run:  npm run test:rules       (expects `firebase emulators:start --only firestore`
 *                                 OR use `npm run test:rules:ci` which wraps it)
 *
 * Covers the Phase 1 plan's step-6 matrix:
 *  - admin  : full read + write on apps/{appId}
 *  - manager: write allowed fields, denied users / authorizedAdmins
 *  - assistant: cannot write apps/{appId} or its subcollections directly
 *  - guest / unauthenticated: read-only / blocked as appropriate
 *  - correct role but different orgId  -> cannot write (cross-tenant)
 *  - no orgId claim (not-yet-backfilled) -> denied cleanly, no error
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'timetable-rules-test';
const APP_ID = 'utd';
const OTHER_ORG = 'other-org';

let testEnv: RulesTestEnvironment;

const ctx = (uid: string, opts: Record<string, unknown>) =>
  testEnv.authenticatedContext(uid, { email_verified: true, ...opts });

const admin = () => ctx('admin1', { email: 'admin@utd.ac.th', role: 'admin', orgId: APP_ID, assignedDepartments: [] });
const manager = () => ctx('mgr1', { email: 'mgr@utd.ac.th', role: 'manager', orgId: APP_ID, assignedDepartments: [] });
const assistant = () => ctx('asst1', { email: 'asst@utd.ac.th', role: 'assistant', orgId: APP_ID, assignedDepartments: ['Science'] });
const guest = () => ctx('guest1', { email: 'guest@utd.ac.th', role: 'guest', orgId: APP_ID, assignedDepartments: [] });
const notBackfilled = () => ctx('old1', { email: 'old@utd.ac.th', role: 'manager' }); // no orgId claim
const wrongOrg = () => ctx('x1', { email: 'x@utd.ac.th', role: 'admin', orgId: OTHER_ORG, assignedDepartments: [] });
const foreignDomain = () => ctx('g1', { email: 'someone@gmail.com', role: 'admin', orgId: APP_ID });

const appDoc = (c: any) => doc(c.firestore(), 'apps', APP_ID);
const schedDoc = (c: any, id: string) => doc(c.firestore(), 'apps', APP_ID, 'scheduleEntries', id);
const logDoc = (c: any, id: string) => doc(c.firestore(), 'apps', APP_ID, 'activityLogs', id);
const errDoc = (c: any, id: string) => doc(c.firestore(), 'apps', APP_ID, 'errors', id);

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'apps', APP_ID), {
      organizationId: APP_ID,
      teachers: [{ id: 't1', name: 'T One', department: 'Science' }],
      subjects: [{ id: 's1', name: 'Physics', department: 'Science' }],
      scheduleEntries: [],
      users: [{ id: 'admin1', email: 'admin@utd.ac.th', role: 'admin' }],
      authorizedAdmins: ['admin@utd.ac.th'],
      organizationSettings: { name: 'UTD' },
    });
    await setDoc(doc(c.firestore(), 'apps', APP_ID, 'scheduleEntries', 'existing'), {
      id: 'existing', gradeLevelId: 'g1', subjectId: 's1', teacherIds: ['t1'], day: 'Monday', period: 1,
    });
  });
});

describe('apps/{appId} document', () => {
  it('admin can read and write anything (incl. users)', async () => {
    await assertSucceeds(getDoc(appDoc(admin())));
    await assertSucceeds(updateDoc(appDoc(admin()), { teachers: [] }));
    await assertSucceeds(updateDoc(appDoc(admin()), { users: [], authorizedAdmins: [] }));
  });

  it('manager can write allowed fields', async () => {
    await assertSucceeds(getDoc(appDoc(manager())));
    await assertSucceeds(updateDoc(appDoc(manager()), { teachers: [{ id: 't2', name: 'T Two' }] }));
    await assertSucceeds(updateDoc(appDoc(manager()), { organizationSettings: { name: 'UTD 2' } }));
  });

  it('manager CANNOT write users or authorizedAdmins', async () => {
    await assertFails(updateDoc(appDoc(manager()), { users: [] }));
    await assertFails(updateDoc(appDoc(manager()), { authorizedAdmins: [] }));
    await assertFails(updateDoc(appDoc(manager()), { teachers: [], users: [] }));
  });

  it('assistant can read but CANNOT write the document', async () => {
    await assertSucceeds(getDoc(appDoc(assistant())));
    await assertFails(updateDoc(appDoc(assistant()), { teachers: [] }));
    await assertFails(updateDoc(appDoc(assistant()), { subjects: [] }));
  });

  it('guest can read but CANNOT write', async () => {
    await assertSucceeds(getDoc(appDoc(guest())));
    await assertFails(updateDoc(appDoc(guest()), { teachers: [] }));
  });

  it('unauthenticated is fully blocked', async () => {
    const u = testEnv.unauthenticatedContext();
    await assertFails(getDoc(appDoc(u)));
    await assertFails(updateDoc(appDoc(u), { teachers: [] }));
  });

  it('non-@utd.ac.th account is blocked from read and write', async () => {
    await assertFails(getDoc(appDoc(foreignDomain())));
    await assertFails(updateDoc(appDoc(foreignDomain()), { teachers: [] }));
  });

  it('cross-tenant: correct role, different orgId claim -> can read (domain) but NOT write', async () => {
    await assertSucceeds(getDoc(appDoc(wrongOrg())));
    await assertFails(updateDoc(appDoc(wrongOrg()), { teachers: [] }));
  });

  it('not-yet-backfilled account (no orgId claim) -> read ok, write denied cleanly', async () => {
    await assertSucceeds(getDoc(appDoc(notBackfilled())));
    await assertFails(updateDoc(appDoc(notBackfilled()), { teachers: [] }));
  });
});

describe('apps/{appId}/scheduleEntries', () => {
  it('any domain account can read', async () => {
    await assertSucceeds(getDocs(collection(assistant().firestore(), 'apps', APP_ID, 'scheduleEntries')));
    await assertSucceeds(getDoc(schedDoc(guest(), 'existing')));
  });

  it('admin / manager can write directly', async () => {
    await assertSucceeds(setDoc(schedDoc(admin(), 'e-admin'), { id: 'e-admin', subjectId: 's1' }));
    await assertSucceeds(setDoc(schedDoc(manager(), 'e-mgr'), { id: 'e-mgr', subjectId: 's1' }));
    await assertSucceeds(deleteDoc(schedDoc(manager(), 'existing')));
  });

  it('assistant CANNOT write directly (routes through assistantUpdateEntity)', async () => {
    await assertFails(setDoc(schedDoc(assistant(), 'e-asst'), { id: 'e-asst', subjectId: 's1' }));
    await assertFails(deleteDoc(schedDoc(assistant(), 'existing')));
  });

  it('guest CANNOT write', async () => {
    await assertFails(setDoc(schedDoc(guest(), 'e-guest'), { id: 'e-guest' }));
  });

  it('cross-tenant admin CANNOT write', async () => {
    await assertFails(setDoc(schedDoc(wrongOrg(), 'e-x'), { id: 'e-x' }));
  });
});

describe('apps/{appId}/activityLogs', () => {
  it('any domain account can create a log entry', async () => {
    await assertSucceeds(setDoc(logDoc(assistant(), 'l1'), { id: 'l1', action: 'Updated', user: 'asst@utd.ac.th' }));
    await assertSucceeds(setDoc(logDoc(guest(), 'l2'), { id: 'l2', action: 'Logged In', user: 'guest@utd.ac.th' }));
  });

  it('only admin can update / delete a log entry', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'apps', APP_ID, 'activityLogs', 'seed'), { id: 'seed', action: 'Updated' });
    });
    await assertFails(updateDoc(logDoc(manager(), 'seed'), { action: 'Removed' }));
    await assertFails(deleteDoc(logDoc(manager(), 'seed')));
    await assertSucceeds(deleteDoc(logDoc(admin(), 'seed')));
  });

  it('unauthenticated cannot create', async () => {
    await assertFails(setDoc(logDoc(testEnv.unauthenticatedContext(), 'l3'), { id: 'l3' }));
  });
});

describe('apps/{appId}/errors', () => {
  it('any authenticated account can create an error report', async () => {
    await assertSucceeds(setDoc(errDoc(guest(), 'e1'), { id: 'e1', message: 'boom' }));
    await assertSucceeds(setDoc(errDoc(foreignDomain(), 'e2'), { id: 'e2', message: 'boom' }));
  });

  it('only admin can delete an error report', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'apps', APP_ID, 'errors', 'seed'), { id: 'seed', message: 'x' });
    });
    await assertFails(deleteDoc(errDoc(manager(), 'seed')));
    await assertSucceeds(deleteDoc(errDoc(admin(), 'seed')));
  });
});
