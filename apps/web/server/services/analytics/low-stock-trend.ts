/**
 * "Low-stock trend": how many tracked items were below their threshold at the END of each
 * facility-local day.
 *
 * Reconstruction (no daily snapshots are stored): for every batch the quantity at the end of day
 * D is `current qty − Σ ledger movements dated after D`, and an item's available stock on D is
 * the sum over its batches that were not yet expired on D (`expiry IS NULL OR expiry ≥ D`).
 * The count then uses the same `classifyLowStock` rule as the live low-stock list.
 *
 * Honest limits: only live items and live batches are walked, so stock that was trashed or
 * purged is invisible for past days, and a ledger gap (e.g. batches seeded without a `receive`
 * movement) shows up as a wrong quantity before the first movement. Quantities are clamped at 0.
 */

import { classifyLowStock } from "../../../shared/low-stock";
import type {
  LowStockTrendDayDto,
  LowStockTrendDto,
} from "../../../shared/schemas/analytics";
import type { D1DatabaseLike } from "../../env";
import {
  bucketDate,
  bucketSql,
  categoryFilter,
  listDays,
  type RangeBounds,
} from "./range";

export interface TrendBatch {
  /** Current quantity. */
  qty: number;
  /** Per facility date: net quantity change from the ledger. */
  deltas: ReadonlyMap<string, number>;
  expiry: string | null;
  itemId: string;
}

export interface TrendInput {
  batches: readonly TrendBatch[];
  /** Dates to report, ascending. */
  days: readonly string[];
  /** Item id → `low_stock_threshold` (only items above 0 are tracked). */
  thresholds: ReadonlyMap<string, number>;
}

function deltaAfter(
  deltas: ReadonlyMap<string, number>,
  lastDay: string
): number {
  let total = 0;
  for (const [date, delta] of deltas) {
    if (date > lastDay) {
      total += delta;
    }
  }
  return total;
}

/** Adds one batch's end-of-day availability to `availability` (indexed like `days`). */
function accumulateBatch(
  batch: TrendBatch,
  days: readonly string[],
  availability: number[]
): void {
  let quantity = batch.qty - deltaAfter(batch.deltas, days.at(-1) ?? "");
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const date = days[index];
    const usable = batch.expiry === null || batch.expiry >= date;
    if (usable) {
      availability[index] += Math.max(0, quantity);
    }
    quantity -= batch.deltas.get(date) ?? 0;
  }
}

export function reconstructLowStock(input: TrendInput): LowStockTrendDto {
  const { days, thresholds } = input;
  const perItem = new Map<string, number[]>();
  for (const itemId of thresholds.keys()) {
    perItem.set(
      itemId,
      days.map(() => 0)
    );
  }
  for (const batch of input.batches) {
    const availability = perItem.get(batch.itemId);
    if (availability) {
      accumulateBatch(batch, days, availability);
    }
  }
  const series: LowStockTrendDayDto[] = days.map((date) => ({
    date,
    out: 0,
    underThreshold: 0,
  }));
  for (const [itemId, availability] of perItem) {
    const threshold = thresholds.get(itemId) ?? 0;
    for (const [index, available] of availability.entries()) {
      const status = classifyLowStock({ available, threshold });
      if (status !== "in_stock") {
        series[index].underThreshold += 1;
      }
      if (status === "out") {
        series[index].out += 1;
      }
    }
  }
  return { days: series, itemsTracked: thresholds.size };
}

interface ItemBatchRow {
  batch_id: string | null;
  expiry: string | null;
  item_id: string;
  qty: number | null;
  threshold: number;
}

interface DeltaRow {
  batch_id: string;
  bucket: string;
  delta: number;
}

const ITEMS_SQL = `SELECT i.id AS item_id, i.low_stock_threshold AS threshold, b.id AS batch_id, b.qty AS qty, b.expiry AS expiry
  FROM items i LEFT JOIN batches b ON b.item_id = i.id AND b.deleted_at IS NULL
  WHERE i.deleted_at IS NULL AND i.low_stock_threshold > 0`;

const DELTAS_SQL = `SELECT m.batch_id AS batch_id, ${bucketSql("m.at")} AS bucket, SUM(m.qty_delta) AS delta
  FROM stock_movements m JOIN batches b ON b.id = m.batch_id AND b.deleted_at IS NULL
  JOIN items i ON i.id = b.item_id AND i.deleted_at IS NULL AND i.low_stock_threshold > 0
  WHERE m.at >= ?`;

function groupDeltas(
  rows: readonly DeltaRow[],
  timezone: string
): Map<string, Map<string, number>> {
  const byBatch = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const date = bucketDate(row.bucket, timezone);
    const perDate = byBatch.get(row.batch_id) ?? new Map<string, number>();
    perDate.set(date, (perDate.get(date) ?? 0) + row.delta);
    byBatch.set(row.batch_id, perDate);
  }
  return byBatch;
}

function toInput(
  items: readonly ItemBatchRow[],
  deltas: ReadonlyMap<string, ReadonlyMap<string, number>>,
  days: readonly string[]
): TrendInput {
  const thresholds = new Map<string, number>();
  const batches: TrendBatch[] = [];
  for (const row of items) {
    thresholds.set(row.item_id, row.threshold);
    if (row.batch_id !== null) {
      batches.push({
        deltas: deltas.get(row.batch_id) ?? new Map<string, number>(),
        expiry: row.expiry,
        itemId: row.item_id,
        qty: row.qty ?? 0,
      });
    }
  }
  return { batches, days, thresholds };
}

export async function loadLowStockTrend(
  db: D1DatabaseLike,
  bounds: RangeBounds,
  categoryId: string | null
): Promise<LowStockTrendDto> {
  const filter = categoryFilter(categoryId);
  const [items, deltas] = await Promise.all([
    db
      .prepare(`${ITEMS_SQL}${filter.sql}`)
      .bind(...filter.params)
      .all<ItemBatchRow>(),
    db
      .prepare(`${DELTAS_SQL}${filter.sql} GROUP BY m.batch_id, bucket`)
      .bind(bounds.startUtc, ...filter.params)
      .all<DeltaRow>(),
  ]);
  return reconstructLowStock(
    toInput(
      items.results,
      groupDeltas(deltas.results, bounds.timezone),
      listDays(bounds)
    )
  );
}
