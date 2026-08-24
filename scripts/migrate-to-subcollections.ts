/**
 * Migration Script: Migrate ScheduleEntries and ActivityLogs to Subcollections
 *
 * This script is idempotent: it can be executed safely multiple times.
 * It copies array entries from the monolithic `apps/{orgId}` document into:
 * - `apps/{orgId}/scheduleEntries/{entryId}`
 * - `apps/{orgId}/activityLogs/{logId}`
 * And removes the legacy arrays from the main document using FieldValue.delete().
 *
 * Usage:
 *   npx tsx scripts/migrate-to-subcollections.ts [orgId]
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin if not already initialized
if (getApps().length === 0) {
  try {
    initializeApp();
  } catch (e) {
    initializeApp({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'uttaradit-school'
    });
  }
}

const db = getFirestore();
const targetOrgId = process.argv[2] || process.env.VITE_ORG_ID || 'utd';

async function runMigration() {
  console.log(`=======================================================`);
  console.log(`Starting subcollections migration for org: "${targetOrgId}"`);
  console.log(`=======================================================`);

  const docRef = db.doc(`apps/${targetOrgId}`);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    console.log(`No main document found at apps/${targetOrgId}. Nothing to migrate.`);
    return;
  }

  const data = docSnap.data() || {};
  const scheduleEntries: any[] = Array.isArray(data.scheduleEntries) ? data.scheduleEntries : [];
  const activityLogs: any[] = Array.isArray(data.activityLogs) ? data.activityLogs : [];

  console.log(`Found ${scheduleEntries.length} schedule entries and ${activityLogs.length} activity logs in main doc.`);

  // 1. Migrate scheduleEntries to subcollection apps/{orgId}/scheduleEntries/{entryId}
  if (scheduleEntries.length > 0) {
    console.log(`Migrating ${scheduleEntries.length} schedule entries to subcollection...`);
    const scheduleCol = db.collection(`apps/${targetOrgId}/scheduleEntries`);
    
    let batch = db.batch();
    let count = 0;
    let totalMigrated = 0;

    for (const entry of scheduleEntries) {
      if (!entry || !entry.id) continue;
      const entryRef = scheduleCol.doc(entry.id);
      
      // Idempotent write
      batch.set(entryRef, entry, { merge: true });
      count++;
      totalMigrated++;

      if (count >= 400) {
        await batch.commit();
        console.log(`Committed batch of ${count} schedule entries.`);
        batch = db.batch();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${count} schedule entries.`);
    }

    console.log(`✓ Completed schedule entries migration: ${totalMigrated} entries written.`);
  } else {
    console.log(`- No schedule entries array found in main document (already migrated or empty).`);
  }

  // 2. Migrate activityLogs to subcollection apps/{orgId}/activityLogs/{logId}
  if (activityLogs.length > 0) {
    console.log(`Migrating ${activityLogs.length} activity logs to subcollection...`);
    const logsCol = db.collection(`apps/${targetOrgId}/activityLogs`);

    let batch = db.batch();
    let count = 0;
    let totalMigrated = 0;

    for (const log of activityLogs) {
      if (!log || !log.id) continue;
      const logRef = logsCol.doc(log.id);

      // Idempotent write
      batch.set(logRef, log, { merge: true });
      count++;
      totalMigrated++;

      if (count >= 400) {
        await batch.commit();
        console.log(`Committed batch of ${count} activity logs.`);
        batch = db.batch();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${count} activity logs.`);
    }

    console.log(`✓ Completed activity logs migration: ${totalMigrated} logs written.`);
  } else {
    console.log(`- No activity logs array found in main document (already migrated or empty).`);
  }

  // 3. Clean up legacy fields from main doc
  console.log(`Cleaning up legacy fields from apps/${targetOrgId}...`);
  await docRef.update({
    scheduleEntries: FieldValue.delete(),
    activityLogs: FieldValue.delete()
  });

  console.log(`✓ Main document cleaned up successfully.`);
  console.log(`=======================================================`);
  console.log(`Migration completed successfully!`);
  console.log(`=======================================================`);
}

// If run directly
runMigration().catch(err => {
  console.error("Migration error:", err);
  process.exit(1);
});
