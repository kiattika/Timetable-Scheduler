import { describe, it, expect } from 'vitest';
import { bangkokDateKey, bangkokMidnightMs, makeDailyBuckets, dateKeyForPoint } from '../functions/src/usageBuckets';
import { splitBeforeAfter } from '../utils/telemetry';

describe('Bangkok calendar-day bucketing', () => {
  it('uses UTC+7 for the date key', () => {
    // 2026-10-15 17:30 UTC = 2026-10-16 00:30 Bangkok
    expect(bangkokDateKey(Date.UTC(2026, 9, 15, 17, 30))).toBe('2026-10-16');
    expect(bangkokDateKey(Date.UTC(2026, 9, 15, 16, 59))).toBe('2026-10-15');
  });
  it('finds Bangkok midnight', () => {
    expect(bangkokMidnightMs(Date.UTC(2026, 9, 16, 9, 49))).toBe(Date.UTC(2026, 9, 15, 17, 0));
  });
  it('makes N consecutive day buckets ending today', () => {
    const b = makeDailyBuckets(Date.UTC(2026, 9, 16, 9, 49), 3);
    expect(Object.keys(b)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
  });
  it('handles month boundaries', () => {
    const b = makeDailyBuckets(Date.UTC(2026, 10, 1, 3, 0), 3);
    expect(Object.keys(b)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
  it('assigns an hourly bucket by its midpoint', () => {
    // bucket 16:47Z-1h .. 16:47Z  -> mostly before Bangkok midnight (17:00Z) -> still the 15th
    const end = Date.UTC(2026, 9, 15, 16, 47) / 1000;
    expect(dateKeyForPoint(end)).toBe('2026-10-15');
    // bucket 17:20Z-1h .. 17:20Z -> midpoint 16:50Z -> 15th ; 17:40Z -> midpoint 17:10Z -> 16th
    expect(dateKeyForPoint(Date.UTC(2026, 9, 15, 17, 20) / 1000)).toBe('2026-10-15');
    expect(dateKeyForPoint(Date.UTC(2026, 9, 15, 17, 40) / 1000)).toBe('2026-10-16');
  });
});

describe('splitBeforeAfter', () => {
  const rows = [
    { date: '2026-10-10', reads: 100, writes: 10, deletes: 0 },
    { date: '2026-10-11', reads: 300, writes: 30, deletes: 0 },
    { date: '2026-10-12', reads: 1000, writes: 20, deletes: 5 },
    { date: '2026-10-13', reads: 3000, writes: 40, deletes: 5 },
    { date: '2026-10-14', reads: 50, writes: 1, deletes: 0 },
  ];
  it('splits at the cutover day (cutover day counts as after)', () => {
    const r = splitBeforeAfter(rows, '2026-10-12', '2026-10-14');
    expect(r.before.days).toBe(2);
    expect(r.before.avgReads).toBe(200);
    expect(r.after.days).toBe(2); // 12, 13 (14 is today, excluded)
    expect(r.after.avgReads).toBe(2000);
    expect(r.deltaPercent.reads).toBe(900);
  });
  it('falls back to today when it is the only day in a group', () => {
    const r = splitBeforeAfter(rows, '2026-10-14', '2026-10-14');
    expect(r.after.partialOnly).toBe(true);
    expect(r.after.avgReads).toBe(50);
    expect(r.deltaPercent.reads).toBeGreaterThan(-100); // computed, not null
  });
  it('gives null delta when a side is empty or before is zero', () => {
    expect(splitBeforeAfter(rows, '2026-10-01', '2026-10-14').deltaPercent.reads).toBeNull();
    const z = splitBeforeAfter([{ date: 'a', reads: 0, writes: 0, deletes: 0 }, { date: 'b', reads: 5, writes: 0, deletes: 0 }], 'b');
    expect(z.deltaPercent.reads).toBeNull();
  });
});
