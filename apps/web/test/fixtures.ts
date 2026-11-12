/**
 * Row factories for API tests. They write straight to SQLite (fast, no HTTP) so a
 * test can arrange stock without depending on the INV routes it may be testing.
 *
 * Column names follow `migrations/0001_init.sql`. Every factory returns the id(s)
 * it created. Defaults are chosen so a bare call produces a valid, FEFO-eligible batch
 * relative to the test clock (`TEST_START` = 2026-11-12, facility day 2026-11-12).
 */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { batchNumberKey, generateBatchCode } from "../shared/batch-code";

export const FIXTURE_NOW = "2026-11-12T02:00:00.000Z";
export const FIXTURE_TODAY = "2026-11-12";

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(6, "0")}`;
}

function run(sqlite: DatabaseSync, sql: string, values: SQLInputValue[]): void {
  sqlite.prepare(sql).run(...values);
}

export interface ItemFixture {
  barcode?: string | null;
  categoryId?: string | null;
  hasExpiry?: boolean;
  id?: string;
  lowStockThreshold?: number;
  name?: string;
  notes?: string;
  packSize?: number | null;
  packUnit?: string;
  sku?: string | null;
  strength?: string;
  supplier?: string;
  unit?: string;
}

export function insertCategory(
  sqlite: DatabaseSync,
  name = "General",
  id = nextId("cat")
): string {
  run(
    sqlite,
    "INSERT INTO categories (id, name, name_lower, sort_order) VALUES (?, ?, ?, 0)",
    [id, name, name.toLowerCase()]
  );
  return id;
}

export function insertItem(
  sqlite: DatabaseSync,
  fields: ItemFixture = {}
): string {
  const id = fields.id ?? nextId("item");
  run(
    sqlite,
    `INSERT INTO items (id, name, strength, category_id, unit, pack_unit, pack_size, supplier, sku, barcode, low_stock_threshold, has_expiry, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fields.name ?? `Item ${id}`,
      fields.strength ?? "",
      fields.categoryId ?? null,
      fields.unit ?? "tab",
      fields.packUnit ?? "",
      fields.packSize ?? null,
      fields.supplier ?? "",
      fields.sku ?? null,
      fields.barcode ?? null,
      fields.lowStockThreshold ?? 0,
      fields.hasExpiry === false ? 0 : 1,
      fields.notes ?? "",
      FIXTURE_NOW,
      FIXTURE_NOW,
    ]
  );
  return id;
}

export interface BatchFixture {
  barcode?: string | null;
  batchNumber?: string;
  code?: string;
  deleted?: boolean;
  /** `YYYY-MM-DD` or null (no expiry). Default: 120 days after FIXTURE_TODAY. */
  expiry?: string | null;
  id?: string;
  itemId: string;
  qty?: number;
  receivedOn?: string;
  status?: "active" | "disposed";
  supplier?: string;
}

export function insertBatch(
  sqlite: DatabaseSync,
  fields: BatchFixture
): string {
  const id = fields.id ?? nextId("batch");
  const batchNumber = fields.batchNumber ?? `LOT-${id}`;
  const qty = fields.qty ?? 10;
  run(
    sqlite,
    `INSERT INTO batches (id, item_id, code, batch_number, batch_number_lower, barcode, expiry, qty, initial_qty, received_on, supplier, status, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fields.itemId,
      fields.code ?? generateBatchCode(),
      batchNumber,
      batchNumberKey(batchNumber),
      fields.barcode ?? null,
      fields.expiry === undefined ? "2027-03-12" : fields.expiry,
      qty,
      Math.max(qty, 1),
      fields.receivedOn ?? "2026-11-01",
      fields.supplier ?? "",
      fields.status ?? "active",
      fields.deleted ? FIXTURE_NOW : null,
      FIXTURE_NOW,
      FIXTURE_NOW,
    ]
  );
  return id;
}

export function setSetting(
  sqlite: DatabaseSync,
  key: string,
  value: unknown
): void {
  run(
    sqlite,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value), FIXTURE_NOW]
  );
}

export function batchQty(sqlite: DatabaseSync, batchId: string): number {
  const row = sqlite
    .prepare("SELECT qty FROM batches WHERE id = ?")
    .get(batchId) as { qty: number } | undefined;
  if (!row) {
    throw new Error(`No batch ${batchId}`);
  }
  return row.qty;
}

export function auditActions(sqlite: DatabaseSync): string[] {
  const rows = sqlite
    .prepare("SELECT action FROM audit_log ORDER BY id")
    .all() as { action: string }[];
  return rows.map((row) => row.action);
}
