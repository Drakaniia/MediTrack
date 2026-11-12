/**
 * Bulk import (paste / sheet): validate EVERY row first, report all problems at once, then
 * write. Rows sharing an identity (name + strength) become one item with several batches;
 * an identity that already exists receives the batches.
 *
 * Nothing is written when any row has a problem. A valid import is written in chunks of at
 * most `MAX_ROWS_PER_CHUNK` rows and `MAX_STATEMENTS_PER_CHUNK` statements, each chunk being
 * ONE atomic `db.batch` (items + batches + ledger + audit).
 */

import { batchNumberKey } from "../../../shared/batch-code";
import type {
  BulkImportResultDto,
  BulkIssueDto,
} from "../../../shared/schemas/inventory";
import type { BulkImportInput } from "../../../shared/schemas/inventory-input";
import { actorOf, auditStatement } from "../../audit";
import type { D1DatabaseLike, D1PreparedStatement } from "../../env";
import { guardChanged } from "../../guards";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import { expiryRuleIssue, resolveBatchNumber } from "./batch-rules";
import { type ParsedBulkRow, parseBulkRows } from "./bulk-parse";
import { type ItemFields, insertItemStatement } from "./item-service";
import { readContextFor } from "./read-models";
import { displayNameOf } from "./row-mappers";
import {
  commitInventoryBatch,
  insertBatchStatement,
  movementStatement,
  type NewBatchRow,
} from "./statements";

const MAX_ROWS_PER_CHUNK = 40;
const MAX_STATEMENTS_PER_CHUNK = 96;

interface PlannedGroup {
  batches: NewBatchRow[];
  categoryId: string | null;
  existing: boolean;
  fields: ItemFields;
  firstRow: number;
  id: string;
}

interface CategoryPlan {
  created: { id: string; name: string }[];
  idByLower: Map<string, string>;
}

interface Unit {
  build: () => D1PreparedStatement[];
  rows: number;
  size: number;
}

interface ExistingItem {
  has_expiry: number;
  id: string;
  name: string;
  strength: string;
}

async function resolveCategories(
  db: D1DatabaseLike,
  parsed: readonly ParsedBulkRow[]
): Promise<CategoryPlan> {
  const names = new Map<string, string>();
  for (const row of parsed) {
    const name = row.item.categoryName;
    if (name !== "" && !names.has(name.toLowerCase())) {
      names.set(name.toLowerCase(), name);
    }
  }
  const idByLower = new Map<string, string>();
  const created: CategoryPlan["created"] = [];
  if (names.size === 0) {
    return { created, idByLower };
  }
  const { results } = await db
    .prepare(
      "SELECT id, name_lower FROM categories WHERE name_lower IN (SELECT value FROM json_each(?))"
    )
    .bind(JSON.stringify([...names.keys()]))
    .all<{ id: string; name_lower: string }>();
  for (const row of results) {
    idByLower.set(row.name_lower, row.id);
  }
  for (const [lower, name] of names) {
    if (!idByLower.has(lower)) {
      const id = newId();
      idByLower.set(lower, id);
      created.push({ id, name });
    }
  }
  return { created, idByLower };
}

async function findExistingItems(
  db: D1DatabaseLike,
  keys: readonly string[]
): Promise<Map<string, ExistingItem>> {
  const { results } = await db
    .prepare(
      "SELECT id, name, strength, has_expiry FROM items WHERE deleted_at IS NULL AND lower(name) || char(31) || lower(strength) IN (SELECT value FROM json_each(?))"
    )
    .bind(JSON.stringify(keys))
    .all<ExistingItem>();
  return new Map(
    results.map((row) => [
      `${row.name.toLowerCase()}\u001f${row.strength.toLowerCase()}`,
      row,
    ])
  );
}

async function existingBatchNumbers(
  db: D1DatabaseLike,
  itemIds: readonly string[]
): Promise<Map<string, string[]>> {
  const byItem = new Map<string, string[]>();
  if (itemIds.length === 0) {
    return byItem;
  }
  const { results } = await db
    .prepare(
      "SELECT item_id, batch_number FROM batches WHERE deleted_at IS NULL AND item_id IN (SELECT value FROM json_each(?))"
    )
    .bind(JSON.stringify(itemIds))
    .all<{ batch_number: string; item_id: string }>();
  for (const row of results) {
    byItem.set(row.item_id, [
      ...(byItem.get(row.item_id) ?? []),
      row.batch_number,
    ]);
  }
  return byItem;
}

