import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import {
  READ_FLIP_ENTITY_FIELDS,
  PERIOD_SETTINGS_DOC_ID,
  compareField,
  comparePeriodSettings,
  type FieldCheck,
} from './subcollectionReads';

export interface MirrorVerifyReport {
  checkedAt: string;
  ok: boolean;
  fields: FieldCheck[];
  reads: number;
}

/**
 * Browser version of `migrate-to-subcollections.ts --verify-only`:
 * compares the arrays inside apps/{orgId} with the mirror subcollections. Read-only.
 * Costs one read per document (~800 for this school) — it is a button, not a poll.
 */
export async function verifyMirrorsInBrowser(orgId: string): Promise<MirrorVerifyReport> {
  const mainSnap = await getDoc(doc(db, 'apps', orgId));
  if (!mainSnap.exists()) throw new Error(`ไม่พบเอกสาร apps/${orgId}`);
  const main: any = mainSnap.data() || {};
  let reads = 1;

  const fields: FieldCheck[] = [];
  for (const field of [...READ_FLIP_ENTITY_FIELDS, 'users'] as const) {
    const snap = await getDocs(collection(db, 'apps', orgId, field));
    reads += Math.max(1, snap.size);
    fields.push(compareField(field, main[field], snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }))));
  }
  const ps = await getDoc(doc(db, 'apps', orgId, 'periodSettings', PERIOD_SETTINGS_DOC_ID));
  reads += 1;
  fields.push(comparePeriodSettings(main.periodSettings, ps.exists() ? (ps.data() as any)?.items : []));

  return { checkedAt: new Date().toISOString(), ok: fields.every((f) => f.ok), fields, reads };
}
