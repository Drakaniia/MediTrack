/**
 * `POST /api/batches/:id/adjust` — a count correction on one batch (spec §6.4).
 *
 * The planner reads the batch, computes the new quantity, and the write is a compare-and-set on
 * the quantity it read (`WHERE id = ? AND qty = ?`) followed by `guardChanged`, so two people
 * adjusting (or a dispense landing in between) can never silently overwrite each other: the loser
 * gets 409 `stock_conflict`. Ledger row and audit row are in the same `db.batch`.
 */

import { isExpired } from "../../../shared/expiry";
import {
  ADJUST_REASON_LABELS,
  type AdjustInput,
  MAX_STOCK_QTY,
} from "../../../shared/schemas/expiry";
import type { BatchDto } from "../../../shared/schemas/inventory";
import { actorOf, auditStatement } from "../../audit";
import { batchOrConflict, guardChanged } from "../../guards";
import { HttpError } from "../../http";
import type { ProtectedRouteContext } from "../../route-types";
import { loadBatchDto } from "./batch-dto";
import { loadExpiryContext } from "./context";
import {
  assertOperable,
  findStockBatch,
  movementStatement,
  type StockBatchRow,
  stockConflict,
  stockItemName,
} from "./stock-batch";

function invalid(path: string, message: string): HttpError {
  return new HttpError("validation_error", "The request is not valid.", {
    issues: [{ message, path }],
  });
}

/** The quantity the batch should end up with, or a validation error saying why not. */
export function planAdjustment(row: StockBatchRow, input: AdjustInput): number {
  const field = input.newQty === undefined ? "delta" : "newQty";
  const target = input.newQty ?? row.qty + (input.delta ?? 0);
  if (target < 0) {
    throw invalid(
      field,
      `Only ${row.qty} on hand, so that would go below zero.`
    );
  }
  if (target > MAX_STOCK_QTY) {
    throw invalid(field, "That quantity is too large.");
  }
  if (target === row.qty) {
    throw invalid(field, "That is already the current quantity.");
  }
  return target;
}

export async function adjustBatch(
  ctx: ProtectedRouteContext,
  batchId: string,
  input: AdjustInput
): Promise<BatchDto> {
  const { db, user } = ctx;
  const context = await loadExpiryContext(db, ctx.now);
  const row = await findStockBatch(db, batchId);
  assertOperable(row);
  if (isExpired(row.expiry, context.today)) {
    throw new HttpError(
      "expired_stock",
      "Expired stock cannot be adjusted. Dispose of it instead."
    );
  }
  const target = planAdjustment(row, input);
  const delta = target - row.qty;
  const at = ctx.now.toISOString();
  const itemName = stockItemName(row);
  const reasonLabel = ADJUST_REASON_LABELS[input.reason];

  await batchOrConflict(
    db,
    [
      db
        .prepare(
          "UPDATE batches SET qty = ?, updated_at = ? WHERE id = ? AND qty = ? AND status = 'active' AND deleted_at IS NULL"
        )
        .bind(target, at, row.id, row.qty),
      guardChanged(db, 1),
      movementStatement(db, {
        batchId: row.id,
        batchNumber: row.batch_number,
        delta,
        itemId: row.item_id,
        itemName,
        kind: "adjust",
        note: input.note,
        now: ctx.now,
        reason: reasonLabel,
        user,
      }),
      auditStatement(db, {
        action: "stock.adjust",
        actor: actorOf(user),
        after: { note: input.note, qty: target, reason: input.reason },
        at,
        before: { qty: row.qty },
        entityId: row.id,
        entityType: "batch",
        ip: ctx.ip,
        summary: `Adjusted "${itemName}" batch ${row.batch_number} from ${row.qty} to ${target} (${reasonLabel.toLowerCase()})`,
      }),
    ],
    stockConflict()
  );
  return await loadBatchDto(db, row.id, context.today, context.thresholds);
}
