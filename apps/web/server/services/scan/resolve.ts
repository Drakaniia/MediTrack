/**
 * Code resolution for `GET /api/scan` (spec §7.3).
 *
 * Order: batch `code` → batch `barcode` → item `barcode` / item `sku` (SKU compared
 * case-insensitively). The first tier that matches wins. Soft-deleted batches and items never
 * resolve. Scans are read-only and high volume, so they are deliberately NOT audited.
 *
 * Within a tier, several distinct items is `ambiguous` (an item barcode can equal another
 * item's SKU, and batch barcodes are not unique). Several batches of ONE item behind the same
 * batch barcode resolve to the item (with its FEFO batch) because the barcode names the product.
 */

import { can } from "../../../shared/permissions";
import type {
  BatchDto,
  ItemSummaryDto,
} from "../../../shared/schemas/inventory";
import {
  type ScanResult,
  scanCandidates,
} from "../../../shared/schemas/scan";
import { HttpError } from "../../http";
import type { ProtectedRouteContext } from "../../route-types";
import {
  loadBatchDto,
  loadItemDetail,
  loadItemSummaries,
  type ReadContext,
  readContextFor,
} from "../inventory/read-models";
import { allowedActionsFor } from "./allowed-actions";

interface BatchMatch {
  id: string;
  item_id: string;
}

interface ItemMatch {
  id: string;
}

const BATCH_MATCH_SQL =
  "SELECT b.id, b.item_id FROM batches b JOIN items i ON i.id = b.item_id AND i.deleted_at IS NULL WHERE b.deleted_at IS NULL AND";

async function batchesWhere(
  ctx: ProtectedRouteContext,
  column: "barcode" | "code",
  value: string
): Promise<BatchMatch[]> {
  const { results } = await ctx.db
    .prepare(
      `${BATCH_MATCH_SQL} b.${column} = ? ORDER BY b.expiry IS NULL, b.expiry, b.received_on, b.id`
    )
    .bind(value)
    .all<BatchMatch>();
  return results;
}

async function itemsByBarcodeOrSku(
  ctx: ProtectedRouteContext,
  text: string
): Promise<string[]> {
  const { results } = await ctx.db
    .prepare(
      "SELECT i.id FROM items i WHERE i.deleted_at IS NULL AND (i.barcode = ? OR lower(i.sku) = lower(?)) ORDER BY lower(i.name), i.id"
    )
    .bind(text, text)
    .all<ItemMatch>();
  return results.map((row) => row.id);
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

async function summariesFor(
  ctx: ProtectedRouteContext,
  rc: ReadContext,
  ids: string[]
): Promise<ItemSummaryDto[]> {
  const { items } = await loadItemSummaries(ctx.db, rc, {
    dir: "asc",
    ids,
    sort: "name",
  });
  return items;
}

async function fefoBatchOf(
  ctx: ProtectedRouteContext,
  rc: ReadContext,
  itemId: string
): Promise<BatchDto | null> {
  const detail = await loadItemDetail(ctx.db, rc, itemId);
  return detail?.batches.find((batch) => batch.fefoRank === 1) ?? null;
}

async function singleItem(
  ctx: ProtectedRouteContext,
  rc: ReadContext,
  id: string
): Promise<ItemSummaryDto> {
  const [item] = await summariesFor(ctx, rc, [id]);
  if (!item) {
    throw new HttpError("not_found", "The item is no longer available.");
  }
  return item;
}

async function batchResult(
  ctx: ProtectedRouteContext,
  rc: ReadContext,
  match: BatchMatch
): Promise<ScanResult | null> {
  const [batch, item] = await Promise.all([
    loadBatchDto(ctx.db, rc, match.id),
    singleItem(ctx, rc, match.item_id),
  ]);
  if (!batch) {
    return null;
  }
  const fefoBatch =
    batch.fefoRank === 1 ? batch : await fefoBatchOf(ctx, rc, item.id);
  return {
    allowedActions: allowedActionsFor(ctx.user.role, {
      batch,
      item,
      scannedBatch: true,
    }),
    batch,
    fefoBatch,
    item,
    kind: "batch",
  };
}

async function itemResult(
  ctx: ProtectedRouteContext,
  rc: ReadContext,
  itemId: string
): Promise<ScanResult> {
  const [item, fefoBatch] = await Promise.all([
    singleItem(ctx, rc, itemId),
    fefoBatchOf(ctx, rc, itemId),
  ]);
  return {
    allowedActions: allowedActionsFor(ctx.user.role, {
      batch: fefoBatch,
      item,
      scannedBatch: false,
    }),
    fefoBatch,
    item,
    kind: "item",
  };
}

async function itemsResult(
  ctx: ProtectedRouteContext,
  rc: ReadContext,
  ids: string[]
): Promise<ScanResult> {
  if (ids.length === 1) {
    return await itemResult(ctx, rc, ids[0]);
  }
  return { items: await summariesFor(ctx, rc, ids), kind: "ambiguous" };
}

async function resolveBatchTier(
  ctx: ProtectedRouteContext,
  rc: ReadContext,
  column: "barcode" | "code",
  value: string
): Promise<ScanResult | null> {
  const matches = await batchesWhere(ctx, column, value);
  if (matches.length === 0) {
    return null;
  }
  if (matches.length === 1) {
    return await batchResult(ctx, rc, matches[0]);
  }
  const itemIds = distinct(matches.map((match) => match.item_id));
  return await itemsResult(ctx, rc, itemIds);
}

function notFound(ctx: ProtectedRouteContext, code: string): HttpError {
  return new HttpError(
    "scan_not_found",
    "No item or batch matches that code.",
    { canRegister: can(ctx.user.role, "inventory.write"), code }
  );
}

/** Resolves a scanned/typed code or throws `404 scan_not_found { code, canRegister }`. */
export async function resolveScan(
  ctx: ProtectedRouteContext,
  rawCode: string
): Promise<ScanResult> {
  const typed = rawCode.trim();
  const { batchCode, text } = scanCandidates(typed);
  const rc = await readContextFor(ctx.db, ctx.now);

  if (batchCode) {
    const byCode = await resolveBatchTier(ctx, rc, "code", batchCode);
    if (byCode) {
      return byCode;
    }
  }
  if (text === "") {
    throw notFound(ctx, typed);
  }
  const byBarcode = await resolveBatchTier(ctx, rc, "barcode", text);
  if (byBarcode) {
    return byBarcode;
  }
  const itemIds = await itemsByBarcodeOrSku(ctx, text);
  if (itemIds.length === 0) {
    throw notFound(ctx, typed);
  }
  return await itemsResult(ctx, rc, itemIds);
}
