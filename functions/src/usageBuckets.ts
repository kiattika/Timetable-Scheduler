/**
 * Pure helpers for turning Cloud Monitoring hourly points into Bangkok calendar-day buckets.
 * (Kept free of firebase imports so it can be unit-tested.)
 */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_S = 3600;

/** YYYY-MM-DD of the given instant in Asia/Bangkok (UTC+7, no DST). */
export function bangkokDateKey(ms: number): string {
  const d = new Date(ms + BANGKOK_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** UTC ms of 00:00 Bangkok time of the day that contains `ms`. */
export function bangkokMidnightMs(ms: number): number {
  return Math.floor((ms + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS;
}

export interface DailyBucket { date: string; reads: number; writes: number; deletes: number }

/** Empty buckets for the last `days` Bangkok calendar days, today included, oldest first. */
export function makeDailyBuckets(nowMs: number, days: number): Record<string, DailyBucket> {
  const todayStart = bangkokMidnightMs(nowMs);
  const out: Record<string, DailyBucket> = {};
  for (let i = days - 1; i >= 0; i--) {
    const date = bangkokDateKey(todayStart - i * DAY_MS + 12 * 60 * 60 * 1000);
    out[date] = { date, reads: 0, writes: 0, deletes: 0 };
  }
  return out;
}

/**
 * Assign an hourly point (ALIGN_SUM over `alignmentSeconds`, ending at `endSeconds`) to a day.
 * The bucket's MIDPOINT decides the day, so a bucket that straddles midnight is never pushed a whole
 * hour into the wrong day (the query end time is "now", so buckets are not on the hour).
 */
export function dateKeyForPoint(endSeconds: number, alignmentSeconds: number = HOUR_S): string {
  return bangkokDateKey((endSeconds - alignmentSeconds / 2) * 1000);
}

/**
 * Decide whether a Monitoring time series belongs to the wanted Firestore database, from the
 * series' own monitored-resource labels. (Filtering inside the Monitoring filter string is brittle
 * — the label/resource combination differs between metric versions and an invalid one makes the
 * whole query fail with INVALID_ARGUMENT — so the filtering is done here instead.)
 *   'match'     -> database_id equals `wanted`
 *   'other'     -> a different database
 *   'unlabeled' -> the series carries no database_id at all (cannot tell; caller keeps it)
 */
export function classifySeriesDatabase(
  labels: Record<string, string> | null | undefined,
  wanted: string,
): 'match' | 'other' | 'unlabeled' {
  const id = labels && typeof labels === 'object' ? labels.database_id : undefined;
  if (typeof id !== 'string' || id === '') return 'unlabeled';
  return id === wanted ? 'match' : 'other';
}
