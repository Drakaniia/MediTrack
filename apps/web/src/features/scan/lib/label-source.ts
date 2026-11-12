import type { ExpiryRowDto } from "@shared/schemas/expiry";
import type { BatchDto, ItemSummaryDto } from "@shared/schemas/inventory";

import type { LabelBatch } from "./label-layout";

/** Adapters from the existing endpoints' shapes to the one the labels page prints. */

export function labelBatchFromDto(
  batch: BatchDto,
  item: Pick<ItemSummaryDto, "name" | "strength">
): LabelBatch {
  return {
    batchNumber: batch.batchNumber,
    code: batch.code,
    expiry: batch.expiry,
    id: batch.id,
    itemName: item.name,
    strength: item.strength,
  };
}

/** The expiry list carries "name strength" as `displayName` and the bare name as `itemName`. */
function strengthOf(row: ExpiryRowDto): string {
  return row.displayName.startsWith(row.itemName)
    ? row.displayName.slice(row.itemName.length).trim()
    : "";
}

export function labelBatchFromExpiryRow(row: ExpiryRowDto): LabelBatch {
  return {
    batchNumber: row.batchNumber,
    code: row.code,
    expiry: row.expiry,
    id: row.batchId,
    itemName: row.itemName,
    strength: strengthOf(row),
  };
}
