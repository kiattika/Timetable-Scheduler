/**
 * Logo / Garuda emblem moved off the 1 MiB main document into apps/{orgId}/branding/images.
 * Pure tests for the merge split, the branding-doc write plan, the client merge and the client diff.
 */
import { describe, it, expect } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { mergeOrgChanges, splitBranding, applyBrandingPlan } from '../../functions/src/orgWrites';
import { mergeBrandingIntoSettings } from '../../lib/normalizeAppData';
import { computeOrgChanges } from '../../lib/orgChangesClient';

const LOGO = 'data:image/png;base64,AAAA';
const EMBLEM = 'data:image/png;base64,BBBB';

/** Minimal fake of `appDocRef.collection(..).doc(..)` get/set(merge). */
const fakeAppDoc = (initial: Record<string, any> | null) => {
  let data: Record<string, any> | null = initial ? { ...initial } : null;
  const writes: Record<string, any>[] = [];
  const ref: any = {
    collection: (c: string) => ({
      doc: (d: string) => {
        expect(`${c}/${d}`).toBe('branding/images');
        return {
          get: async () => ({ exists: data !== null, data: () => data }),
          set: async (w: Record<string, any>) => {
            writes.push(w);
            const next = { ...(data || {}) };
            for (const [k, v] of Object.entries(w)) {
              if (v instanceof FieldValue) delete next[k];
              else next[k] = v;
            }
            data = next;
          },
        };
      },
    }),
  };
  return { ref, writes, current: () => data };
};

describe('splitBranding', () => {
  it('separates image keys and keeps null / empty-string deletes', () => {
    const { rest, branding } = splitBranding({ name: 'UTD', logoUrl: LOGO, emblemUrl: '', isLocked: true, x: undefined });
    expect(rest).toEqual({ name: 'UTD', isLocked: true });
    expect(branding).toEqual({ logoUrl: LOGO, emblemUrl: '' });
  });
});

describe('mergeOrgChanges — branding never lands on the main doc', () => {
  it('a new logo from the client goes to the branding plan, not to updates', () => {
    const server = { organizationSettings: { name: 'UTD' } };
    const { updates, branding } = mergeOrgChanges(server, { organizationSettings: { set: { logoUrl: LOGO } } }, 'admin');
    expect(updates.organizationSettings).toBeUndefined(); // nothing else changed
    expect(branding.set).toEqual({ logoUrl: LOGO });
    expect(branding.legacy).toEqual({});
  });

  it('legacy images on the main doc are listed and stripped even when the change is unrelated', () => {
    const server = { organizationSettings: { name: 'UTD', logoUrl: LOGO, emblemUrl: EMBLEM }, teachers: [] };
    const { updates, branding } = mergeOrgChanges(server, { teachers: { upsert: [{ id: 't1', name: 'A' }] } }, 'manager');
    expect(updates.organizationSettings).toEqual({ name: 'UTD' });
    expect(branding.legacy).toEqual({ logoUrl: LOGO, emblemUrl: EMBLEM });
  });

  it('other settings still merge and the isLocked admin check still applies', () => {
    const server = { organizationSettings: { name: 'UTD', isLocked: true, logoUrl: LOGO } };
    const { updates } = mergeOrgChanges(server, { organizationSettings: { set: { semester: '2' } } }, 'manager');
    expect(updates.organizationSettings).toEqual({ name: 'UTD', isLocked: true, semester: '2' });
    expect(() => mergeOrgChanges(server, { organizationSettings: { set: { isLocked: false } } }, 'manager')).toThrow();
  });
});

describe('applyBrandingPlan', () => {
  it('copies legacy images only when the branding doc lacks them', async () => {
    const f = fakeAppDoc({ logoUrl: 'data:image/png;base64,NEWER' });
    await applyBrandingPlan(f.ref, { set: {}, legacy: { logoUrl: LOGO, emblemUrl: EMBLEM } });
    expect(f.current()).toEqual({ logoUrl: 'data:image/png;base64,NEWER', emblemUrl: EMBLEM });
  });

  it('explicit set wins over legacy, empty string deletes, and a repeat is a no-op', async () => {
    const f = fakeAppDoc({ logoUrl: LOGO, emblemUrl: EMBLEM });
    await applyBrandingPlan(f.ref, { set: { logoUrl: 'data:image/png;base64,CCCC', emblemUrl: '' }, legacy: { logoUrl: LOGO } });
    expect(f.current()).toEqual({ logoUrl: 'data:image/png;base64,CCCC' });
    const n = await applyBrandingPlan(f.ref, { set: { logoUrl: 'data:image/png;base64,CCCC', emblemUrl: '' }, legacy: {} });
    expect(n).toBe(0);
  });

  it('does nothing (not even a read) without branding work', async () => {
    const f = fakeAppDoc(null);
    expect(await applyBrandingPlan(f.ref, { set: {}, legacy: {} })).toBe(0);
    expect(f.writes).toHaveLength(0);
  });
});

describe('client side', () => {
  it('mergeBrandingIntoSettings: branding doc wins, legacy kept when the doc lacks a key', () => {
    expect(mergeBrandingIntoSettings({ name: 'UTD', emblemUrl: EMBLEM }, { logoUrl: LOGO }))
      .toEqual({ name: 'UTD', logoUrl: LOGO, emblemUrl: EMBLEM });
    expect(mergeBrandingIntoSettings({ name: 'UTD' }, null)).toEqual({ name: 'UTD' });
    expect(mergeBrandingIntoSettings(null, { logoUrl: LOGO })).toBeNull();
  });

  it('computeOrgChanges: a merely missing image is never sent; an explicit "" removal is', () => {
    const baseline = { organizationSettings: { name: 'UTD', logoUrl: LOGO } };
    expect(computeOrgChanges(baseline, { organizationSettings: { name: 'UTD' } }).changes.organizationSettings).toBeUndefined();
    expect(computeOrgChanges(baseline, { organizationSettings: { name: 'UTD', logoUrl: undefined } }).changes.organizationSettings).toBeUndefined();
    expect(computeOrgChanges(baseline, { organizationSettings: { name: 'UTD', logoUrl: '' } }).changes.organizationSettings)
      .toEqual({ set: { logoUrl: '' } });
  });
});

describe('applyBrandingPlan — restore keeps images the backup lacks', () => {
  it('a legacy main-doc image survives a restore whose backup has no images', async () => {
    const f = fakeAppDoc(null);
    await applyBrandingPlan(f.ref, { set: {}, legacy: { emblemUrl: EMBLEM } });
    expect(f.current()).toEqual({ emblemUrl: EMBLEM });
  });
});
