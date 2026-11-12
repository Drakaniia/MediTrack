/** Items: create (with optional first batches), edit, soft delete and history. */

import { batchNumberKey } from "../../../shared/batch-code";
import type {
  BatchWarning,
  CreateItemResultDto,
  HistoryEntryDto,
  ItemDetailDto,
} from "../../../shared/schemas/inventory";
import type {
  BatchInput,
  CreateItemInput,
  UpdateItemInput,
} from "../../../shared/schemas/inventory-input";
import { actorOf, auditStatement } from "../../audit";
import type { D1DatabaseLike, D1PreparedStatement } from "../../env";
import { guardChanged } from "../../guards";
import { HttpError, type Paging } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import {
  arrivalWarnings,
  expiryRuleIssue,
  resolveBatchNumber,
} from "./batch-rules";
import {
  categoryExists,
  clashMessage,
  findItemClash,
  findLiveItemRow,
  type ItemDbRow,
  notFound,
} from "./lookups";
import { loadItemDetail, readContextFor } from "./read-models";
import { displayNameOf } from "./row-mappers";
import {
  commitInventoryBatch,
  type IssueInput,
  insertBatchStatement,
  movementStatement,
  type NewBatchRow,
  validationFailure,
} from "./statements";

export interface ItemFields {
  barcode: string | null;
  categoryId: string | null;
  hasExpiry: boolean;
  lowStockThreshold: number;
  name: string;
  notes: string;
  packSize: number | null;
  packUnit: string;
  sku: string | null;
  strength: string;
  supplier: string;
  unit: string;
}

export function withItemDefaults(
  input: Partial<ItemFields> & { name: string }
): ItemFields {
  return {
    barcode: input.barcode ?? null,
    categoryId: input.categoryId ?? null,
    hasExpiry: input.hasExpiry ?? true,
    lowStockThreshold: input.lowStockThreshold ?? 0,
    name: input.name,
    notes: input.notes ?? "",
    packSize: input.packSize ?? null,
    packUnit: input.packUnit ?? "",
    sku: input.sku ?? null,
    strength: input.strength ?? "",
    supplier: input.supplier ?? "",
    unit: input.unit ?? "unit",
  };
}

export function insertItemStatement(
  db: D1DatabaseLike,
  id: string,
  fields: ItemFields,
  ctx: Pick<ProtectedRouteContext, "now" | "user">
): D1PreparedStatement {
  const at = ctx.now.toISOString();
  return db
    .prepare(
      "INSERT INTO items (id, name, strength, category_id, unit, pack_unit, pack_size, supplier, sku, barcode, low_stock_threshold, has_expiry, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      id,
      fields.name,
      fields.strength,
      fields.categoryId,
      fields.unit,
      fields.packUnit,
      fields.packSize,
      fields.supplier,
      fields.sku,
      fields.barcode,
      fields.lowStockThreshold,
      fields.hasExpiry ? 1 : 0,
      fields.notes,
      ctx.user.id,
      at,
      at
    );
}

export async function assertCategory(
  db: D1DatabaseLike,
  categoryId: string | null | undefined,
  path = "categoryId"
): Promise<void> {
  if (categoryId && !(await categoryExists(db, categoryId))) {
    throw validationFailure([
      { message: "That category no longer exists.", path },
    ]);
  }
}

export interface PreparedBatches {
  rows: NewBatchRow[];
  warnings: { batchNumber: string; warning: BatchWarning }[];
}

/** Validates batch inputs against the item's expiry rule and resolves blank batch numbers. */
export function prepareNewBatches(input: {
  batches: readonly BatchInput[];
  existingNumbers?: readonly string[];
  hasExpiry: boolean;
  itemId: string;
  itemName: string;
  pathPrefix: string;
  today: string;
}): PreparedBatches {
  const issues: IssueInput[] = [];
  const used = [...(input.existingNumbers ?? [])];
  const rows: NewBatchRow[] = [];
  const warnings: PreparedBatches["warnings"] = [];
  for (const [index, batch] of input.batches.entries()) {
    const path = `${input.pathPrefix}.${index}`;
    const expiry = batch.expiry ?? null;
    const ruleIssue = expiryRuleIssue(
      input.hasExpiry,
      expiry,
      `${path}.expiry`
    );
    if (ruleIssue) {
      issues.push(ruleIssue);
    }
    const receivedOn = batch.receivedOn ?? input.today;
    const batchNumber = resolveBatchNumber({
      batchNumber: batch.batchNumber,
      itemName: input.itemName,
      receivedOn,
      used,
    });
    if (
      used.some(
        (number) => batchNumberKey(number) === batchNumberKey(batchNumber)
      )
    ) {
      issues.push({
        message: "This batch number is used twice.",
        path: `${path}.batchNumber`,
      });
    }
    used.push(batchNumber);
    rows.push({
      barcode: batch.barcode ?? null,
      batchNumber,
      expiry,
      id: newId(),
      itemId: input.itemId,
      qty: batch.qty,
      receivedOn,
      supplier: batch.supplier,
    });
    for (const warning of arrivalWarnings(expiry, input.today)) {
      warnings.push({ batchNumber, warning });
    }
  }
  if (issues.length > 0) {
    throw validationFailure(issues);
  }
  return { rows, warnings };
}

