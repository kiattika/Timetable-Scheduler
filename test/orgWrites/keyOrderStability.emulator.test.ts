/**
 * VERIFICATION for the "spurious updates for untouched entities" bug.
 *
 * Hypothesis: change-detection compares entities via JSON.stringify(), which is
 * key-order sensitive. Firestore does not guarantee map key order across reads,
 * so an entity that round-trips through two docSnap.data() deserialisations can
 * serialise differently despite being semantically identical -> the diff treats
 * every entity as "changed".
 *
 * This test probes whether the Firestore client SDK returns array-element map
 * keys in a stable order across reads / after arrayUnion. It is informational:
 * whatever the emulator does, the fix (order-insensitive comparison) is required.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';

const EMULATED = !!process.env.FIRESTORE_EMULATOR_HOST;
const d = EMULATED ? describe : describe.skip;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  if (!EMULATED) return;
  testEnv = await initializeTestEnvironment({
    projectId: 'keyorder-probe',
    firestore: { host: '127.0.0.1', port: 8080, rules: 'rules_version = "2";\nservice cloud.firestore {\n match /databases/{db}/documents { match /{d=**} { allow read, write: if true; } }\n}' },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

d('Firestore client SDK — array element key-order across reads', () => {
  it('reports whether an untouched teacher serialises identically after an unrelated arrayUnion', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      const ref = doc(db, 'apps', 'probe');

      // Write a teacher with a deliberate, specific key order.
      await setDoc(ref, {
        teachers: [{ name: 'Dr X', teacherCode: 'T1', department: 'Sci', email: 'x@utd.ac.th', homeroomGradeLevelIds: ['g1'] }],
        subjects: [],
      });

      const read1 = (await getDocFromServer(ref)).data()!;
      const s1 = JSON.stringify(read1.teachers[0]);

      // Unrelated write to a different field.
      await updateDoc(ref, { subjects: arrayUnion({ id: 'newsub', name: 'New Subject', color: '#fff' }) });
      const read2 = (await getDocFromServer(ref)).data()!;
      const s2 = JSON.stringify(read2.teachers[0]);

      // arrayUnion on the SAME array field.
      await updateDoc(ref, { teachers: arrayUnion({ id: 't2', name: 'Dr Y' }) });
      const read3 = (await getDocFromServer(ref)).data()!;
      const s3 = JSON.stringify(read3.teachers.find((t: any) => t.teacherCode === 'T1'));

      // eslint-disable-next-line no-console
      console.log('[keyorder] read1:', s1);
      // eslint-disable-next-line no-console
      console.log('[keyorder] read2 (after unrelated arrayUnion):', s2, s2 === s1 ? '== STABLE' : '!= DRIFTED');
      // eslint-disable-next-line no-console
      console.log('[keyorder] read3 (after same-field arrayUnion):', s3, s3 === s1 ? '== STABLE' : '!= DRIFTED');

      // Semantic equality must hold regardless of key order.
      expect(new Set(Object.keys(read1.teachers[0]))).toEqual(new Set(Object.keys(read2.teachers[0])));
      expect(read2.teachers[0]).toMatchObject(read1.teachers[0]);
    });
  });

  it('reports whether a full-array write-back (what saveAppData/commitOrgChanges do) reorders untouched elements', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      const ref = doc(db, 'apps', 'probe2');
      await setDoc(ref, {
        teachers: [
          { name: 'A', teacherCode: 'T1', department: 'Sci', email: 'a@x', homeroomGradeLevelIds: [] },
          { name: 'B', teacherCode: 'T2', department: 'Math', email: 'b@x', homeroomGradeLevelIds: ['g2'] },
        ],
      });

      let prev = JSON.stringify((await getDocFromServer(ref)).data()!.teachers[0]);
      let drifted = false;
      for (let i = 0; i < 5; i++) {
        const cur = (await getDocFromServer(ref)).data()!;
        // write the WHOLE array straight back, only touching teacher B
        const arr = cur.teachers.map((t: any) => (t.teacherCode === 'T2' ? { ...t, name: `B${i}` } : t));
        await setDoc(ref, { teachers: arr }, { merge: true });
        const after = JSON.stringify((await getDocFromServer(ref)).data()!.teachers.find((t: any) => t.teacherCode === 'T1'));
        if (after !== prev) { drifted = true; }
        // eslint-disable-next-line no-console
        console.log(`[keyorder wb#${i}] T1 ${after === prev ? '== stable' : '!= DRIFTED\n  was: ' + prev + '\n  now: ' + after}`);
        prev = after;
      }
      // eslint-disable-next-line no-console
      console.log(`[keyorder] full-array write-back drift on standard-edition emulator: ${drifted}`);
      expect(typeof drifted).toBe('boolean'); // informational; the fix must work regardless
    });
  });
});
