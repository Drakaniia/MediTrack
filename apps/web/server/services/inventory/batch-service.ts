/** Batches: receive stock (create / merge), edit details, soft delete, number suggestions. */

import {
  batchNumberKey,
  normalizeBatchNumber,
} from "../../../shared/batch-code";
import type {
  BatchDto,
  CreateBatchResultDto,
} from "../../../shared/schemas/inventory";
import type {
  CreateBatchInput,
  UpdateBatchInput,
} from "../../../shared/schemas/inventory-input";
import { actorOf, auditStatement } from "../../audit";
import type { D1PreparedStatement } from "../../env";
import { guardChanged } from "../../guards";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import {
  arrivalWarnings,
  expiryRuleIssue,
  resolveBatchNumber,
} from "./batch-rules";
import {
  findBatchNumberClash,
  findLiveBatchRow,
  findLiveItemRow,
  liveBatchNumbers,
  notFound,
} from "./lookups";
import { loadBatchDto, readContextFor } from "./read-models";
import { displayNameOf } from "./row-mappers";
import {
  commitInventoryBatch,
  insertBatchStatement,
  movementStatement,
  validationFailure,
} from "./statements";

function duplicateBatchError(
  existing: { id: string; qty: number },
  batchNumber: string
): HttpError {
  return new HttpError(
    "duplicate_batch",
    `Batch "${batchNumber}" already exists for this item.`,
    {
      existingBatchId: existing.id,
      existingBatchNumber: batchNumber,
      existingQty: existing.qty,
    }
  );
}

export async function suggestNumberFor(
  ctx: ProtectedRouteContext,
  itemId: string,
  receivedOn?: string
): Promise<string> {
  const item = await findLiveItemRow(ctx.db, itemId);
  const rc = await readContextFor(ctx.db, ctx.now);
  return resolveBatchNumber({
    batchNumber: "",
    itemName: item.name,
    receivedOn: receivedOn ?? rc.today,
    used: await liveBatchNumbers(ctx.db, itemId),
  });
}

export async function receiveBatch(
  ctx: ProtectedRouteContext,
  itemId: string,
  input: CreateBatchInput
): Promise<CreateBatchResultDto> {
  const { db } = ctx;
  const item = await findLiveItemRow(db, itemId);
  const rc = await readContextFor(db, ctx.now);
  const expiry = input.expiry ?? null;
  const ruleIssue = expiryRuleIssue(item.has_expiry === 1, expiry, "expiry");
  if (ruleIssue) {
    throw validationFailure([ruleIssue]);
  }
  const receivedOn = input.receivedOn ?? rc.today;
  const batchNumber = resolveBatchNumber({
    batchNumber: input.batchNumber,
    itemName: item.name,
    receivedOn,
    used: await liveBatchNumbers(db, itemId),
  });
  const existing = await findBatchNumberClash(
    db,
    itemId,
    batchNumberKey(batchNumber)
  );
  if (existing && !input.mergeIntoExisting) {
    throw duplicateBatchError(existing, batchNumber);
  }
  if (existing) {
    return await mergeIntoBatch(ctx, {
      existing,
      itemName: displayNameOf(item.name, item.strength),
      qty: input.qty,
    });
  }
  const batchId = newId();
  const name = displayNameOf(item.name, item.strength);
  const row = {
    barcode: input.barcode ?? null,
    batchNumber,
    expiry,
    id: batchId,
    itemId,
    qty: input.qty,
    receivedOn,
    supplier: input.supplier,
  };
  const warnings = arrivalWarnings(expiry, rc.today);
  await commitInventoryBatch(
    db,
    () => [
      insertBatchStatement(db, row, ctx),
      guardChanged(db, 1),
      movementStatement(db, {
        batchId,
        ctx,
        delta: row.qty,
        kind: "receive",
        reason: "Stock received",
      }),
      auditStatement(db, {
        action: "batch.create",
        actor: actorOf(ctx.user),
        after: {
          batchNumber,
          expiry,
          qty: row.qty,
          receivedOn,
          warnings,
        },
        at: ctx.now.toISOString(),
        entityId: batchId,
        entityType: "batch",
        ip: ctx.ip,
        summary: `Received ${row.qty} of "${name}" (batch ${batchNumber})`,
      }),
    ],
    new HttpError(
      "conflict",
      "That batch number was just added by someone else. Reload and try again."
    )
  );
  return await readBack(ctx, batchId, false, warnings);
}