async function takenCodes(
  db: D1DatabaseLike,
  column: "barcode" | "sku",
  values: readonly string[]
): Promise<Set<string>> {
  if (values.length === 0) {
    return new Set();
  }
  const expression = column === "sku" ? "lower(sku)" : "barcode";
  const { results } = await db
    .prepare(
      `SELECT ${expression} AS code FROM items WHERE deleted_at IS NULL AND ${expression} IN (SELECT value FROM json_each(?))`
    )
    .bind(JSON.stringify(values))
    .all<{ code: string }>();
  return new Set(results.map((row) => row.code));
}

function groupRows(
  parsed: readonly ParsedBulkRow[]
): Map<string, ParsedBulkRow[]> {
  const groups = new Map<string, ParsedBulkRow[]>();
  for (const row of parsed) {
    const group = groups.get(row.identityKey);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.identityKey, [row]);
    }
  }
  return groups;
}

interface PlanInput {
  barcodeTaken: Set<string>;
  categories: CategoryPlan;
  existing: Map<string, ExistingItem>;
  issues: BulkIssueDto[];
  numbers: Map<string, string[]>;
  skuTaken: Set<string>;
}

function planGroup(
  key: string,
  rows: ParsedBulkRow[],
  input: PlanInput,
  seen: { barcodes: Set<string>; skus: Set<string> }
): PlannedGroup {
  const [first] = rows;
  const existing = input.existing.get(key);
  const id = existing?.id ?? newId();
  const hasExpiry = existing ? existing.has_expiry === 1 : first.item.hasExpiry;
  const fields: ItemFields = {
    ...first.item,
    categoryId: null,
    hasExpiry,
  };
  const categoryId =
    first.item.categoryName === ""
      ? null
      : (input.categories.idByLower.get(
          first.item.categoryName.toLowerCase()
        ) ?? null);
  if (!existing) {
    checkCodes(first, input, seen);
  }
  const used = [...(input.numbers.get(id) ?? [])];
  const displayName = displayNameOf(first.item.name, first.item.strength);
  const batches: NewBatchRow[] = [];
  for (const row of rows) {
    if (!row.batch) {
      continue;
    }
    const issue = expiryRuleIssue(hasExpiry, row.batch.expiry, "expiry");
    const alreadyReported = input.issues.some(
      (reported) =>
        reported.row === row.rowNumber && reported.field === "expiry"
    );
    if (issue && !alreadyReported) {
      input.issues.push({
        field: "expiry",
        message: issue.message,
        row: row.rowNumber,
      });
    }
    const batchNumber = resolveBatchNumber({
      batchNumber: row.batch.batchNumber,
      itemName: first.item.name,
      receivedOn: row.batch.receivedOn,
      used,
    });
    if (
      used.some(
        (number) => batchNumberKey(number) === batchNumberKey(batchNumber)
      )
    ) {
      input.issues.push({
        field: "batchNumber",
        message: `Batch "${batchNumber}" is used twice for ${displayName}.`,
        row: row.rowNumber,
      });
    }
    used.push(batchNumber);
    batches.push({
      barcode: null,
      batchNumber,
      expiry: row.batch.expiry,
      id: newId(),
      itemId: id,
      qty: row.batch.qty,
      receivedOn: row.batch.receivedOn,
      supplier: row.item.supplier,
    });
  }
  return {
    batches,
    categoryId,
    existing: existing !== undefined,
    fields,
    firstRow: first.rowNumber,
    id,
  };
}

