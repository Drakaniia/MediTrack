/**
 * Shared statement builders and the commit helper for the inventory mutations.
 *
 * Every mutation is ONE `db.batch`: the writes, the `stock_movements` rows and the audit row,
 * so a ledger or audit row can never be missing or orphaned.
 */

import { generateBatchCode } from "../../../shared/batch-code";
import type { D1DatabaseLike, D1PreparedStatement, D1Result } from "../../env";
import {
  isCheckViolation,
  isGuardFailure,
  isUniqueViolation,
} from "../../guards";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";

const MAX_CODE_ATTEMPTS = 6;

export interface IssueInput {
  message: string;
  path: string;
}

/** 400 `validation_error` in the same shape `parseJson` produces. */
export function validationFailure(issues: IssueInput[]): HttpError {
  return new HttpError("validation_error", "The request is not valid.", {
    issues,
  });
}

export interface NewBatchRow {
  barcode: string | null;
  batchNumber: string;
  expiry: string | null;
  id: string;
  itemId: string;
  qty: number;
  receivedOn: string;
  supplier: string;
}

/**
 * Inserts a batch only when its item is still live (`WHERE EXISTS`), so a batch can never be
 * attached to an item that was trashed a moment earlier. Follow with `guardChanged(db, 1)`
 * when the item was NOT inserted by the same batch.
 */
export function insertBatchStatement(
  db: D1DatabaseLike,
  row: NewBatchRow,
  ctx: Pick<ProtectedRouteContext, "now" | "user">
): D1PreparedStatement {
  const at = ctx.now.toISOString();
  return db
    .prepare(
      "INSERT INTO batches (id, item_id, code, batch_number, batch_number_lower, barcode, expiry, qty, initial_qty, received_on, supplier, status, created_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ? WHERE EXISTS (SELECT 1 FROM items WHERE id = ? AND deleted_at IS NULL)"
    )
    .bind(
      row.id,
      row.itemId,
      generateBatchCode(),
      row.batchNumber,
      row.batchNumber.toLowerCase(),
      row.barcode,
      row.expiry,
      row.qty,
      row.qty,
      row.receivedOn,
      row.supplier,
      ctx.user.id,
      at,
      at,
      row.itemId
    );
}

/** Ledger row for a quantity change; `qty_after` is read from the batch AFTER the write. */
export function movementStatement(
  db: D1DatabaseLike,
  input: {
    batchId: string;
    ctx: Pick<ProtectedRouteContext, "now" | "user">;
    delta: number;
    kind: "receive";
    note?: string;
    reason?: string;
  }
): D1PreparedStatement {
  const { batchId, ctx, delta, kind } = input;
  return db
    .prepare(
      "INSERT INTO stock_movements (id, at, item_id, batch_id, item_name, batch_number, kind, qty_delta, qty_after, reason, note, ref_type, ref_id, actor_id, actor_name) SELECT ?, ?, b.item_id, b.id, CASE WHEN i.strength = '' THEN i.name ELSE i.name || ' ' || i.strength END, b.batch_number, ?, ?, b.qty, ?, ?, NULL, NULL, ?, ? FROM batches b JOIN items i ON i.id = b.item_id WHERE b.id = ?"
    )
    .bind(
      newId(),
      ctx.now.toISOString(),
      kind,
      delta,
      input.reason ?? "",
      input.note ?? "",
      ctx.user.id,
      ctx.user.displayName,
      batchId
    );
}

/**
 * Runs `build()` as one atomic batch. `build` is called again with fresh batch codes when a
 * generated code collides (UNIQUE `batches.code`). Failed guards, CHECK and other UNIQUE
 * violations mean "the world changed under us" and become `onConflict`.
 */
export async function commitInventoryBatch(
  db: D1DatabaseLike,
  build: () => D1PreparedStatement[],
  onConflict: HttpError
): Promise<D1Result[]> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.batch(build());
    } catch (error) {
      if (
        isUniqueViolation(error, "batches.code") &&
        attempt < MAX_CODE_ATTEMPTS
      ) {
        continue;
      }
      if (
        isGuardFailure(error) ||
        isCheckViolation(error) ||
        isUniqueViolation(error)
      ) {
        throw onConflict;
      }
      throw error;
    }
  }
}
