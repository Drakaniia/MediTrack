/** Batch reads and ledger rows used by dispensing (hand-over, Quick Deduct and its undo). */

import type { FefoBatchLike } from "../../../shared/fefo";
import type { BatchStatus } from "../../../shared/schemas/inventory";
import type { D1DatabaseLike, D1PreparedStatement } from "../../env";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { AuthUser } from "../../route-types";
import { displayName } from "./facility";

interface BatchRow {
  batch_number: string;
  expiry: string | null;
  id: string;
  qty: number;
  received_on: string;
  status: BatchStatus;
}

/** Every live batch of a live item, as FEFO input (eligibility is decided by the planner). */
export async function loadItemBatches(
  db: D1DatabaseLike,
  itemId: string
): Promise<FefoBatchLike[]> {
  const { results } = await db
    .prepare(
      "SELECT b.id, b.batch_number, b.expiry, b.qty, b.received_on, b.status FROM batches b JOIN items i ON i.id = b.item_id WHERE b.item_id = ? AND b.deleted_at IS NULL AND i.deleted_at IS NULL"
    )
    .bind(itemId)
    .all<BatchRow>();
  return results.map((row) => ({
    batchNumber: row.batch_number,
    deleted: false,
    expiry: row.expiry,
    id: row.id,
    qty: row.qty,
    receivedOn: row.received_on,
    status: row.status,
  }));
}

export interface LiveItem {
  id: string;
  name: string;
  strength: string;
  unit: string;
}

export async function findLiveItem(
  db: D1DatabaseLike,
  itemId: string
): Promise<LiveItem> {
  const row = await db
    .prepare(
      "SELECT id, name, strength, unit FROM items WHERE id = ? AND deleted_at IS NULL"
    )
    .bind(itemId)
    .first<LiveItem>();
  if (!row) {
    throw new HttpError("not_found", "The item was not found.");
  }
  return row;
}

export function itemLabel(item: LiveItem): string {
  return displayName(item.name, item.strength);
}

export function stockConflictError(): HttpError {
  return new HttpError(
    "stock_conflict",
    "The stock changed while you were working. Review the new quantities and try again."
  );
}

export interface MovementInput {
  batchId: string;
  batchNumber: string;
  delta: number;
  itemId: string | null;
  itemName: string;
  kind: "dispense" | "undo_dispense";
  note: string;
  now: Date;
  reason: string;
  recordId: string;
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
      "INSERT INTO stock_movements (id, at, item_id, batch_id, item_name, batch_number, kind, qty_delta, qty_after, reason, note, ref_type, ref_id, actor_id, actor_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT qty FROM batches WHERE id = ?), ?, ?, 'dispensing_record', ?, ?, ?)"
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
      input.recordId,
      input.user.id,
      input.user.displayName
    );
}