function checkCodes(
  first: ParsedBulkRow,
  input: PlanInput,
  seen: { barcodes: Set<string>; skus: Set<string> }
): void {
  const { sku, barcode } = first.item;
  if (sku !== null) {
    const lower = sku.toLowerCase();
    if (input.skuTaken.has(lower) || seen.skus.has(lower)) {
      input.issues.push({
        field: "sku",
        message: "This SKU is already used by another item.",
        row: first.rowNumber,
      });
    }
    seen.skus.add(lower);
  }
  if (barcode !== null) {
    if (input.barcodeTaken.has(barcode) || seen.barcodes.has(barcode)) {
      input.issues.push({
        field: "barcode",
        message: "This barcode is already used by another item.",
        row: first.rowNumber,
      });
    }
    seen.barcodes.add(barcode);
  }
}

function itemUnit(ctx: ProtectedRouteContext, group: PlannedGroup): Unit {
  const { db } = ctx;
  const name = displayNameOf(group.fields.name, group.fields.strength);
  const count = group.batches.length;
  const size = group.existing ? count * 4 : 2 + count * 2;
  const build = (): D1PreparedStatement[] => {
    const statements: D1PreparedStatement[] = [];
    if (!group.existing) {
      statements.push(
        insertItemStatement(
          db,
          group.id,
          { ...group.fields, categoryId: group.categoryId },
          ctx
        )
      );
    }
    for (const batch of group.batches) {
      statements.push(insertBatchStatement(db, batch, ctx));
      if (group.existing) {
        statements.push(guardChanged(db, 1));
      }
      statements.push(
        movementStatement(db, {
          batchId: batch.id,
          ctx,
          delta: batch.qty,
          kind: "receive",
          reason: "Bulk import",
        })
      );
      if (group.existing) {
        statements.push(batchAudit(db, ctx, batch, name));
      }
    }
    if (!group.existing) {
      statements.push(newItemAudit(db, ctx, group, name));
    }
    return statements;
  };
  return { build, rows: 1, size };
}

function batchAudit(
  db: D1DatabaseLike,
  ctx: ProtectedRouteContext,
  batch: NewBatchRow,
  name: string
): D1PreparedStatement {
  return auditStatement(db, {
    action: "batch.create",
    actor: actorOf(ctx.user),
    after: {
      batchNumber: batch.batchNumber,
      expiry: batch.expiry,
      qty: batch.qty,
    },
    at: ctx.now.toISOString(),
    entityId: batch.id,
    entityType: "batch",
    ip: ctx.ip,
    summary: `Imported ${batch.qty} of "${name}" (batch ${batch.batchNumber})`,
  });
}

function newItemAudit(
  db: D1DatabaseLike,
  ctx: ProtectedRouteContext,
  group: PlannedGroup,
  name: string
): D1PreparedStatement {
  return auditStatement(db, {
    action: "item.create",
    actor: actorOf(ctx.user),
    after: {
      batches: group.batches.map((batch) => ({
        batchNumber: batch.batchNumber,
        expiry: batch.expiry,
        qty: batch.qty,
      })),
      name,
      source: "bulk_import",
    },
    at: ctx.now.toISOString(),
    entityId: group.id,
    entityType: "item",
    ip: ctx.ip,
    summary: `Imported item "${name}" with ${group.batches.length} batch(es)`,
  });
}

function categoryUnit(
  ctx: ProtectedRouteContext,
  category: { id: string; name: string }
): Unit {
  const { db } = ctx;
  return {
    build: () => [
      db
        .prepare(
          "INSERT INTO categories (id, name, name_lower, sort_order, created_at) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories), ?)"
        )
        .bind(
          category.id,
          category.name,
          category.name.toLowerCase(),
          ctx.now.toISOString()
        ),
      auditStatement(db, {
        action: "category.create",
        actor: actorOf(ctx.user),
        after: { name: category.name, source: "bulk_import" },
        at: ctx.now.toISOString(),
        entityId: category.id,
        entityType: "category",
        ip: ctx.ip,
        summary: `Created category "${category.name}" during import`,
      }),
    ],
    rows: 0,
    size: 2,
  };
}

