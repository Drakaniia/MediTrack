/** `PATCH /api/items/:id/threshold` — the low-stock threshold, a narrow write separate from `PATCH /items/:id`. */

import type {
  ThresholdInput,
  ThresholdResultDto,
} from "../../../shared/schemas/expiry";
import { actorOf, auditStatement } from "../../audit";
import { batchOrConflict, guardChanged } from "../../guards";
import { HttpError } from "../../http";
import type { ProtectedRouteContext } from "../../route-types";
import { displayName } from "./sql";

interface ThresholdItemRow {
  low_stock_threshold: number;
  name: string;
  strength: string;
}

function itemGone(): HttpError {
  return new HttpError("not_found", "The item was not found.");
}

export async function updateThreshold(
  ctx: ProtectedRouteContext,
  itemId: string,
  input: ThresholdInput
): Promise<ThresholdResultDto> {
  const { db } = ctx;
  const item = await db
    .prepare(
      "SELECT name, strength, low_stock_threshold FROM items WHERE id = ? AND deleted_at IS NULL"
    )
    .bind(itemId)
    .first<ThresholdItemRow>();
  if (!item) {
    throw itemGone();
  }
  const previous = item.low_stock_threshold;
  const next = input.lowStockThreshold;
  if (previous === next) {
    return { itemId, lowStockThreshold: next, previous };
  }
  const at = ctx.now.toISOString();
  const name = displayName(item.name, item.strength);
  await batchOrConflict(
    db,
    [
      db
        .prepare(
          "UPDATE items SET low_stock_threshold = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
        )
        .bind(next, at, itemId),
      guardChanged(db, 1),
      auditStatement(db, {
        action: "item.threshold",
        actor: actorOf(ctx.user),
        after: { lowStockThreshold: next },
        at,
        before: { lowStockThreshold: previous },
        entityId: itemId,
        entityType: "item",
        ip: ctx.ip,
        summary: `Changed low-stock threshold of "${name}" from ${previous} to ${next}`,
      }),
    ],
    itemGone()
  );
  return { itemId, lowStockThreshold: next, previous };
}
