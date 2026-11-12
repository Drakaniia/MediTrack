/**
 * `GET /api/analytics` (spec §7.7). A constant number of statements whatever the data size:
 * settings, dispensed ledger rows, movement buckets, expiry buckets, the two low-stock reads and
 * the two request/dispensing buckets.
 */

import {
  type AnalyticsDto,
  type AnalyticsQuery,
  resolveAnalyticsRange,
} from "../../../shared/schemas/analytics";
import type { D1DatabaseLike } from "../../env";
import { HttpError } from "../../http";
import { readContextFor } from "../inventory/read-models";
import { loadDispensedVsRequested } from "./dispensed-vs-requested";
import { loadDispensedWidgets } from "./dispensed-usage";
import { loadExpiryTimeline } from "./expiry-timeline";
import { loadLowStockTrend } from "./low-stock-trend";
import { boundsFor } from "./range";
import { loadStockMovement } from "./stock-movement";

export interface AnalyticsInput {
  now: Date;
  query: AnalyticsQuery;
}

export async function loadAnalytics(
  db: D1DatabaseLike,
  input: AnalyticsInput
): Promise<AnalyticsDto> {
  const rc = await readContextFor(db, input.now);
  const resolved = resolveAnalyticsRange(input.query, rc.today);
  if (!resolved.ok) {
    throw new HttpError("validation_error", resolved.message, {
      issues: [{ message: resolved.message, path: "from" }],
    });
  }
  const bounds = boundsFor(resolved.range, rc.timezone);
  const categoryId = input.query.categoryId ?? null;

  const [
    dispensed,
    stockMovement,
    expiryTimeline,
    lowStockTrend,
    dispensedVsRequested,
  ] = await Promise.all([
    loadDispensedWidgets(db, bounds, categoryId),
    loadStockMovement(db, bounds, categoryId),
    loadExpiryTimeline(db, rc.today, rc.thresholds, categoryId),
    loadLowStockTrend(db, bounds, categoryId),
    loadDispensedVsRequested(db, bounds, categoryId),
  ]);

  return {
    categoryId,
    dispensedVsRequested,
    expiryTimeline,
    generatedAt: input.now.toISOString(),
    lowStockTrend,
    range: resolved.range,
    stockMovement,
    thresholds: rc.thresholds,
    timezone: rc.timezone,
    today: rc.today,
    topDispensed: dispensed.topDispensed,
    usage: dispensed.usage,
  };
}