async function readBack(
  ctx: ProtectedRouteContext,
  batchId: string,
  merged: boolean,
  warnings: CreateBatchResultDto["warnings"]
): Promise<CreateBatchResultDto> {
  const rc = await readContextFor(ctx.db, ctx.now);
  const batch = await loadBatchDto(ctx.db, rc, batchId);
  if (!batch) {
    throw new HttpError("internal_error", "The batch could not be read back.");
  }
  return { batch, merged, warnings };
}

async function mergeIntoBatch(
  ctx: ProtectedRouteContext,
  input: {
    existing: { id: string; qty: number; status: string };
    itemName: string;
    qty: number;
  }
): Promise<CreateBatchResultDto> {
  const { db } = ctx;
  const { existing } = input;
  if (existing.status !== "active") {
    throw new HttpError(
      "conflict",
      "The existing batch was disposed and cannot receive more stock.",
      { existingBatchId: existing.id }
    );
  }
  const at = ctx.now.toISOString();
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare(
          "UPDATE batches SET qty = qty + ?, initial_qty = initial_qty + ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND status = 'active'"
        )
        .bind(input.qty, input.qty, at, existing.id),
      guardChanged(db, 1),
      movementStatement(db, {
        batchId: existing.id,
        ctx,
        delta: input.qty,
        kind: "receive",
        reason: "Added to existing batch",
      }),
      auditStatement(db, {
        action: "batch.merge",
        actor: actorOf(ctx.user),
        after: { added: input.qty, qty: existing.qty + input.qty },
        at,
        before: { qty: existing.qty },
        entityId: existing.id,
        entityType: "batch",
        ip: ctx.ip,
        summary: `Added ${input.qty} to an existing batch of "${input.itemName}"`,
      }),
    ],
    new HttpError(
      "conflict",
      "The batch changed while you were saving. Try again."
    )
  );
  const rc = await readContextFor(db, ctx.now);
  const batch = await loadBatchDto(db, rc, existing.id);
  if (!batch) {
    throw new HttpError("internal_error", "The batch could not be read back.");
  }
  return {
    batch,
    merged: true,
    warnings: arrivalWarnings(batch.expiry, rc.today),
  };
}

export async function getBatch(
  ctx: ProtectedRouteContext,
  batchId: string
): Promise<BatchDto> {
  const rc = await readContextFor(ctx.db, ctx.now);
  const batch = await loadBatchDto(ctx.db, rc, batchId);
  if (!batch) {
    throw notFound("The batch");
  }
  return batch;
}

// ─── Edit ───────────────────────────────────────────────────────────────────

interface BatchChanges {
  after: Record<string, unknown>;
  assignments: string[];
  before: Record<string, unknown>;
  values: (number | string | null)[];
}

function planBatchChanges(
  row: Awaited<ReturnType<typeof findLiveBatchRow>>,
  input: UpdateBatchInput
): BatchChanges {
  const plan: BatchChanges = {
    after: {},
    assignments: [],
    before: {},
    values: [],
  };
  const add = (
    field: string,
    column: string,
    before: unknown,
    after: unknown,
    extra?: { column: string; value: string }
  ): void => {
    if (before === after) {
      return;
    }
    plan.assignments.push(`${column} = ?`);
    plan.values.push(after as number | string | null);
    if (extra) {
      plan.assignments.push(`${extra.column} = ?`);
      plan.values.push(extra.value);
    }
    plan.before[field] = before;
    plan.after[field] = after;
  };
  if (input.batchNumber !== undefined) {
    const number = normalizeBatchNumber(input.batchNumber);
    add("batchNumber", "batch_number", row.batch_number, number, {
      column: "batch_number_lower",
      value: batchNumberKey(number),
    });
  }
  if (input.expiry !== undefined) {
    add("expiry", "expiry", row.expiry, input.expiry);
  }
  if (input.supplier !== undefined) {
    add("supplier", "supplier", row.supplier, input.supplier);
  }
  if (input.barcode !== undefined) {
    add("barcode", "barcode", row.barcode, input.barcode);
  }
  if (input.receivedOn !== undefined) {
    add("receivedOn", "received_on", row.received_on, input.receivedOn);
  }
  return plan;
}

