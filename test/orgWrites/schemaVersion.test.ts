/**
 * Phase 0 — `organizationSettings.schemaVersion` migration-on-read.
 *
 * The subcollection migration needs a way for a client to tell old-shape
 * (monolithic doc) data from new-shape data during the dual-write transition.
 * Phase 0 only introduces the field + a read-time default; no dual-write yet.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeLoadedOrganizationSettings,
  CURRENT_ORG_SCHEMA_VERSION,
} from '../../lib/normalizeAppData';
import { canonicalKey } from '../../lib/orgChangesClient';

describe('normalizeLoadedOrganizationSettings — schemaVersion default', () => {
  it('stamps schemaVersion = 1 onto settings that predate the field', () => {
    const out = normalizeLoadedOrganizationSettings({ name: 'School', semester: '1' });
    expect(out).toEqual({ name: 'School', semester: '1', schemaVersion: 1 });
    expect(CURRENT_ORG_SCHEMA_VERSION).toBe(1);
  });

  it('leaves an existing valid schemaVersion untouched (does not downgrade a future shape)', () => {
    const future = { name: 'School', schemaVersion: 2 };
    expect(normalizeLoadedOrganizationSettings(future)).toBe(future);
  });

  it('repairs a non-positive / non-integer schemaVersion', () => {
    expect(normalizeLoadedOrganizationSettings({ name: 'S', schemaVersion: 0 }).schemaVersion).toBe(1);
    expect(normalizeLoadedOrganizationSettings({ name: 'S', schemaVersion: -3 }).schemaVersion).toBe(1);
    expect(normalizeLoadedOrganizationSettings({ name: 'S', schemaVersion: 1.5 }).schemaVersion).toBe(1);
    expect(normalizeLoadedOrganizationSettings({ name: 'S', schemaVersion: 'x' as any }).schemaVersion).toBe(1);
  });

  it('passes null / undefined through untouched (brand-new org has no settings to migrate)', () => {
    expect(normalizeLoadedOrganizationSettings(null)).toBeNull();
    expect(normalizeLoadedOrganizationSettings(undefined)).toBeNull();
  });

  it('is idempotent', () => {
    const once = normalizeLoadedOrganizationSettings({ name: 'S' });
    expect(normalizeLoadedOrganizationSettings(once)).toEqual(once);
  });

  it('does not create a spurious diff: two loads of the same server settings compare equal', () => {
    // server doc has no schemaVersion yet; both the baseline and the current
    // in-memory copy go through the same normaliser, so change-detection is quiet.
    const fromServer = { name: 'School', semester: '2', academicYear: '2569' };
    const baseline = normalizeLoadedOrganizationSettings({ ...fromServer });
    const current = normalizeLoadedOrganizationSettings({ ...fromServer });
    expect(canonicalKey(baseline)).toBe(canonicalKey(current));
  });
});
