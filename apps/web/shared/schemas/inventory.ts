/**
 * Inventory read models shared by EVERY slice.
 *
 * These are the shapes `GET /api/items`, `GET /api/items/:id` and `GET /api/fefo`
 * return. Requests, Quick Deduct, scanning, the dashboard, alerts and the command
 * palette all consume them, so they are frozen up front and owned by the INV
 * slice: INV may ADD fields and input schemas, but must not rename or remove an
 * exported field without telling the orchestrator.
 *
 * Derived values (`expiryClass`, `daysUntil`, `available`, `lowStock`, …) are
 * computed at read time from the facility timezone and the expiry thresholds in
 * settings — never stored.
 */

import type { ExpiryClass } from "../expiry";

export type LowStockStatus = "in_stock" | "low" | "out";

export type BatchStatus = "active" | "disposed";

export interface CategoryDto {
  id: string;
  /** Live (not trashed) items in the category. */
  itemCount?: number;
  name: string;
  sortOrder?: number;
}

export interface BatchDto {
  barcode: string | null;
  batchNumber: string;
  /** Short opaque QR payload (10 chars, Crockford base32). */
  code: string;
  createdAt: string;
  /** Whole days from facility-local today; null when there is no expiry. */
  daysUntil: number | null;
  /** `YYYY-MM-DD`, or null for items without an expiry. */
  expiry: string | null;
  /** Computed: Safe / Near Expiry / Urgent / Expired. */
  expiryClass: ExpiryClass;
  /** 1-based position among the item's FEFO-eligible batches; null when not eligible. */
  fefoRank: number | null;
  id: string;
  initialQty: number;
  itemId: string;
  qty: number;
  /** Expired, still active, still holding stock: waiting for the disposal flow. */
  quarantined: boolean;
  /** `YYYY-MM-DD`. */
  receivedOn: string;
  status: BatchStatus;
  supplier: string;
  updatedAt: string;
}

export interface ItemSummaryDto {
  /** Sum over FEFO-eligible batches (active, qty > 0, not expired). What can be dispensed. */
  available: number;
  barcode: string | null;
  /** Number of live batches that still hold stock. */
  batchCount: number;
  categoryId: string | null;
  categoryName: string | null;
  /** "Paracetamol 500 mg" — name plus strength, as shown everywhere. */
  displayName: string;
  /** Items flagged "no expiry" (equipment, consumables) have `false`. */
  hasExpiry: boolean;
  id: string;
  lowStock: LowStockStatus;
  lowStockThreshold: number;
  name: string;
  /** Earliest expiry among FEFO-eligible batches, or null. */
  nearestExpiry: string | null;
  /** Sum over active batches, INCLUDING expired stock awaiting disposal. */
  onHand: number;
  packSize: number | null;
  packUnit: string;
  sku: string | null;
  strength: string;
  supplier: string;
  unit: string;
  updatedAt: string;
  /** Most severe class among batches that still hold stock (Expired > Urgent > Near > Safe). */
  worstClass: ExpiryClass;
}

export interface ItemDetailDto extends ItemSummaryDto {
  /**
   * FEFO order first (eligible batches, earliest expiry first), then quarantined
   * (expired) batches, then empty/disposed ones.
   */
  batches: BatchDto[];
  notes: string;
}

/** One row of the facility-wide "use first" list: the next batch to pull for an item. */
export interface FefoEntryDto {
  batch: BatchDto;
  item: Pick<
    ItemSummaryDto,
    "categoryName" | "displayName" | "id" | "name" | "strength" | "unit"
  >;
}

// ─── Additions owned by the INV slice ───────────────────────────────────────

/** Non-blocking notes the server attaches to a successful receive. */
export type BatchWarning = "expired_on_arrival";

export interface CreateBatchResultDto {
  batch: BatchDto;
  /** True when the quantity was added to an existing batch (`mergeIntoExisting`). */
  merged: boolean;
  warnings: BatchWarning[];
}

export interface CreateItemResultDto {
  item: ItemDetailDto;
  warnings: { batchNumber: string; warning: BatchWarning }[];
}

export interface HistoryEntryDto {
  actorName: string;
  at: string;
  batchNumber: string | null;
  id: string;
  /** Movement kind (`receive`, `dispense`, …) or audit action (`item.update`, …). */
  kind: string;
  note: string;
  qtyAfter: number | null;
  qtyDelta: number | null;
  source: "audit" | "movement";
  summary: string;
}

export interface TrashItemDto {
  batchCount: number;
  categoryName: string | null;
  deletedAt: string;
  deletedBy: string | null;
  displayName: string;
  id: string;
  /** Units on the batches that came back with the item. */
  onHand: number;
}

export interface TrashBatchDto {
  batchNumber: string;
  deletedAt: string;
  deletedBy: string | null;
  /** True when it was trashed because its item was (restored with the item). */
  deletedWithItem: boolean;
  expiry: string | null;
  id: string;
  itemDeleted: boolean;
  itemId: string;
  itemName: string;
  qty: number;
}

export interface TrashListDto {
  batches: TrashBatchDto[];
  items: TrashItemDto[];
}

export interface BulkIssueDto {
  field: string;
  message: string;
  /** 1-based row number as the user sees it. */
  row: number;
}

export interface BulkImportResultDto {
  batches: number;
  categories: number;
  dryRun: boolean;
  /** Rows that landed on an item that already existed. */
  existingItems: number;
  items: number;
}
