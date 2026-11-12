/** Categories: list with live item counts, create, rename / reorder, delete (or reassign). */

import type { CategoryDto } from "../../../shared/schemas/inventory";
import type {
  CategoryInput,
  UpdateCategoryInput,
} from "../../../shared/schemas/inventory-input";
import { actorOf, auditStatement } from "../../audit";
import type { D1DatabaseLike } from "../../env";
import { guardChanged } from "../../guards";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import { categoryExists, notFound } from "./lookups";
import { commitInventoryBatch, validationFailure } from "./statements";

interface CategoryRow {
  id: string;
  item_count: number;
  name: string;
  sort_order: number;
}

const LIST_SQL =
  "SELECT c.id, c.name, c.sort_order, COUNT(i.id) AS item_count FROM categories c LEFT JOIN items i ON i.category_id = c.id AND i.deleted_at IS NULL GROUP BY c.id ORDER BY c.sort_order, c.name_lower";

function toDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    itemCount: row.item_count,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

export async function listCategories(
  db: D1DatabaseLike
): Promise<CategoryDto[]> {
  const { results } = await db.prepare(LIST_SQL).all<CategoryRow>();
  return results.map(toDto);
}

async function readCategory(
  db: D1DatabaseLike,
  id: string
): Promise<CategoryDto> {
  const row = (await db.prepare(LIST_SQL).all<CategoryRow>()).results.find(
    (candidate) => candidate.id === id
  );
  if (!row) {
    throw notFound("The category");
  }
  return toDto(row);
}

async function assertNameFree(
  db: D1DatabaseLike,
  name: string,
  excludeId = ""
): Promise<void> {
  const clash = await db
    .prepare("SELECT id FROM categories WHERE name_lower = ? AND id <> ?")
    .bind(name.toLowerCase(), excludeId)
    .first<{ id: string }>();
  if (clash) {
    throw new HttpError(
      "conflict",
      "A category with this name already exists.",
      {
        existingCategoryId: clash.id,
      }
    );
  }
}

export async function createCategory(
  ctx: ProtectedRouteContext,
  input: CategoryInput
): Promise<CategoryDto> {
  const { db } = ctx;
  await assertNameFree(db, input.name);
  const id = newId();
  const at = ctx.now.toISOString();
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare(
          "INSERT INTO categories (id, name, name_lower, sort_order, created_at) VALUES (?, ?, ?, COALESCE(?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories)), ?)"
        )
        .bind(
          id,
          input.name,
          input.name.toLowerCase(),
          input.sortOrder ?? null,
          at
        ),
      auditStatement(db, {
        action: "category.create",
        actor: actorOf(ctx.user),
        after: { name: input.name },
        at,
        entityId: id,
        entityType: "category",
        ip: ctx.ip,
        summary: `Created category "${input.name}"`,
      }),
    ],
    new HttpError("conflict", "A category with this name already exists.")
  );
  return await readCategory(db, id);
}

export async function updateCategory(
  ctx: ProtectedRouteContext,
  id: string,
  input: UpdateCategoryInput
): Promise<CategoryDto> {
  const { db } = ctx;
  const current = await readCategory(db, id);
  const name = input.name ?? current.name;
  const sortOrder = input.sortOrder ?? current.sortOrder ?? 0;
  if (name === current.name && sortOrder === current.sortOrder) {
    return current;
  }
  await assertNameFree(db, name, id);
  const at = ctx.now.toISOString();
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare(
          "UPDATE categories SET name = ?, name_lower = ?, sort_order = ? WHERE id = ?"
        )
        .bind(name, name.toLowerCase(), sortOrder, id),
      guardChanged(db, 1),
      auditStatement(db, {
        action: "category.update",
        actor: actorOf(ctx.user),
        after: { name, sortOrder },
        at,
        before: { name: current.name, sortOrder: current.sortOrder },
        entityId: id,
        entityType: "category",
        ip: ctx.ip,
        summary: `Edited category "${current.name}"`,
      }),
    ],
    new HttpError("conflict", "The category changed while you were editing it.")
  );
  return await readCategory(db, id);
}

/** `reassignTo`: another category id, or `"none"` to leave the items uncategorised. */
export async function deleteCategory(
  ctx: ProtectedRouteContext,
  id: string,
  reassignTo: string | undefined
): Promise<void> {
  const { db } = ctx;
  const current = await readCategory(db, id);
  const liveItems = current.itemCount ?? 0;
  if (liveItems > 0 && reassignTo === undefined) {
    throw new HttpError(
      "conflict",
      `${liveItems} item(s) still use this category. Choose another category for them first.`,
      { itemCount: liveItems }
    );
  }
  let target: string | null = null;
  if (reassignTo !== undefined && reassignTo !== "none") {
    if (reassignTo === id || !(await categoryExists(db, reassignTo))) {
      throw validationFailure([
        {
          message: "Choose a different, existing category.",
          path: "reassignTo",
        },
      ]);
    }
    target = reassignTo;
  }
  const at = ctx.now.toISOString();
  await commitInventoryBatch(
    db,
    () => [
      db
        .prepare("UPDATE items SET category_id = ? WHERE category_id = ?")
        .bind(target, id),
      db.prepare("DELETE FROM categories WHERE id = ?").bind(id),
      guardChanged(db, 1),
      auditStatement(db, {
        action: "category.delete",
        actor: actorOf(ctx.user),
        at,
        before: { itemCount: liveItems, name: current.name },
        entityId: id,
        entityType: "category",
        ip: ctx.ip,
        summary: `Deleted category "${current.name}"`,
      }),
    ],
    new HttpError(
      "conflict",
      "The category changed while you were deleting it."
    )
  );
}
