/** The `BatchDto` (see `shared/schemas/inventory.ts`) of one batch, for stock-operation responses. */

import { assessExpiry, type ExpiryThresholds } from "../../../shared/expiry";
import type { BatchDto } from "../../../shared/schemas/inventory";
import type { D1DatabaseLike } from "../../env";
import { HttpError } from "../../http";
import { loadFefoRanks } from "./expiry-queries";

interface FullBatchRow {
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
  status: "active" | "disposed";
  supplier: string;
  updated_at: string;
}

export async function loadBatchDto(
  db: D1DatabaseLike,
  batchId: string,
  today: string,
  thresholds: ExpiryThresholds
): Promise<BatchDto> {
  const row = await db
    .prepare(
      "SELECT id, item_id, code, batch_number, barcode, expiry, qty, initial_qty, received_on, supplier, status, created_at, updated_at FROM batches WHERE id = ?"
    )
    .bind(batchId)
    .first<FullBatchRow>();
  if (!row) {
    throw new HttpError("not_found", "The batch was not found.");
  }
  const ranks = await loadFefoRanks(db, [row.item_id], today);
  const { daysUntil, expiryClass } = assessExpiry(
    row.expiry,
    today,
    thresholds
  );
  return {
    barcode: row.barcode,
    batchNumber: row.batch_number,
    code: row.code,
    createdAt: row.created_at,
    daysUntil,
    expiry: row.expiry,
    expiryClass,
    fefoRank: ranks.get(row.id) ?? null,
    id: row.id,
    initialQty: row.initial_qty,
    itemId: row.item_id,
    qty: row.qty,
    quarantined:
      row.status === "active" &&
      row.qty > 0 &&
      row.expiry !== null &&
      row.expiry < today,
    receivedOn: row.received_on,
    status: row.status,
    supplier: row.supplier,
    updatedAt: row.updated_at,
  };
}