export function clashError(
  clash: NonNullable<Awaited<ReturnType<typeof findItemClash>>>
): HttpError {
  return new HttpError("conflict", clashMessage(clash), {
    existingItemId: clash.existingItemId,
    field: clash.field,
  });
}

export function batchAuditStatement(
  db: D1DatabaseLike,
  ctx: ProtectedRouteContext,
  row: NewBatchRow,
  itemName: string
): D1PreparedStatement {
  return auditStatement(db, {
    action: "batch.create",
    actor: actorOf(ctx.user),
    after: {
      batchNumber: row.batchNumber,
      expiry: row.expiry,
      qty: row.qty,
      receivedOn: row.receivedOn,
    },
    at: ctx.now.toISOString(),
    entityId: row.id,
    entityType: "batch",
    ip: ctx.ip,
    summary: `Received ${row.qty} of "${itemName}" (batch ${row.batchNumber})`,
  });
}

export async function createItem(
  ctx: ProtectedRouteContext,
  input: CreateItemInput
): Promise<CreateItemResultDto> {
  const { db } = ctx;
  const fields = withItemDefaults(input);
  await assertCategory(db, fields.categoryId);
  const clash = await findItemClash(db, fields);
  if (clash) {
    throw clashError(clash);
  }
  const rc = await readContextFor(db, ctx.now);
  const itemId = newId();
  const prepared = prepareNewBatches({
    batches: input.batches,
    hasExpiry: fields.hasExpiry,
    itemId,
    itemName: fields.name,
    pathPrefix: "batches",
    today: rc.today,
  });
  const name = displayNameOf(fields.name, fields.strength);
  const build = (): D1PreparedStatement[] => [
    insertItemStatement(db, itemId, fields, ctx),
    ...prepared.rows.flatMap((row) => [
      insertBatchStatement(db, row, ctx),
      movementStatement(db, {
        batchId: row.id,
        ctx,
        delta: row.qty,
        kind: "receive",
        reason: "Initial stock",
      }),
      batchAuditStatement(db, ctx, row, name),
    ]),
    auditStatement(db, {
      action: "item.create",
      actor: actorOf(ctx.user),
      after: { ...snapshotRow(fields), batches: prepared.rows.length },
      at: ctx.now.toISOString(),
      entityId: itemId,
      entityType: "item",
      ip: ctx.ip,
      summary: `Created item "${name}"`,
    }),
  ];
  await commitInventoryBatch(
    db,
    build,
    new HttpError("conflict", "This item was just created by someone else.")
  );
  const item = await loadItemDetail(db, rc, itemId);
  if (!item) {
    throw new HttpError("internal_error", "The item could not be read back.");
  }
  return { item, warnings: prepared.warnings };
}

function snapshotRow(fields: ItemFields): Record<string, unknown> {
  return { ...fields };
}

// ─── Update ─────────────────────────────────────────────────────────────────

const COLUMN_BY_FIELD = {
  barcode: "barcode",
  categoryId: "category_id",
  hasExpiry: "has_expiry",
  lowStockThreshold: "low_stock_threshold",
  name: "name",
  notes: "notes",
  packSize: "pack_size",
  packUnit: "pack_unit",
  sku: "sku",
  strength: "strength",
  supplier: "supplier",
  unit: "unit",
} as const;

type ItemField = keyof typeof COLUMN_BY_FIELD;

interface FieldChange {
  after: unknown;
  before: unknown;
  column: string;
  dbValue: number | string | null;
  field: ItemField;
}

function currentValue(row: ItemDbRow, field: ItemField): unknown {
  const raw = row[COLUMN_BY_FIELD[field]];
  return field === "hasExpiry" ? raw === 1 : raw;
}

function changesOf(row: ItemDbRow, input: UpdateItemInput): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of Object.keys(COLUMN_BY_FIELD) as ItemField[]) {
    const next = input[field];
    if (next === undefined) {
      continue;
    }
    const before = currentValue(row, field);
    if (before === next) {
      continue;
    }
    changes.push({
      after: next,
      before,
      column: COLUMN_BY_FIELD[field],
      dbValue: typeof next === "boolean" ? Number(next) : next,
      field,
    });
  }
  return changes;
}

async function assertExpiryModeChangeAllowed(
  db: D1DatabaseLike,
  itemId: string
): Promise<void> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM batches WHERE item_id = ? AND deleted_at IS NULL"
    )
    .bind(itemId)
    .first<{ n: number }>();
  if ((row?.n ?? 0) > 0) {
    throw new HttpError(
      "conflict",
      "Expiry tracking can only be changed while the item has no batches.",
      { field: "hasExpiry", liveBatches: row?.n }
    );
  }
}

