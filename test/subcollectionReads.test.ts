import { describe, it, expect } from 'vitest';
import {
  resolveEntityList,
  resolvePeriodSettings,
  READ_FLIP_ENTITY_FIELDS,
  PERIOD_SETTINGS_DOC_ID,
} from '../lib/subcollectionReads';
import { MIRRORED_ENTITY_FIELDS, PERIOD_SETTINGS_MIRROR_DOC_ID } from '../functions/src/orgWrites';

describe('read-flip constants stay in sync with the write side', () => {
  it('flip fields === mirrored fields minus scheduleEntries', () => {
    const expected = MIRRORED_ENTITY_FIELDS.filter((f) => f !== 'scheduleEntries');
    expect([...READ_FLIP_ENTITY_FIELDS].sort()).toEqual([...expected].sort());
  });
  it('periodSettings doc id matches', () => {
    expect(PERIOD_SETTINGS_DOC_ID).toBe(PERIOD_SETTINGS_MIRROR_DOC_ID);
  });
});

describe('resolveEntityList', () => {
  const T = (id: string, name = id) => ({ id, name });

  it('mirror not loaded (null) -> doc array', () => {
    const r = resolveEntityList(null, [T('a'), T('b')]);
    expect(r.items.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.report.source).toBe('doc');
  });

  it('mirror empty but doc has items (never backfilled) -> doc array', () => {
    const r = resolveEntityList([], [T('a')]);
    expect(r.report.source).toBe('doc');
    expect(r.items).toHaveLength(1);
  });

  it('both empty -> empty (a legitimately emptied list stays empty)', () => {
    const r = resolveEntityList([], []);
    expect(r.items).toEqual([]);
  });

  it('uses mirror CONTENT but the doc ORDER', () => {
    const r = resolveEntityList([T('c', 'C-new'), T('a', 'A-new'), T('b', 'B-new')], [T('a'), T('b'), T('c')]);
    expect(r.items.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.items.map((x) => x.name)).toEqual(['A-new', 'B-new', 'C-new']);
    expect(r.report).toEqual({ source: 'mirror', onlyInMirror: [], onlyInDoc: [] });
  });

  it('mirror is the truth for membership; divergence is reported', () => {
    const r = resolveEntityList([T('a'), T('z'), T('y')], [T('a'), T('gone')]);
    expect(r.items.map((x) => x.id)).toEqual(['a', 'y', 'z']); // extras sorted by id, after doc-ordered
    expect(r.report.onlyInMirror).toEqual(['y', 'z']);
    expect(r.report.onlyInDoc).toEqual(['gone']);
  });

  it('ignores malformed entries and non-array doc fields', () => {
    const r = resolveEntityList([T('a'), null as any, { name: 'no-id' } as any], 'oops');
    expect(r.items.map((x) => x.id)).toEqual(['a']);
  });

  it('does not mutate its inputs', () => {
    const mirror = [T('b'), T('a')];
    const doc = [T('a'), T('b')];
    resolveEntityList(mirror, doc);
    expect(mirror.map((x) => x.id)).toEqual(['b', 'a']);
    expect(doc.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('resolvePeriodSettings', () => {
  const P = (id: string) => ({ id, label: id });
  it('uses the mirror doc items in their stored order', () => {
    const r = resolvePeriodSettings({ items: [P('p2'), P('p1')] }, [P('p1'), P('p2')]);
    expect(r.source).toBe('mirror');
    expect(r.items.map((x) => x.id)).toEqual(['p2', 'p1']);
  });
  it('falls back to the doc array when the mirror doc is missing or empty', () => {
    expect(resolvePeriodSettings(null, [P('p1')]).source).toBe('doc');
    expect(resolvePeriodSettings({ items: [] }, [P('p1')]).source).toBe('doc');
  });
});
