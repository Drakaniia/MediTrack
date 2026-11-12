/**
 * Database rows → inventory DTOs. Pure functions: every derived value (expiry class,
 * quarantine, FEFO rank, low stock) is computed here from the row plus a `ReadContext`,
 * never stored.
 */

import { assessExpiry, type ExpiryClass } from "../../../shared/expiry";
import { isQuarantined } from "../../../shared/fefo";
import { classifyLowStock } from "../../../shared/low-stock";
import type {
  BatchDto,
  BatchStatus,
  ItemSummaryDto,
} from "../../../shared/schemas/inventory";
import type { ReadContext } from "./read-models";

export interface BatchRow {
  barcode: string | null;
  batch_number: string;
  code: string;
  created_at: string;
  expiry: string | null;
  id: string;
  initial_qty: number;
  item_id: string;
  qty: number;
  received_on: string;
  status: BatchStatus;
  supplier: string;
  updated_at: string;
}

export interface ItemRow {
  available: number;
  barcode: string | null;
  batch_count: number;
  category_id: string | null;
  category_name: string | null;
  has_expiry: number;
  id: string;
  low_stock_threshold: number;
  name: string;
  nearest_expiry: string | null;
  notes: string;
  on_hand: number;
  pack_size: number | null;
  pack_unit: string;
  sku: string | null;
  strength: string;
  supplier: string;
  unit: string;
  updated_at: string;
  worst_rank: number | null;
}

/** Columns every query that feeds `toBatchDto` must select. */
export const BATCH_COLUMNS =
  "b.id, b.item_id, b.code, b.batch_number, b.barcode, b.expiry, b.qty, b.initial_qty, b.received_on, b.supplier, b.status, b.created_at, b.updated_at";

const WORST_CLASS_BY_RANK: readonly ExpiryClass[] = [
  "expired",
  "urgent",
  "near_expiry",
  "safe",
];

export function displayNameOf(name: string, strength: string): string {
  return strength === "" ? name : `${name} ${strength}`;
}

export function worstClassOf(rank: number | null): ExpiryClass {
  if (rank === null) {
    return "safe";
  }
  return WORST_CLASS_BY_RANK[rank] ?? "safe";
}

export function toBatchDto(
  row: BatchRow,
  rc: ReadContext,
  fefoRank: number | null
): BatchDto {
  const { daysUntil, expiryClass } = assessExpiry(
    row.expiry,
    rc.today,
    rc.thresholds
  );
  return {
    barcode: row.barcode,
    batchNumber: row.batch_number,
    code: row.code,
    createdAt: row.created_at,
    daysUntil,
    expiry: row.expiry,
    expiryClass,
    fefoRank,
    id: row.id,
    initialQty: row.initial_qty,
    itemId: row.item_id,
    qty: row.qty,
    quarantined: isQuarantined(
      {
        batchNumber: row.batch_number,
        expiry: row.expiry,
        id: row.id,
        qty: row.qty,
        receivedOn: row.received_on,
        status: row.status,
      },
      rc.today
    ),
    receivedOn: row.received_on,
    status: row.status,
    supplier: row.supplier,
    updatedAt: row.updated_at,
  };
}

export function toItemSummary(row: ItemRow): ItemSummaryDto {
  return {
    available: row.available,
    barcode: row.barcode,
    batchCount: row.batch_count,
    categoryId: row.category_id,
    categoryName: row.category_name,
    displayName: displayNameOf(row.name, row.strength),
    hasExpiry: row.has_expiry === 1,
    id: row.id,
    lowStock: classifyLowStock({
      available: row.available,
      threshold: row.low_stock_threshold,
    }),
    lowStockThreshold: row.low_stock_threshold,
    name: row.name,
    nearestExpiry: row.nearest_expiry,
    onHand: row.on_hand,
    packSize: row.pack_size,
    packUnit: row.pack_unit,
    sku: row.sku,
    strength: row.strength,
    supplier: row.supplier,
    unit: row.unit,
    updatedAt: row.updated_at,
    worstClass: worstClassOf(row.worst_rank),
  };
}
