/**
 * "Dispensed vs requested": per week (ranges up to 62 days) or per calendar month, clipped to the
 * range. Requested = queue requests submitted in the bucket (cancelled ones withdrawn, denied
 * ones still count); dispensed = queue hand-overs in the bucket that were not undone.
 */

import { addDays, monthOf } from "../../../shared/dates";
import {
  type AnalyticsRange,
  type DispensedRequestedBucketDto,
  type DispensedRequestedGranularity,
  type DispensedVsRequestedDto,
  WEEKLY_BUCKET_MAX_DAYS,
} from "../../../shared/schemas/analytics";
import type { D1DatabaseLike } from "../../env";
import {
  bucketDate,
  bucketSql,
  categoryFilter,
  dayIndex,
  listDays,
  type RangeBounds,
} from "./range";

const DAYS_PER_WEEK = 7;
const MONDAY_OFFSET = 6;

function granularityFor(days: number): DispensedRequestedGranularity {
  return days <= WEEKLY_BUCKET_MAX_DAYS ? "week" : "month";
}

/** Key that is equal for every date of the same bucket. */
function bucketKey(
  date: string,
  granularity: DispensedRequestedGranularity
): string {
  if (granularity === "month") {
    return monthOf(date);
  }
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, -((weekday + MONDAY_OFFSET) % DAYS_PER_WEEK));
}

/** Empty buckets covering the range, plus a date → bucket index lookup per day. */
export function planBuckets(range: AnalyticsRange): {
  buckets: DispensedRequestedBucketDto[];
  granularity: DispensedRequestedGranularity;
  indexByDay: number[];
} {
  const granularity = granularityFor(range.days);
  const buckets: DispensedRequestedBucketDto[] = [];
  const indexByDay: number[] = [];
  let lastKey = "";
  for (const date of listDays(range)) {
    const key = bucketKey(date, granularity);
    if (key !== lastKey) {
      buckets.push({ dispensed: 0, from: date, requested: 0, to: date });
      lastKey = key;
    }
    const bucket = buckets.at(-1);
    if (bucket) {
      bucket.to = date;
    }
    indexByDay.push(buckets.length - 1);
  }
  return { buckets, granularity, indexByDay };
}

interface QtyRow {
  bucket: string;
  qty: number;
}

function foldInto(
  rows: readonly QtyRow[],
  field: "dispensed" | "requested",
  plan: ReturnType<typeof planBuckets>,
  bounds: RangeBounds
): void {
  for (const row of rows) {
    const index = dayIndex(bounds, bucketDate(row.bucket, bounds.timezone));
    if (index >= 0) {
      plan.buckets[plan.indexByDay[index]][field] += row.qty;
    }
  }
}

export function buildDispensedVsRequested(
  requested: readonly QtyRow[],
  dispensed: readonly QtyRow[],
  bounds: RangeBounds
): DispensedVsRequestedDto {
  const plan = planBuckets(bounds);
  foldInto(requested, "requested", plan, bounds);
  foldInto(dispensed, "dispensed", plan, bounds);
  return { buckets: plan.buckets, granularity: plan.granularity };
}

const REQUESTED_SQL = `SELECT ${bucketSql("r.submitted_at")} AS bucket, SUM(r.qty) AS qty
  FROM requests r LEFT JOIN items i ON i.id = r.item_id
  WHERE r.source = 'queue' AND r.status <> 'cancelled' AND r.submitted_at >= ? AND r.submitted_at < ?`;

const DISPENSED_SQL = `SELECT ${bucketSql("d.dispensed_at")} AS bucket, SUM(d.qty) AS qty
  FROM dispensing_records d LEFT JOIN items i ON i.id = d.item_id
  WHERE d.source = 'queue' AND d.undone_at IS NULL AND d.dispensed_at >= ? AND d.dispensed_at < ?`;

export async function loadDispensedVsRequested(
  db: D1DatabaseLike,
  bounds: RangeBounds,
  categoryId: string | null
): Promise<DispensedVsRequestedDto> {
  const filter = categoryFilter(categoryId);
  const params = [bounds.startUtc, bounds.endUtc, ...filter.params];
  const [requested, dispensed] = await Promise.all([
    db
      .prepare(`${REQUESTED_SQL}${filter.sql} GROUP BY bucket`)
      .bind(...params)
      .all<QtyRow>(),
    db
      .prepare(`${DISPENSED_SQL}${filter.sql} GROUP BY bucket`)
      .bind(...params)
      .all<QtyRow>(),
  ]);
  return buildDispensedVsRequested(requested.results, dispensed.results, bounds);
}

