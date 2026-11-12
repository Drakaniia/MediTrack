/** "Expiring this month": batches holding stock that expire in one facility calendar month. */

import { monthRange } from "../../../shared/dates";
import { assessExpiry } from "../../../shared/expiry";
import {
  DASHBOARD_LIST_LIMIT,
  type ExpiringBatchDto,
  type ExpiringThisMonthDto,
} from "../../../shared/schemas/dashboard";
import type { D1DatabaseLike } from "../../env";
import type { ReadContext } from "../inventory/read-models";
import { LIVE_STOCK_BATCH } from "./stock-totals";

const FROM_LIVE_BATCHES = `FROM batches b JOIN items i ON i.id = b.item_id AND i.deleted_at IS NULL WHERE ${LIVE_STOCK_BATCH} AND b.expiry >= ? AND b.expiry < ?`;

interface ExpiringRow {
  batch_number: string;
  expiry: string;
  id: string;
  item_id: string;
  item_name: string;
  item_strength: string;
  qty: number;
  unit: string;
}

interface TotalRow {
  batches: number;
  units: number | null;
}

function displayName(name: string, strength: string): string {
  const trimmed = strength.trim();
  return trimmed === "" ? name : `${name} ${trimmed}`;
}

function toExpiringBatch(row: ExpiringRow, rc: ReadContext): ExpiringBatchDto {
  const { daysUntil, expiryClass } = assessExpiry(
    row.expiry,
    rc.today,
    rc.thresholds
  );
  return {
    batchId: row.id,
    batchNumber: row.batch_number,
    // An expiry date is never null here, so neither is the day count.
    daysUntil: daysUntil ?? 0,
    expiry: row.expiry,
    expiryClass,
    itemId: row.item_id,
    itemName: displayName(row.item_name, row.item_strength),
    qty: row.qty,
    unit: row.unit,
  };
}

export async function loadExpiringInMonth(
  db: D1DatabaseLike,
  rc: ReadContext,
  month: string
): Promise<ExpiringThisMonthDto> {
  const { start, endExclusive } = monthRange(month);
  const [totals, list] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS batches, COALESCE(SUM(b.qty), 0) AS units ${FROM_LIVE_BATCHES}`
      )
      .bind(start, endExclusive)
      .first<TotalRow>(),
    db
      .prepare(
        `SELECT b.id, b.batch_number, b.expiry, b.qty, b.item_id, i.name AS item_name, i.strength AS item_strength, i.unit ${FROM_LIVE_BATCHES} ORDER BY b.expiry, b.received_on, b.batch_number_lower, b.id LIMIT ?`
      )
      .bind(start, endExclusive, DASHBOARD_LIST_LIMIT)
      .all<ExpiringRow>(),
  ]);
  return {
    batches: totals?.batches ?? 0,
    items: list.results.map((row) => toExpiringBatch(row, rc)),
    month,
    units: totals?.units ?? 0,
  };
}
