/** Loading and guarding the batch a stock operation (adjust / dispose) acts on. */

import type { D1DatabaseLike, D1PreparedStatement } from "../../env";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { AuthUser } from "../../route-types";
import { displayName } from "./sql";

export interface StockBatchRow {
  batch_deleted_at: string | null;
  batch_number: string;
  code: string;
  expiry: string | null;
  id: string;
  item_deleted_at: string | null;
  item_id: string;
  item_name: string;
  qty: number;
  status: "active" | "disposed";
  strength: string;
}

export async function findStockBatch(
  db: D1DatabaseLike,
  batchId: string
): Promise<StockBatchRow> {
  const row = await db
    .prepare(
      "SELECT b.id, b.item_id, b.batch_number, b.code, b.expiry, b.qty, b.status, b.deleted_at AS batch_deleted_at, i.deleted_at AS item_deleted_at, i.name AS item_name, i.strength FROM batches b JOIN items i ON i.id = b.item_id WHERE b.id = ?"
    )
    .bind(batchId)
    .first<StockBatchRow>();
  if (!row) {
    throw new HttpError("not_found", "The batch was not found.");
  }
  return row;
}

/** Trashed or already-disposed batches take no stock operations. */
export function assertOperable(row: StockBatchRow): void {
  if (row.batch_deleted_at !== null || row.item_deleted_at !== null) {
    throw new HttpError("conflict", "The batch is in the Trash.");
  }
  if (row.status === "disposed") {
    throw new HttpError("conflict", "The batch was already disposed.");
  }
}

export function stockItemName(row: StockBatchRow): string {
  return displayName(row.item_name, row.strength);
}

export function stockConflict(): HttpError {
  return new HttpError(
    "stock_conflict",
    "The stock changed while you were working. Review the new quantity and try again."
  );
}

export interface MovementInput {
  batchId: string;
  batchNumber: string;
  delta: number;
  itemId: string;
  itemName: string;
  kind: "adjust" | "dispose";
  note: string;
  now: Date;
  reason: string;
  refId?: string;
  refType?: "disposal";
  user: AuthUser;
}

/**
 * Ledger row for one batch. `qty_after` is read from the batch AFTER the update (the statement
 * runs inside the same `db.batch`, after the write), never computed in JS.
 */
export function movementStatement(
  db: D1DatabaseLike,
  input: MovementInput
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO stock_movements (id, at, item_id, batch_id, item_name, batch_number, kind, qty_delta, qty_after, reason, note, ref_type, ref_id, actor_id, actor_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT qty FROM batches WHERE id = ?), ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      newId(),
      input.now.toISOString(),
      input.itemId,
      input.batchId,
      input.itemName,
      input.batchNumber,
      input.kind,
      input.delta,
      input.batchId,
      input.reason,
      input.note,
      input.refType ?? null,
      input.refId ?? null,
      input.user.id,
      input.user.displayName
    );
}
