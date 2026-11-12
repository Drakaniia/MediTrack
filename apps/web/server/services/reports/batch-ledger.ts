/**
 * Per-batch month figures reconstructed from the append-only `stock_movements` ledger.
 *
 *   closing = current qty − Σ movements dated at/after the month's end
 *   opening = current qty − Σ movements dated at/after the month's start
 *
 * One query: batches (live batches of live items) LEFT JOIN a per-batch aggregate of the
 * movements since the month started. A batch with no stock and no movement since the month
 * started cannot matter to the report and is left out. Quantities are clamped at 0 so an
 * incomplete ledger can never print a negative stock.
 */

import type { D1DatabaseLike } from "../../env";
import type { ReportContext } from "./report-context";

export interface LedgerBatch {
  adjusted: number;
  batchId: string;
  batchNumber: string;
  closingQty: number;
  dispensed: number;
  disposed: number;
  expiry: string | null;
  itemId: string;
  openingQty: number;
  received: number;
}

interface LedgerRow {
  adjusted: number;
  batch_id: string;
  batch_number: string;
  dispensed: number;
  disposed: number;
  expiry: string | null;
  item_id: string;
  later: number;
  qty: number;
  received: number;
  since_start: number;
}

const LEDGER_SQL = `SELECT b.id AS batch_id, b.item_id AS item_id, b.batch_number AS batch_number, b.expiry AS expiry, b.qty AS qty,
    COALESCE(l.received, 0) AS received, COALESCE(l.dispensed, 0) AS dispensed, COALESCE(l.disposed, 0) AS disposed,
    COALESCE(l.adjusted, 0) AS adjusted, COALESCE(l.since_start, 0) AS since_start, COALESCE(l.later, 0) AS later
  FROM batches b
  JOIN items i ON i.id = b.item_id AND i.deleted_at IS NULL
  LEFT JOIN (
    SELECT m.batch_id AS batch_id,
      SUM(CASE WHEN m.at < ? AND m.kind = 'receive' THEN m.qty_delta ELSE 0 END) AS received,
      SUM(CASE WHEN m.at < ? AND m.kind IN ('dispense', 'undo_dispense') THEN -m.qty_delta ELSE 0 END) AS dispensed,
      SUM(CASE WHEN m.at < ? AND m.kind = 'dispose' THEN -m.qty_delta ELSE 0 END) AS disposed,
      SUM(CASE WHEN m.at < ? AND m.kind = 'adjust' THEN m.qty_delta ELSE 0 END) AS adjusted,
      SUM(m.qty_delta) AS since_start,
      SUM(CASE WHEN m.at >= ? THEN m.qty_delta ELSE 0 END) AS later
    FROM stock_movements m
    WHERE m.batch_id IS NOT NULL AND m.at >= ?
    GROUP BY m.batch_id
  ) l ON l.batch_id = b.id
  WHERE b.deleted_at IS NULL AND (b.qty > 0 OR l.batch_id IS NOT NULL)`;

export function toLedgerBatch(row: LedgerRow): LedgerBatch {
  return {
    adjusted: row.adjusted,
    batchId: row.batch_id,
    batchNumber: row.batch_number,
    closingQty: Math.max(0, row.qty - row.later),
    dispensed: row.dispensed,
    disposed: row.disposed,
    expiry: row.expiry,
    itemId: row.item_id,
    openingQty: Math.max(0, row.qty - row.since_start),
    received: row.received,
  };
}

export async function loadBatchLedger(
  db: D1DatabaseLike,
  context: Pick<ReportContext, "endUtc" | "startUtc">
): Promise<LedgerBatch[]> {
  const { endUtc, startUtc } = context;
  const { results } = await db
    .prepare(LEDGER_SQL)
    .bind(endUtc, endUtc, endUtc, endUtc, endUtc, startUtc)
    .all<LedgerRow>();
  return results.map(toLedgerBatch);
}

/** A batch worth listing: it held stock at either end of the month or moved during it. */
export function isRelevantBatch(batch: LedgerBatch): boolean {
  return (
    batch.closingQty > 0 ||
    batch.openingQty > 0 ||
    batch.received !== 0 ||
    batch.dispensed !== 0 ||
    batch.disposed !== 0 ||
    batch.adjusted !== 0
  );
}
