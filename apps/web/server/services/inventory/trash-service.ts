/**
 * Trash: list, restore and purge soft-deleted items and batches.
 *
 * Restoring an item brings back exactly the batches trashed WITH it (`deleted_with_item = 1`);
 * a batch trashed on its own stays in the Trash. Purging is a hard delete; history tables keep
 * their snapshots (`item_name`, `batch_number`) with nullable foreign keys.
 */

import { batchNumberKey } from "../../../shared/batch-code";
import type {
  TrashBatchDto,
  TrashItemDto,
  TrashListDto,
} from "../../../shared/schemas/inventory";
import type { TrashType } from "../../../shared/schemas/inventory-input";
import { actorOf, auditStatement } from "../../audit";
import type { D1DatabaseLike } from "../../env";
import { guardChanged } from "../../guards";
import { HttpError } from "../../http";
import type { ProtectedRouteContext } from "../../route-types";
import {
  clashMessage,
  findBatchNumberClash,
  findBatchRow,
  findItemClash,
  findItemRow,
  notFound,
} from "./lookups";
import { displayNameOf } from "./row-mappers";
import { commitInventoryBatch } from "./statements";

const MAX_TRASH_ROWS = 500;

interface TrashItemRow {
  batch_count: number;
  category_name: string | null;
  deleted_at: string;
  deleted_by_name: string | null;
  id: string;
  name: string;
  on_hand: number;
  strength: string;
}

interface TrashBatchRow {
  batch_number: string;
  deleted_at: string;
  deleted_by_name: string | null;
  deleted_with_item: number;
  expiry: string | null;
  id: string;
  item_deleted_at: string | null;
  item_id: string;
  item_name: string;
  item_strength: string;
  qty: number;
}

export async function listTrash(db: D1DatabaseLike): Promise<TrashListDto> {
  const [items, batches] = await Promise.all([
    db
      .prepare(
        "SELECT i.id, i.name, i.strength, i.deleted_at, u.display_name AS deleted_by_name, c.name AS category_name, (SELECT COUNT(*) FROM batches b WHERE b.item_id = i.id AND b.deleted_with_item = 1) AS batch_count, (SELECT COALESCE(SUM(b.qty), 0) FROM batches b WHERE b.item_id = i.id AND b.deleted_with_item = 1) AS on_hand FROM items i LEFT JOIN users u ON u.id = i.deleted_by LEFT JOIN categories c ON c.id = i.category_id WHERE i.deleted_at IS NOT NULL ORDER BY i.deleted_at DESC, i.id LIMIT ?"
      )
      .bind(MAX_TRASH_ROWS)
      .all<TrashItemRow>(),
    db
      .prepare(
        "SELECT b.id, b.item_id, b.batch_number, b.expiry, b.qty, b.deleted_at, b.deleted_with_item, u.display_name AS deleted_by_name, i.name AS item_name, i.strength AS item_strength, i.deleted_at AS item_deleted_at FROM batches b JOIN items i ON i.id = b.item_id LEFT JOIN users u ON u.id = b.deleted_by WHERE b.deleted_at IS NOT NULL ORDER BY b.deleted_at DESC, b.id LIMIT ?"
      )
      .bind(MAX_TRASH_ROWS)
      .all<TrashBatchRow>(),
  ]);
  return {
    batches: batches.results.map(toTrashBatch),
    items: items.results.map(toTrashItem),
  };
}

function toTrashItem(row: TrashItemRow): TrashItemDto {
  return {
    batchCount: row.batch_count,
    categoryName: row.category_name,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by_name,
    displayName: displayNameOf(row.name, row.strength),
    id: row.id,
    onHand: row.on_hand,
  };
}

function toTrashBatch(row: TrashBatchRow): TrashBatchDto {
  return {
    batchNumber: row.batch_number,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by_name,
    deletedWithItem: row.deleted_with_item === 1,
    expiry: row.expiry,
    id: row.id,
    itemDeleted: row.item_deleted_at !== null,
    itemId: row.item_id,
    itemName: displayNameOf(row.item_name, row.item_strength),
    qty: row.qty,
  };
}

function restoreConflict(message: string, details?: unknown): HttpError {
  return new HttpError("restore_conflict", message, details);
}

// ─── Restore ────────────────────────────────────────────────────────────────

export async function restoreFromTrash(
  ctx: ProtectedRouteContext,
  type: TrashType,
  id: string
): Promise<void> {
  if (type === "item") {
    await restoreItem(ctx, id);
    return;
  }
  await restoreBatch(ctx, id);
}