export async function updateItem(
  ctx: ProtectedRouteContext,
  itemId: string,
  input: UpdateItemInput
): Promise<ItemDetailDto> {
  const { db } = ctx;
  const row = await findLiveItemRow(db, itemId);
  await assertCategory(db, input.categoryId);
  const changes = changesOf(row, input);
  const rc = await readContextFor(db, ctx.now);
  if (changes.length > 0) {
    if (changes.some((change) => change.field === "hasExpiry")) {
      await assertExpiryModeChangeAllowed(db, itemId);
    }
    await writeItemChanges(ctx, row, changes);
  }
  const item = await loadItemDetail(db, rc, itemId);
  if (!item) {
    throw notFound("The item");
  }
  return item;
}

async function writeItemChanges(
  ctx: ProtectedRouteContext,
  row: ItemDbRow,
  changes: FieldChange[]
): Promise<void> {
  const { db } = ctx;
  const next = {
    barcode: row.barcode,
    name: row.name,
    sku: row.sku,
    strength: row.strength,
  };
  for (const change of changes) {
    if (change.field in next) {
      Object.assign(next, { [change.field]: change.after });
    }
  }
  const clash = await findItemClash(db, next, row.id);
  if (clash) {
    throw clashError(clash);
  }
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const change of changes) {
    before[change.field] = change.before;
    after[change.field] = change.after;
  }
  const assignments = changes
    .map((change) => `${change.column} = ?`)
    .join(", ");
  const at = ctx.now.toISOString();
  const name = displayNameOf(String(next.name), String(next.strength));
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare(
          `UPDATE items SET ${assignments}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
        )
        .bind(...changes.map((change) => change.dbValue), at, row.id),
      guardChanged(db, 1),
      auditStatement(db, {
        action: "item.update",
        actor: actorOf(ctx.user),
        after,
        at,
        before,
        entityId: row.id,
        entityType: "item",
        ip: ctx.ip,
        summary: `Edited item "${name}" (${changes.map((change) => change.field).join(", ")})`,
      }),
    ],
    new HttpError("conflict", "The item changed while you were editing it.")
  );
}

// ─── Delete ─────────────────────────────────────────────────────────────────

export async function deleteItem(
  ctx: ProtectedRouteContext,
  itemId: string
): Promise<void> {
  const { db } = ctx;
  const row = await findLiveItemRow(db, itemId);
  const stock = await db
    .prepare(
      "SELECT COUNT(*) AS batches, COALESCE(SUM(qty), 0) AS units FROM batches WHERE item_id = ? AND deleted_at IS NULL"
    )
    .bind(itemId)
    .first<{ batches: number; units: number }>();
  const at = ctx.now.toISOString();
  const name = displayNameOf(row.name, row.strength);
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare(
          "UPDATE items SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
        )
        .bind(at, ctx.user.id, at, itemId),
      guardChanged(db, 1),
      db
        .prepare(
          "UPDATE batches SET deleted_at = ?, deleted_by = ?, deleted_with_item = 1, updated_at = ? WHERE item_id = ? AND deleted_at IS NULL"
        )
        .bind(at, ctx.user.id, at, itemId),
      auditStatement(db, {
        action: "item.delete",
        actor: actorOf(ctx.user),
        at,
        before: {
          batches: stock?.batches ?? 0,
          name,
          onHand: stock?.units ?? 0,
        },
        entityId: itemId,
        entityType: "item",
        ip: ctx.ip,
        summary: `Moved item "${name}" to the Trash`,
      }),
    ],
    new HttpError("conflict", "The item was already deleted.")
  );
}

// ─── History ────────────────────────────────────────────────────────────────

interface HistoryRow {
  actor_name: string;
  at: string;
  batch_number: string | null;
  id: string;
  kind: string;
  note: string;
  qty_after: number | null;
  qty_delta: number | null;
  source: "audit" | "movement";
  summary: string;
}

const HISTORY_UNION = `SELECT 'movement' AS source, m.id AS id, m.at AS at, m.kind AS kind, m.qty_delta AS qty_delta, m.qty_after AS qty_after, m.batch_number AS batch_number, m.actor_name AS actor_name, m.reason AS summary, m.note AS note FROM stock_movements m WHERE m.item_id = ?
UNION ALL
SELECT 'audit', CAST(a.id AS TEXT), a.at, a.action, NULL, NULL, NULL, a.actor_name, a.summary, '' FROM audit_log a WHERE (a.entity_type = 'item' AND a.entity_id = ?) OR (a.entity_type = 'batch' AND a.entity_id IN (SELECT id FROM batches WHERE item_id = ?))`;

export async function itemHistory(
  db: D1DatabaseLike,
  itemId: string,
  paging: Paging
): Promise<{ entries: HistoryEntryDto[]; total: number }> {
  const params = [itemId, itemId, itemId];
  const [page, count] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM (${HISTORY_UNION}) ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`
      )
      .bind(...params, paging.limit, paging.offset)
      .all<HistoryRow>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM (${HISTORY_UNION})`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);
  return {
    entries: page.results.map((row) => ({
      actorName: row.actor_name,
      at: row.at,
      batchNumber: row.batch_number,
      id: `${row.source}:${row.id}`,
      kind: row.kind,
      note: row.note,
      qtyAfter: row.qty_after,
      qtyDelta: row.qty_delta,
      source: row.source,
      summary: row.summary,
    })),
    total: count?.total ?? 0,
  };
}
