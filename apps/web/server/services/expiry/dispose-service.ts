/**
 * `POST /api/batches/:id/dispose` — write off the WHOLE remaining quantity of one batch
 * (spec §6.4: expired, damaged, recalled or other; quarantined stock is disposed, never edited).
 *
 * One `db.batch`: compare-and-set on the quantity the planner read (so a dispense landing in
 * between turns into 409 `stock_conflict` instead of disposing a stale number), the `disposals`
 * snapshot, the ledger row and the audit row. A disposed batch leaves FEFO for good
 * (`status = 'disposed'`, qty 0).
 */

import { isExpired } from "../../../shared/expiry";
import {
  DISPOSAL_REASON_LABELS,
  type DisposalDto,
  type DisposeInput,
} from "../../../shared/schemas/expiry";
import { actorOf, auditStatement } from "../../audit";
import { batchOrConflict, guardChanged } from "../../guards";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import { loadExpiryContext } from "./context";
import {
  assertOperable,
  findStockBatch,
  movementStatement,
  type StockBatchRow,
  stockConflict,
  stockItemName,
} from "./stock-batch";

function assertDisposable(
  row: StockBatchRow,
  input: DisposeInput,
  today: string
): void {
  if (row.qty <= 0) {
    throw new HttpError("conflict", "There is no stock left to dispose of.");
  }
  if (input.reason === "expired" && !isExpired(row.expiry, today)) {
    throw new HttpError("validation_error", "The request is not valid.", {
      issues: [{ message: "Batch has not expired", path: "reason" }],
    });
  }
}

export async function disposeBatch(
  ctx: ProtectedRouteContext,
  batchId: string,
  input: DisposeInput
): Promise<DisposalDto> {
  const { db, user } = ctx;
  const context = await loadExpiryContext(db, ctx.now);
  const row = await findStockBatch(db, batchId);
  assertOperable(row);
  assertDisposable(row, input, context.today);

  const at = ctx.now.toISOString();
  const disposalId = newId();
  const itemName = stockItemName(row);
  const reasonLabel = DISPOSAL_REASON_LABELS[input.reason];

  await batchOrConflict(
    db,
    [
      db
        .prepare(
          "UPDATE batches SET qty = 0, status = 'disposed', disposed_at = ?, updated_at = ? WHERE id = ? AND qty = ? AND status = 'active' AND deleted_at IS NULL"
        )
        .bind(at, at, row.id, row.qty),
      guardChanged(db, 1),
      db
        .prepare(
          "INSERT INTO disposals (id, batch_id, item_id, item_name, batch_number, expiry, qty, reason, note, disposed_by, disposed_by_name, disposed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          disposalId,
          row.id,
          row.item_id,
          itemName,
          row.batch_number,
          row.expiry,
          row.qty,
          input.reason,
          input.note,
          user.id,
          user.displayName,
          at
        ),
      movementStatement(db, {
        batchId: row.id,
        batchNumber: row.batch_number,
        delta: -row.qty,
        itemId: row.item_id,
        itemName,
        kind: "dispose",
        note: input.note,
        now: ctx.now,
        reason: reasonLabel,
        refId: disposalId,
        refType: "disposal",
        user,
      }),
      auditStatement(db, {
        action: "stock.dispose",
        actor: actorOf(user),
        after: { qty: 0, reason: input.reason, status: "disposed" },
        at,
        before: { expiry: row.expiry, qty: row.qty, status: row.status },
        entityId: row.id,
        entityType: "batch",
        ip: ctx.ip,
        summary: `Disposed ${row.qty} of "${itemName}" batch ${row.batch_number} (${reasonLabel.toLowerCase()})`,
      }),
    ],
    stockConflict()
  );

  return {
    batchId: row.id,
    batchNumber: row.batch_number,
    disposedAt: at,
    disposedByName: user.displayName,
    expiry: row.expiry,
    id: disposalId,
    itemId: row.item_id,
    itemName,
    note: input.note,
    qty: row.qty,
    reason: input.reason,
  };
}