export async function updateBatch(
  ctx: ProtectedRouteContext,
  batchId: string,
  input: UpdateBatchInput
): Promise<BatchDto> {
  const { db } = ctx;
  const row = await findLiveBatchRow(db, batchId);
  const item = await findLiveItemRow(db, row.item_id);
  if (input.expiry !== undefined) {
    const issue = expiryRuleIssue(
      item.has_expiry === 1,
      input.expiry,
      "expiry"
    );
    if (issue) {
      throw validationFailure([issue]);
    }
  }
  const plan = planBatchChanges(row, input);
  if (plan.assignments.length > 0) {
    await writeBatchChanges(ctx, row, item, plan);
  }
  return await getBatch(ctx, batchId);
}

async function writeBatchChanges(
  ctx: ProtectedRouteContext,
  row: Awaited<ReturnType<typeof findLiveBatchRow>>,
  item: Awaited<ReturnType<typeof findLiveItemRow>>,
  plan: BatchChanges
): Promise<void> {
  const { db } = ctx;
  const nextNumber = plan.after.batchNumber;
  if (typeof nextNumber === "string") {
    const clash = await findBatchNumberClash(
      db,
      row.item_id,
      batchNumberKey(nextNumber),
      row.id
    );
    if (clash) {
      throw duplicateBatchError(clash, nextNumber);
    }
  }
  const at = ctx.now.toISOString();
  const name = displayNameOf(item.name, item.strength);
  const statements = (): D1PreparedStatement[] => [
    db
      .prepare(
        `UPDATE batches SET ${plan.assignments.join(", ")}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
      )
      .bind(...plan.values, at, row.id),
    guardChanged(db, 1),
    auditStatement(db, {
      action: "batch.update",
      actor: actorOf(ctx.user),
      after: plan.after,
      at,
      before: plan.before,
      entityId: row.id,
      entityType: "batch",
      ip: ctx.ip,
      summary: `Edited batch ${row.batch_number} of "${name}" (${Object.keys(plan.after).join(", ")})`,
    }),
  ];
  await commitInventoryBatch(
    db,
    statements,
    new HttpError("conflict", "The batch changed while you were editing it.")
  );
}

// ─── Delete ─────────────────────────────────────────────────────────────────

export async function deleteBatch(
  ctx: ProtectedRouteContext,
  batchId: string
): Promise<void> {
  const { db } = ctx;
  const row = await findLiveBatchRow(db, batchId);
  const item = await findLiveItemRow(db, row.item_id);
  const at = ctx.now.toISOString();
  const name = displayNameOf(item.name, item.strength);
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare(
          "UPDATE batches SET deleted_at = ?, deleted_by = ?, deleted_with_item = 0, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
        )
        .bind(at, ctx.user.id, at, batchId),
      guardChanged(db, 1),
      auditStatement(db, {
        action: "batch.delete",
        actor: actorOf(ctx.user),
        at,
        before: {
          batchNumber: row.batch_number,
          expiry: row.expiry,
          qty: row.qty,
        },
        entityId: batchId,
        entityType: "batch",
        ip: ctx.ip,
        summary: `Moved batch ${row.batch_number} of "${name}" to the Trash`,
      }),
    ],
    new HttpError("conflict", "The batch was already deleted.")
  );
}
