/**
 * Phase 1 backfill — copy the monolithic `apps/{orgId}` entity arrays into their
 * mirror subcollections, WITHOUT changing the main document.
 *
 * This is the one-time (re-runnable) backfill that pairs with the live dual-write
 * added to `commitOrgChanges` / `assistantUpdateEntity` / the identity callables.
 * It is PURELY ADDITIVE: it never deletes a field from `apps/{orgId}`. (The
 * previous version of this file also stripped `scheduleEntries` / `activityLogs`
 * from the main doc — that array-cleanup belongs to a LATER phase and is kept in
 * `migrate-to-subcollections.ts.phase2-bak` for reference.)
 *
 * The entity → subcollection mapping is NOT reimplemented here: it calls the
 * exact same helpers the live write path uses (`rebuildEntityMirror`,
 * `mirrorPeriodSettingsDoc`, `mirrorUserDoc` in functions/src/orgWrites.ts), so
 * the script and production cannot drift.
 *
 * Idempotent: `rebuildEntityMirror` deletes any mirror doc whose id is not in the
 * source array and upserts the rest, so running N times === running once.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-subcollections.ts [orgId] [--dry-run] [--verify-only]
 *
 * Env:
 *   FIRESTORE_DATABASE_ID   default: the prod named DB (same default as functions/src/index.ts)
 *   FIRESTORE_EMULATOR_HOST  set by the emulator; the script then targets it
 *   GOOGLE_APPLICATION_CREDENTIALS  service-account key for a real run
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import {
  MIRRORED_ENTITY_FIELDS,
  rebuildEntityMirror,
  mirrorPeriodSettingsDoc,
  mirrorUserDoc,
  verifyOrgConsistency,
  PERIOD_SETTINGS_MIRROR_DOC_ID,
} from '../functions/src/orgWrites';

const FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID || 'ai-studio-ddf61d33-4a5f-4aed-a5a9-5bc34b3c98da';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const targetOrgId = positional[0] || process.env.VITE_ORG_ID || 'utd';
const DRY_RUN = flags.has('--dry-run');
const VERIFY_ONLY = flags.has('--verify-only');
const INCLUDE_USERS = true;

if (getApps().length === 0) {
  initializeApp(
    process.env.FIRESTORE_EMULATOR_HOST
      ? { projectId: process.env.GCLOUD_PROJECT || 'timetable-backfill' }
      : {},
  );
}

const db = getFirestore(FIRESTORE_DATABASE_ID);
const asArray = (v: any): any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : []);

function banner(msg: string) {
  console.log('='.repeat(70));
  console.log(msg);
  console.log('='.repeat(70));
}

/** Report what a rebuild WOULD do without writing (dry-run). */
async function planField(appDocRef: DocumentReference, field: string, source: any[]) {
  const keep = new Set(asArray(source).map((e) => e.id));
  const existing = await appDocRef.collection(field).get();
  const existingIds = new Set(existing.docs.map((d) => d.id));
  const toDelete = [...existingIds].filter((id) => !keep.has(id));
  const toAdd = [...keep].filter((id) => !existingIds.has(id));
  const toMaybeUpdate = [...keep].filter((id) => existingIds.has(id));
  console.log(
    `  ${field.padEnd(26)} source=${String(asArray(source).length).padStart(4)}  ` +
      `mirror=${String(existingIds.size).padStart(4)}  +add=${toAdd.length}  -del=${toDelete.length}  ~upsert=${toMaybeUpdate.length}`,
  );
  return { toAdd, toDelete, toMaybeUpdate };
}

async function run() {
  banner(`Phase 1 subcollection backfill — org "${targetOrgId}"  db "${FIRESTORE_DATABASE_ID}"`);
  console.log(`mode: ${VERIFY_ONLY ? 'VERIFY ONLY' : DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write mirrors)'}`);
  console.log(`emulator: ${process.env.FIRESTORE_EMULATOR_HOST || '(none — real database)'}`);
  console.log('');

  const appDocRef = db.doc(`apps/${targetOrgId}`);
  const snap = await appDocRef.get();
  if (!snap.exists) {
    console.error(`No document at apps/${targetOrgId}. Nothing to do.`);
    process.exit(1);
  }
  const doc = snap.data() || {};

  if (VERIFY_ONLY) {
    const report = await verifyOrgConsistency(appDocRef, { includeUsers: INCLUDE_USERS });
    console.log(JSON.stringify(report, null, 2));
    banner(report.ok ? '✓ CONSISTENT — mirrors match the monolithic doc' : '✗ DIVERGENCE — see report above');
    process.exit(report.ok ? 0 : 2);
  }

  if (DRY_RUN) {
    console.log('Would rebuild these mirror subcollections:');
    for (const field of MIRRORED_ENTITY_FIELDS) await planField(appDocRef, field, doc[field]);
    // periodSettings — single doc
    {
      const ps = await appDocRef.collection('periodSettings').doc(PERIOD_SETTINGS_MIRROR_DOC_ID).get();
      const mirrorLen = ps.exists ? (Array.isArray((ps.data() as any)?.items) ? (ps.data() as any).items.length : 0) : 0;
      console.log(`  ${'periodSettings (single doc)'.padEnd(26)} source=${String(asArray(doc.periodSettings).length).padStart(4)}  mirror=${String(mirrorLen).padStart(4)}`);
    }
    if (INCLUDE_USERS) await planField(appDocRef, 'users', doc.users);
    banner('DRY RUN complete — no writes performed. Re-run without --dry-run to apply.');
    return;
  }

  // LIVE
  for (const field of MIRRORED_ENTITY_FIELDS) {
    const res = await rebuildEntityMirror(appDocRef, field, asArray(doc[field]));
    console.log(`  ${field.padEnd(26)} upserts=${res.upserts}  deletes=${res.deletes}`);
  }
  if (Array.isArray(doc.periodSettings)) {
    await mirrorPeriodSettingsDoc(appDocRef, asArray(doc.periodSettings));
    console.log(`  periodSettings              wrote single doc "${PERIOD_SETTINGS_MIRROR_DOC_ID}" (${asArray(doc.periodSettings).length} items)`);
  }
  if (INCLUDE_USERS) {
    let n = 0;
    for (const u of asArray(doc.users)) { await mirrorUserDoc(appDocRef, u); n++; }
    // prune mirror users no longer in the array
    const keep = new Set(asArray(doc.users).map((u) => u.id));
    const existing = await appDocRef.collection('users').listDocuments();
    let pruned = 0;
    for (const d of existing) if (!keep.has(d.id)) { await d.delete(); pruned++; }
    console.log(`  users                      upserts=${n}  deletes=${pruned}`);
  }

  console.log('');
  const report = await verifyOrgConsistency(appDocRef, { includeUsers: INCLUDE_USERS });
  console.log(`post-backfill consistency: ${report.ok ? 'OK ✓' : 'STILL DIVERGED ✗'}`);
  if (!report.ok) {
    console.log(JSON.stringify(report.fields.filter((f) => !f.ok), null, 2));
    banner('✗ Backfill ran but mirrors still diverge — investigate before proceeding.');
    process.exit(2);
  }
  banner('✓ Backfill complete and verified consistent.');
}

run().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