function chunkUnits(units: readonly Unit[]): Unit[][] {
  const chunks: Unit[][] = [];
  let current: Unit[] = [];
  let size = 0;
  let rows = 0;
  for (const unit of units) {
    const full =
      current.length > 0 &&
      (size + unit.size > MAX_STATEMENTS_PER_CHUNK ||
        rows + unit.rows > MAX_ROWS_PER_CHUNK);
    if (full) {
      chunks.push(current);
      current = [];
      size = 0;
      rows = 0;
    }
    current.push(unit);
    size += unit.size;
    rows += unit.rows;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function failWithIssues(issues: BulkIssueDto[]): HttpError {
  const sorted = [...issues].sort((a, b) => a.row - b.row);
  return new HttpError("validation_error", "Some rows need attention.", {
    issues: sorted.map((issue) => ({
      field: issue.field,
      message: issue.message,
      path: `rows.${issue.row - 1}.${issue.field}`,
      row: issue.row,
    })),
  });
}

async function buildPlan(
  ctx: ProtectedRouteContext,
  parsed: ParsedBulkRow[],
  issues: BulkIssueDto[]
): Promise<{ categories: CategoryPlan; groups: PlannedGroup[] }> {
  const { db } = ctx;
  const grouped = groupRows(parsed);
  const [categories, existing] = await Promise.all([
    resolveCategories(db, parsed),
    findExistingItems(db, [...grouped.keys()]),
  ]);
  const numbers = await existingBatchNumbers(
    db,
    [...existing.values()].map((item) => item.id)
  );
  const newRows = [...grouped.entries()]
    .filter(([key]) => !existing.has(key))
    .map(([, rows]) => rows[0]);
  const [skuTaken, barcodeTaken] = await Promise.all([
    takenCodes(
      db,
      "sku",
      newRows.flatMap((row) =>
        row.item.sku ? [row.item.sku.toLowerCase()] : []
      )
    ),
    takenCodes(
      db,
      "barcode",
      newRows.flatMap((row) => (row.item.barcode ? [row.item.barcode] : []))
    ),
  ]);
  const input: PlanInput = {
    barcodeTaken,
    categories,
    existing,
    issues,
    numbers,
    skuTaken,
  };
  const seen = { barcodes: new Set<string>(), skus: new Set<string>() };
  const groups = [...grouped.entries()].map(([key, rows]) =>
    planGroup(key, rows, input, seen)
  );
  return { categories, groups };
}

export async function bulkImport(
  ctx: ProtectedRouteContext,
  input: BulkImportInput
): Promise<BulkImportResultDto> {
  const { db } = ctx;
  const rc = await readContextFor(db, ctx.now);
  const { issues, parsed } = parseBulkRows(input.rows, rc.today);
  if (parsed.length === 0) {
    throw failWithIssues([
      { field: "name", message: "Add at least one row.", row: 1 },
    ]);
  }
  const { categories, groups } = await buildPlan(ctx, parsed, issues);
  if (issues.length > 0) {
    throw failWithIssues(issues);
  }
  const result: BulkImportResultDto = {
    batches: groups.reduce((sum, group) => sum + group.batches.length, 0),
    categories: categories.created.length,
    dryRun: input.dryRun,
    existingItems: groups.filter((group) => group.existing).length,
    items: groups.filter((group) => !group.existing).length,
  };
  if (input.dryRun) {
    return result;
  }
  const units: Unit[] = [
    ...categories.created.map((category) => categoryUnit(ctx, category)),
    ...groups.map((group) => itemUnit(ctx, group)),
    summaryUnit(ctx, result),
  ];
  for (const chunk of chunkUnits(units)) {
    await commitInventoryBatch(
      db,
      () => chunk.flatMap((unit) => unit.build()),
      new HttpError(
        "conflict",
        "Part of the import clashed with a change someone else just made. Reload and import again."
      )
    );
  }
  return result;
}

function summaryUnit(
  ctx: ProtectedRouteContext,
  result: BulkImportResultDto
): Unit {
  const { db } = ctx;
  return {
    build: () => [
      auditStatement(db, {
        action: "inventory.bulk_import",
        actor: actorOf(ctx.user),
        after: result,
        at: ctx.now.toISOString(),
        entityType: "inventory",
        ip: ctx.ip,
        summary: `Bulk import: ${result.items} new item(s), ${result.batches} batch(es)`,
      }),
    ],
    rows: 0,
    size: 1,
  };
}
