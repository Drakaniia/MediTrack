import {
  bulkImportInputSchema,
  categoryInputSchema,
  createItemInputSchema,
  deleteCategoryQuerySchema,
  fefoQuerySchema,
  listItemsQuerySchema,
  updateCategoryInputSchema,
  updateItemInputSchema,
} from "../../shared/schemas/inventory-input";
import {
  created,
  noContent,
  ok,
  parseJson,
  parseQuery,
  readPaging,
} from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { bulkImport } from "../services/inventory/bulk-service";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "../services/inventory/category-service";
import {
  createItem,
  deleteItem,
  itemHistory,
  updateItem,
} from "../services/inventory/item-service";
import { findLiveItemRow, notFound } from "../services/inventory/lookups";
import {
  loadFefoList,
  loadItemDetail,
  loadItemSummaries,
  readContextFor,
} from "../services/inventory/read-models";

/**
 * Items, categories, the facility FEFO list and bulk import (spec §6.2–6.5, §7.2).
 * Quantities are never accepted here after creation: stock changes belong to EXP / REQ.
 */

async function list(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, listItemsQuerySchema);
  const paging = readPaging(ctx);
  const rc = await readContextFor(ctx.db, ctx.now);
  const page = await loadItemSummaries(ctx.db, rc, {
    ...query,
    limit: paging.limit,
    offset: paging.offset,
  });
  return ok(page.items, {
    limit: paging.limit,
    offset: paging.offset,
    total: page.total,
  });
}

async function create(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, createItemInputSchema);
  return created(await createItem(ctx, input));
}

async function bulk(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, bulkImportInputSchema);
  const result = await bulkImport(ctx, input);
  return input.dryRun ? ok(result) : created(result);
}

async function detail(ctx: ProtectedRouteContext): Promise<Response> {
  const rc = await readContextFor(ctx.db, ctx.now);
  const item = await loadItemDetail(ctx.db, rc, ctx.params.id);
  if (!item) {
    throw notFound("The item");
  }
  return ok(item);
}

async function update(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, updateItemInputSchema);
  return ok(await updateItem(ctx, ctx.params.id, input));
}

async function remove(ctx: ProtectedRouteContext): Promise<Response> {
  await deleteItem(ctx, ctx.params.id);
  return noContent();
}

async function history(ctx: ProtectedRouteContext): Promise<Response> {
  await findLiveItemRow(ctx.db, ctx.params.id);
  const paging = readPaging(ctx);
  const page = await itemHistory(ctx.db, ctx.params.id, paging);
  return ok(page.entries, {
    limit: paging.limit,
    offset: paging.offset,
    total: page.total,
  });
}

async function itemFefo(ctx: ProtectedRouteContext): Promise<Response> {
  const rc = await readContextFor(ctx.db, ctx.now);
  const item = await loadItemDetail(ctx.db, rc, ctx.params.id);
  if (!item) {
    throw notFound("The item");
  }
  return ok(item.batches.filter((batch) => batch.fefoRank !== null));
}

async function facilityFefo(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, fefoQuerySchema);
  const paging = readPaging(ctx, 200);
  const rc = await readContextFor(ctx.db, ctx.now);
  const entries = await loadFefoList(ctx.db, rc, {
    categoryId: query.categoryId,
    limit: paging.limit,
  });
  return ok(entries, { limit: paging.limit, total: entries.length });
}

async function categories(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await listCategories(ctx.db));
}

async function categoryCreate(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, categoryInputSchema);
  return created(await createCategory(ctx, input));
}

async function categoryUpdate(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, updateCategoryInputSchema);
  return ok(await updateCategory(ctx, ctx.params.id, input));
}

async function categoryDelete(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, deleteCategoryQuerySchema);
  await deleteCategory(ctx, ctx.params.id, query.reassignTo);
  return noContent();
}

export const itemRoutes: RouteDef[] = [
  {
    access: "inventory.view",
    handler: list,
    method: "GET",
    path: "/api/items",
  },
  {
    access: "inventory.write",
    handler: create,
    method: "POST",
    path: "/api/items",
  },
  {
    access: "inventory.write",
    handler: bulk,
    method: "POST",
    path: "/api/items/bulk",
  },
  {
    access: "inventory.view",
    handler: detail,
    method: "GET",
    path: "/api/items/:id",
  },
  {
    access: "inventory.write",
    handler: update,
    method: "PATCH",
    path: "/api/items/:id",
  },
  {
    access: "inventory.delete",
    handler: remove,
    method: "DELETE",
    path: "/api/items/:id",
  },
  {
    access: "inventory.view",
    handler: history,
    method: "GET",
    path: "/api/items/:id/history",
  },
  {
    access: "inventory.view",
    handler: itemFefo,
    method: "GET",
    path: "/api/items/:id/fefo",
  },
  {
    access: "inventory.view",
    handler: facilityFefo,
    method: "GET",
    path: "/api/fefo",
  },
  {
    access: "inventory.view",
    handler: categories,
    method: "GET",
    path: "/api/categories",
  },
  {
    access: "inventory.write",
    handler: categoryCreate,
    method: "POST",
    path: "/api/categories",
  },
  {
    access: "inventory.write",
    handler: categoryUpdate,
    method: "PATCH",
    path: "/api/categories/:id",
  },
  {
    access: "inventory.write",
    handler: categoryDelete,
    method: "DELETE",
    path: "/api/categories/:id",
  },
];
