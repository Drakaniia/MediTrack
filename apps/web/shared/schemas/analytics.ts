/**
 * ANALYTICS slice contract: `GET /api/analytics?from=&to=&categoryId=` (spec §7.7).
 *
 * `from` / `to` are facility-local calendar dates (inclusive). Every series is zero-filled over
 * the whole range, so the client never has to invent missing days.
 */

import { z } from "zod";

import { addDays, daysBetween, isIsoDate } from "../dates";
import type { ExpiryClass, ExpiryThresholds } from "../expiry";

/** Default window: today and the 29 days before it. */
export const ANALYTICS_DEFAULT_DAYS = 30;
/** Longest range the endpoint accepts (inclusive day count). */
export const ANALYTICS_MAX_DAYS = 366;
/** Rows in the "top dispensed" widget. */
export const TOP_DISPENSED_LIMIT = 10;
/** Batches listed per top-dispensed item. */
export const TOP_DISPENSED_BATCH_LIMIT = 20;
/** Months in the expiry timeline, starting with the facility's current month. */
export const EXPIRY_TIMELINE_MONTHS = 12;
/** Up to this many days the dispensed-vs-requested widget is bucketed by week, beyond it by month. */
export const WEEKLY_BUCKET_MAX_DAYS = 62;
/** Name shown for items without a category. */
export const UNCATEGORIZED_LABEL = "Uncategorized";

export const analyticsQuerySchema = z.object({
  categoryId: z
    .string()
    .trim()
    .min(1)
    .optional(),
  from: z
    .string()
    .refine(isIsoDate, { error: "Use YYYY-MM-DD." })
    .optional(),
  to: z
    .string()
    .refine(isIsoDate, { error: "Use YYYY-MM-DD." })
    .optional(),
});
export type AnalyticsQuery = z.output<typeof analyticsQuerySchema>;

export interface AnalyticsRange {
  /** Inclusive day count. */
  days: number;
  /** `YYYY-MM-DD`. */
  from: string;
  /** `YYYY-MM-DD`. */
  to: string;
}

export type AnalyticsRangeResult =
  | { ok: true; range: AnalyticsRange }
  | { message: string; ok: false };

/**
 * Applies the defaults (last 30 days ending today) and the rules: `from ≤ to`, at most
 * `ANALYTICS_MAX_DAYS` days. A single bound given alone anchors the other one.
 */
export function resolveAnalyticsRange(
  query: Pick<AnalyticsQuery, "from" | "to">,
  today: string
): AnalyticsRangeResult {
  const span = ANALYTICS_DEFAULT_DAYS - 1;
  let resolvedTo = query.to ?? today;
  if (!query.to && query.from) {
    resolvedTo = addDays(query.from, span);
  }
  const resolvedFrom = query.from ?? addDays(resolvedTo, -span);
  if (resolvedFrom > resolvedTo) {
    return {
      message: "The start date must not be after the end date.",
      ok: false,
    };
  }
  const days = daysBetween(resolvedFrom, resolvedTo) + 1;
  if (days > ANALYTICS_MAX_DAYS) {
    return {
      message: `The date range is limited to ${ANALYTICS_MAX_DAYS} days.`,
      ok: false,
    };
  }
  return { ok: true, range: { days, from: resolvedFrom, to: resolvedTo } };
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface UsageSliceDto {
  /** Null = items without a category. */
  categoryId: string | null;
  name: string;
  units: number;
}

export interface UsageWidgetDto {
  /** Largest first. Categories with nothing dispensed are left out. */
  slices: UsageSliceDto[];
  totalUnits: number;
}

export interface TopDispensedBatchDto {
  batchNumber: string;
  units: number;
}

export interface TopDispensedItemDto {
  /** Per-batch split, largest first (at most `TOP_DISPENSED_BATCH_LIMIT`). */
  batches: TopDispensedBatchDto[];
  /** Number of distinct batches dispensed from. */
  batchCount: number;
  /** Null when the item was purged; `name` is then the ledger snapshot. */
  itemId: string | null;
  name: string;
  unit: string;
  units: number;
}

export interface ClassCountDto {
  batches: number;
  units: number;
}

export type ClassSplitDto = Record<ExpiryClass, ClassCountDto>;

export interface ExpiryTimelineMonthDto extends ClassCountDto {
  classes: ClassSplitDto;
  /** `YYYY-MM`, facility calendar. */
  month: string;
}

export interface ExpiryTimelineDto {
  /** Stock that expired before the first month of the window and is still on the shelf. */
  earlier: ClassCountDto;
  /** Exactly `EXPIRY_TIMELINE_MONTHS` entries, zero-filled. */
  months: ExpiryTimelineMonthDto[];
}

export interface StockMovementDayDto {
  /** Net of `adjust` movements (signed). */
  adjusted: number;
  /** `YYYY-MM-DD`, facility calendar. */
  date: string;
  /** Net of `dispense` and `undo_dispense`, so an undone quick deduct nets out. */
  dispensed: number;
  disposed: number;
  received: number;
}

export interface StockMovementDto {
  days: StockMovementDayDto[];
}

export interface LowStockTrendDayDto {
  date: string;
  /** Items with a threshold and nothing available at the end of the day (subset of `underThreshold`). */
  out: number;
  /** Items with a threshold whose available stock was below it at the end of the day. */
  underThreshold: number;
}

export interface LowStockTrendDto {
  days: LowStockTrendDayDto[];
  /** Items with a threshold above zero (the population being counted). */
  itemsTracked: number;
}

export type DispensedRequestedGranularity = "month" | "week";

export interface DispensedRequestedBucketDto {
  /** Queue hand-overs that were not undone. */
  dispensed: number;
  /** First day of the bucket inside the range, `YYYY-MM-DD`. */
  from: string;
  /** Last day of the bucket inside the range. */
  to: string;
  /** Queue requests submitted in the bucket, cancelled ones excluded (denied ones count). */
  requested: number;
}

export interface DispensedVsRequestedDto {
  buckets: DispensedRequestedBucketDto[];
  granularity: DispensedRequestedGranularity;
}

export interface AnalyticsDto {
  categoryId: string | null;
  dispensedVsRequested: DispensedVsRequestedDto;
  expiryTimeline: ExpiryTimelineDto;
  generatedAt: string;
  lowStockTrend: LowStockTrendDto;
  range: AnalyticsRange;
  stockMovement: StockMovementDto;
  thresholds: ExpiryThresholds;
  timezone: string;
  today: string;
  topDispensed: TopDispensedItemDto[];
  usage: UsageWidgetDto;
}
