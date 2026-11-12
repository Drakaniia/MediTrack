/** Month activity (analytics roles only): units dispensed, units received, disposals. */

import { utcRangeForMonth } from "../../../shared/dates";
import type { DashboardActivityDto } from "../../../shared/schemas/dashboard";
import type { D1DatabaseLike } from "../../env";

interface ActivityRow {
  disposal_count: number;
  disposal_units: number;
  dispensed: number;
  received: number;
}

const ACTIVITY_SQL = `SELECT
  (SELECT COALESCE(SUM(qty), 0) FROM dispensing_records WHERE undone_at IS NULL AND dispensed_at >= ? AND dispensed_at < ?) AS dispensed,
  (SELECT COALESCE(SUM(qty_delta), 0) FROM stock_movements WHERE kind = 'receive' AND at >= ? AND at < ?) AS received,
  (SELECT COUNT(*) FROM disposals WHERE disposed_at >= ? AND disposed_at < ?) AS disposal_count,
  (SELECT COALESCE(SUM(qty), 0) FROM disposals WHERE disposed_at >= ? AND disposed_at < ?) AS disposal_units`;

/** Event timestamps are read on the facility's calendar month, not UTC's. */
export async function loadActivity(
  db: D1DatabaseLike,
  month: string,
  timezone: string
): Promise<DashboardActivityDto> {
  const { startUtc, endUtc } = utcRangeForMonth(month, timezone);
  const row = await db
    .prepare(ACTIVITY_SQL)
    .bind(
      startUtc,
      endUtc,
      startUtc,
      endUtc,
      startUtc,
      endUtc,
      startUtc,
      endUtc
    )
    .first<ActivityRow>();
  return {
    disposals: {
      count: row?.disposal_count ?? 0,
      units: row?.disposal_units ?? 0,
    },
    month,
    unitsDispensed: row?.dispensed ?? 0,
    unitsReceived: row?.received ?? 0,
  };
}
