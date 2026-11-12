/**
 * Shared plumbing for the analytics widgets: facility-day boundaries, the SQL time bucket and
 * the optional category filter.
 *
 * Event timestamps are ISO-UTC text. To count them on the FACILITY's calendar without a query
 * per day, SQL groups rows into 15-minute UTC buckets (every real timezone offset is a multiple
 * of 15 minutes) and `bucketDate` maps each bucket to its local date in TypeScript.
 */

import {
  addDays,
  daysBetween,
  localDateOf,
  startOfDayUtc,
} from "../../../shared/dates";
import type { AnalyticsRange } from "../../../shared/schemas/analytics";

const BUCKET_MINUTES = 15;

/** `[from 00:00, to+1 00:00)` in the facility timezone, as ISO-UTC strings. */
export interface RangeBounds extends AnalyticsRange {
  endUtc: string;
  startUtc: string;
  timezone: string;
}

export function boundsFor(
  range: AnalyticsRange,
  timezone: string
): RangeBounds {
  return {
    ...range,
    endUtc: startOfDayUtc(addDays(range.to, 1), timezone).toISOString(),
    startUtc: startOfDayUtc(range.from, timezone).toISOString(),
    timezone,
  };
}

/** SQL expression `YYYY-MM-DDTHH:MM` (UTC, floored to 15 minutes). `column` must be a trusted identifier. */
export function bucketSql(column: string): string {
  return `(substr(${column}, 1, 14) || printf('%02d', (CAST(substr(${column}, 15, 2) AS INTEGER) / ${BUCKET_MINUTES}) * ${BUCKET_MINUTES}))`;
}

/** The facility-local date a `bucketSql` bucket falls on. */
export function bucketDate(bucket: string, timezone: string): string {
  return localDateOf(`${bucket}:00.000Z`, timezone);
}

/** Every date of the range, in order. */
export function listDays(range: AnalyticsRange): string[] {
  return Array.from({ length: range.days }, (_, index) =>
    addDays(range.from, index)
  );
}

/** Position of `date` in the range, or -1 when it falls outside. */
export function dayIndex(range: AnalyticsRange, date: string): number {
  const index = daysBetween(range.from, date);
  return index >= 0 && index < range.days ? index : -1;
}

export interface CategoryFilter {
  params: string[];
  sql: string;
}

/** ` AND i.category_id = ?` when a category is selected. The query must alias `items` as `i`. */
export function categoryFilter(categoryId: string | null): CategoryFilter {
  return categoryId
    ? { params: [categoryId], sql: " AND i.category_id = ?" }
    : { params: [], sql: "" };
}
