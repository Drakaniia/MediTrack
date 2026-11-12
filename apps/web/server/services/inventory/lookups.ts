/** Small existence / uniqueness lookups shared by the inventory services. */

import type { D1DatabaseLike } from "../../env";
import { HttpError } from "../../http";

export interface ItemDbRow {
  barcode: string | null;
  category_id: string | null;
  deleted_at: string | null;
  deleted_with_item?: number;
  has_expiry: number;
  id: string;
  low_stock_threshold: number;
  name: string;
  notes: string;
  pack_size: number | null;
  pack_unit: string;
  sku: string | null;
  strength: string;
  supplier: string;
  unit: string;
}

export interface BatchDbRow {
  barcode: string | null;
  batch_number: string;
  deleted_at: string | null;
  deleted_with_item: number;
  expiry: string | null;
  id: string;
  initial_qty: number;
  item_id: string;
  qty: number;
  received_on: string;
  status: string;
  supplier: string;
}

export function notFound(what: string): HttpError {
  return new HttpError("not_found", `${what} was not found.`);
}

export async function findItemRow(
  db: D1DatabaseLike,
  id: string
): Promise<ItemDbRow | null> {
  return await db
    .prepare("SELECT * FROM items WHERE id = ?")
    .bind(id)
    .first<ItemDbRow>();
}

export async function findLiveItemRow(
  db: D1DatabaseLike,
  id: string
): Promise<ItemDbRow> {
  const row = await findItemRow(db, id);
  if (!row || row.deleted_at !== null) {
    throw notFound("The item");
  }
  return row;
}

export async function findBatchRow(
  db: D1DatabaseLike,
  id: string
): Promise<BatchDbRow | null> {
  return await db
    .prepare("SELECT * FROM batches WHERE id = ?")
    .bind(id)
    .first<BatchDbRow>();
}

export async function findLiveBatchRow(
  db: D1DatabaseLike,
  id: string
): Promise<BatchDbRow> {
  const row = await findBatchRow(db, id);
  if (!row || row.deleted_at !== null) {
    throw notFound("The batch");
  }
  return row;
}

export async function categoryExists(
  db: D1DatabaseLike,
  id: string
): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM categories WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  return row !== null;
}

export interface ItemClash {
  existingItemId: string;
  field: "barcode" | "identity" | "sku";
}

/**
 * The live item that already owns this identity (name + strength), SKU or barcode, other
 * than `excludeId`. Mirrors the partial unique indexes so the API can answer precisely
 * instead of surfacing a raw constraint error.
 */
export async function findItemClash(
  db: D1DatabaseLike,
  fields: {
    barcode: string | null;
    name: string;
    sku: string | null;
    strength: string;
  },
  excludeId = ""
): Promise<ItemClash | null> {
  const identity = await db
    .prepare(
      "SELECT id FROM items WHERE lower(name) = ? AND lower(strength) = ? AND deleted_at IS NULL AND id <> ?"
    )
    .bind(fields.name.toLowerCase(), fields.strength.toLowerCase(), excludeId)
    .first<{ id: string }>();
  if (identity) {
    return { existingItemId: identity.id, field: "identity" };
  }
  if (fields.sku !== null) {
    const sku = await db
      .prepare(
        "SELECT id FROM items WHERE lower(sku) = ? AND deleted_at IS NULL AND id <> ?"
      )
      .bind(fields.sku.toLowerCase(), excludeId)
      .first<{ id: string }>();
    if (sku) {
      return { existingItemId: sku.id, field: "sku" };
    }
  }
  if (fields.barcode !== null) {
    const barcode = await db
      .prepare(
        "SELECT id FROM items WHERE barcode = ? AND deleted_at IS NULL AND id <> ?"
      )
      .bind(fields.barcode, excludeId)
      .first<{ id: string }>();
    if (barcode) {
      return { existingItemId: barcode.id, field: "barcode" };
    }
  }
  return null;
}

const CLASH_MESSAGES: Record<ItemClash["field"], string> = {
  barcode: "Another item already uses this barcode.",
  identity: "An item with this name and strength already exists.",
  sku: "Another item already uses this SKU.",
};

export function clashMessage(clash: ItemClash): string {
  return CLASH_MESSAGES[clash.field];
}

export async function findBatchNumberClash(
  db: D1DatabaseLike,
  itemId: string,
  batchNumberLower: string,
  excludeId = ""
): Promise<{ id: string; qty: number; status: string } | null> {
  return await db
    .prepare(
      "SELECT id, qty, status FROM batches WHERE item_id = ? AND batch_number_lower = ? AND deleted_at IS NULL AND id <> ?"
    )
    .bind(itemId, batchNumberLower, excludeId)
    .first<{ id: string; qty: number; status: string }>();
}

export async function liveBatchNumbers(
  db: D1DatabaseLike,
  itemId: string
): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT batch_number FROM batches WHERE item_id = ? AND deleted_at IS NULL"
    )
    .bind(itemId)
    .all<{ batch_number: string }>();
  return results.map((row) => row.batch_number);
}
