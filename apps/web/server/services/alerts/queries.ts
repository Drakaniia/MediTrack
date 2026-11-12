/** Read side of the alert generator: three set-based SELECTs, never one per row. */

import {
  type ClassBoundaries,
  EXPIRY_CLASSES,
  type ExpiryClass,
  expiryClassCase,
} from "../../../shared/expiry";
import type { D1DatabaseLike } from "../../env";
import type { GenerationCounts } from "./types";

const LIVE_BATCH_WHERE =
  "b.deleted_at IS NULL AND i.deleted_at IS NULL AND b.status = 'active' AND b.qty > 0";

export interface BatchRow {
  batch_id: string;
  batch_number: string;
  expiry: string;
  item_id: string;
  /** From `alert_state`; null = never tracked (treated as safe). */
  last_class: ExpiryClass | null;
  name: string;
  qty: number;
  strength: string;
  unit: string;
}

export interface LowStockRow {
  available: number;
  item_id: string;
  name: string;
  strength: string;
  threshold: number;
  unit: string;
  /** From `low_stock_state`; null = never tracked. */
  was_low: number | null;
}

type ClassTotals = Pick<
  GenerationCounts,
  "expired" | "nearExpiry" | "safe" | "urgent"
>;

const KEY_BY_CLASS: Record<ExpiryClass, keyof ClassTotals> = {
  expired: "expired",
  near_expiry: "nearExpiry",
  safe: "safe",
  urgent: "urgent",
};

function isExpiryClass(value: string): value is ExpiryClass {
  return (EXPIRY_CLASSES as readonly string[]).includes(value);
}

/** Live batches per class (no-expiry batches are safe), one grouped query. */
export async function countLiveBatches(
  db: D1DatabaseLike,
  boundaries: ClassBoundaries
): Promise<ClassTotals> {
  const classCase = expiryClassCase("b.expiry", boundaries);
  const { results } = await db
    .prepare(
      `SELECT ${classCase.sql} AS cls, COUNT(*) AS total
       FROM batches b JOIN items i ON i.id = b.item_id
       WHERE ${LIVE_BATCH_WHERE}
       GROUP BY cls`
    )
    .bind(...classCase.params)
    .all<{ cls: string; total: number }>();
  const totals: ClassTotals = { expired: 0, nearExpiry: 0, safe: 0, urgent: 0 };
  for (const row of results) {
    if (isExpiryClass(row.cls)) {
      totals[KEY_BY_CLASS[row.cls]] = row.total;
    }
  }
  return totals;
}

/**
 * The live batches that can matter to the generator: those inside the Near Expiry
 * window or already expired (`expiry <= nearUntil`), plus any batch that has an
 * `alert_state` row (it may have improved). Far-future and no-expiry batches that were
 * never alerted are skipped, which keeps the result small on a big stock list.
 */
export async function loadCandidateBatches(
  db: D1DatabaseLike,
  boundaries: ClassBoundaries
): Promise<BatchRow[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id AS batch_id, b.item_id, b.batch_number, b.expiry, b.qty,
              i.name, i.strength, i.unit, s.last_class
       FROM batches b
       JOIN items i ON i.id = b.item_id
       LEFT JOIN alert_state s ON s.batch_id = b.id
       WHERE ${LIVE_BATCH_WHERE}
         AND b.expiry IS NOT NULL
         AND (b.expiry <= ? OR s.batch_id IS NOT NULL)
       ORDER BY b.expiry, lower(i.name), b.batch_number_lower, b.id`
    )
    .bind(boundaries.nearUntil)
    .all<BatchRow>();
  return results;
}

/**
 * Every item with a threshold, with FEFO-eligible stock (`available`): expired stock
 * awaiting disposal does not hide a shortage. Joined to `low_stock_state` for the
 * previous verdict.
 */
export async function loadThresholdItems(
  db: D1DatabaseLike,
  today: string
): Promise<LowStockRow[]> {
  const { results } = await db
    .prepare(
      `SELECT i.id AS item_id, i.name, i.strength, i.unit,
              i.low_stock_threshold AS threshold,
              COALESCE(SUM(CASE WHEN b.deleted_at IS NULL AND b.status = 'active' AND b.qty > 0
                                 AND (b.expiry IS NULL OR b.expiry >= ?) THEN b.qty ELSE 0 END), 0) AS available,
              ls.is_low AS was_low
       FROM items i
       LEFT JOIN batches b ON b.item_id = i.id
       LEFT JOIN low_stock_state ls ON ls.item_id = i.id
       WHERE i.deleted_at IS NULL AND i.low_stock_threshold > 0
       GROUP BY i.id
       ORDER BY lower(i.name), i.id`
    )
    .bind(today)
    .all<LowStockRow>();
  return results;
}