async function restoreItem(
  ctx: ProtectedRouteContext,
  id: string
): Promise<void> {
  const { db } = ctx;
  const row = await findItemRow(db, id);
  if (!row || row.deleted_at === null) {
    throw notFound("The trashed item");
  }
  const clash = await findItemClash(db, row, id);
  if (clash) {
    throw restoreConflict(
      `${clashMessage(clash)} Rename or delete that item first.`,
      clash
    );
  }
  const at = ctx.now.toISOString();
  const name = displayNameOf(row.name, row.strength);
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare(
          "UPDATE items SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL"
        )
        .bind(at, id),
      guardChanged(db, 1),
      db
        .prepare(
          "UPDATE batches SET deleted_at = NULL, deleted_by = NULL, deleted_with_item = 0, updated_at = ? WHERE item_id = ? AND deleted_with_item = 1 AND deleted_at IS NOT NULL"
        )
        .bind(at, id),
      auditStatement(db, {
        action: "item.restore",
        actor: actorOf(ctx.user),
        at,
        entityId: id,
        entityType: "item",
        ip: ctx.ip,
        summary: `Restored item "${name}" from the Trash`,
      }),
    ],
    restoreConflict(
      "Something changed while restoring. Reload the Trash and try again."
    )
  );
}

async function restoreBatch(
  ctx: ProtectedRouteContext,
  id: string
): Promise<void> {
  const { db } = ctx;
  const row = await findBatchRow(db, id);
  if (!row || row.deleted_at === null) {
    throw notFound("The trashed batch");
  }
  const item = await findItemRow(db, row.item_id);
  if (!item || item.deleted_at !== null) {
    throw restoreConflict(
      "Restore the item first: its batches come back with it.",
      { itemId: row.item_id }
    );
  }
  const clash = await findBatchNumberClash(
    db,
    row.item_id,
    batchNumberKey(row.batch_number),
    id
  );
  if (clash) {
    throw restoreConflict(
      `Batch "${row.batch_number}" already exists for this item. Rename it first.`,
      { existingBatchId: clash.id }
    );
  }
  const at = ctx.now.toISOString();
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare(
          "UPDATE batches SET deleted_at = NULL, deleted_by = NULL, deleted_with_item = 0, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL"
        )
        .bind(at, id),
      guardChanged(db, 1),
      auditStatement(db, {
        action: "batch.restore",
        actor: actorOf(ctx.user),
        at,
        entityId: id,
        entityType: "batch",
        ip: ctx.ip,
        summary: `Restored batch ${row.batch_number} of "${displayNameOf(item.name, item.strength)}"`,
      }),
    ],
    restoreConflict(
      "Something changed while restoring. Reload the Trash and try again."
    )
  );
}

// ─── Purge ──────────────────────────────────────────────────────────────────

export async function purgeFromTrash(
  ctx: ProtectedRouteContext,
  type: TrashType,
  id: string
): Promise<void> {
  if (type === "item") {
    await purgeItem(ctx, id);
    return;
  }
  await purgeBatch(ctx, id);
}

async function purgeItem(
  ctx: ProtectedRouteContext,
  id: string
): Promise<void> {
  const { db } = ctx;
  const row = await findItemRow(db, id);
  if (!row || row.deleted_at === null) {
    throw notFound("The trashed item");
  }
  const name = displayNameOf(row.name, row.strength);
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare(
          "DELETE FROM batches WHERE item_id = ? AND EXISTS (SELECT 1 FROM items WHERE id = ? AND deleted_at IS NOT NULL)"
        )
        .bind(id, id),
      db
        .prepare("DELETE FROM items WHERE id = ? AND deleted_at IS NOT NULL")
        .bind(id),
      guardChanged(db, 1),
      auditStatement(db, {
        action: "item.purge",
        actor: actorOf(ctx.user),
        at: ctx.now.toISOString(),
        before: { name },
        entityId: id,
        entityType: "item",
        ip: ctx.ip,
        summary: `Permanently deleted item "${name}"`,
      }),
    ],
    new HttpError("conflict", "The item is no longer in the Trash.")
  );
}

async function purgeBatch(
  ctx: ProtectedRouteContext,
  id: string
): Promise<void> {
  const { db } = ctx;
  const row = await findBatchRow(db, id);
  if (!row || row.deleted_at === null) {
    throw notFound("The trashed batch");
  }
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare("DELETE FROM batches WHERE id = ? AND deleted_at IS NOT NULL")
        .bind(id),
      guardChanged(db, 1),
      auditStatement(db, {
        action: "batch.purge",
        actor: actorOf(ctx.user),
        at: ctx.now.toISOString(),
        before: { batchNumber: row.batch_number, qty: row.qty },
        entityId: id,
        entityType: "batch",
        ip: ctx.ip,
        summary: `Permanently deleted batch ${row.batch_number}`,
      }),
    ],
    new HttpError("conflict", "The batch is no longer in the Trash.")
  );
}
