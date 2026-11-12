import {
  createBatchInputSchema,
  suggestNumberQuerySchema,
  updateBatchInputSchema,
} from "../../shared/schemas/inventory-input";
import { created, noContent, ok, parseJson, parseQuery } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import {
  deleteBatch,
  getBatch,
  receiveBatch,
  suggestNumberFor,
  updateBatch,
} from "../services/inventory/batch-service";

/** Batches (spec §6.4, §7.3): receive / merge, view, edit details (never qty), soft delete. */

async function receive(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, createBatchInputSchema);
  const result = await receiveBatch(ctx, ctx.params.id, input);
  return result.merged ? ok(result) : created(result);
}

async function detail(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await getBatch(ctx, ctx.params.id));
}

async function update(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, updateBatchInputSchema);
  return ok(await updateBatch(ctx, ctx.params.id, input));
}

async function remove(ctx: ProtectedRouteContext): Promise<Response> {
  await deleteBatch(ctx, ctx.params.id);
  return noContent();
}

async function suggest(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, suggestNumberQuerySchema);
  const batchNumber = await suggestNumberFor(
    ctx,
    query.itemId,
    query.receivedOn
  );
  return ok({ batchNumber });
}

export const batchRoutes: RouteDef[] = [
  {
    access: "inventory.write",
    handler: receive,
    method: "POST",
    path: "/api/items/:id/batches",
  },
  {
    access: "inventory.view",
    handler: suggest,
    method: "GET",
    path: "/api/batches/suggest-number",
  },
  {
    access: "inventory.view",
    handler: detail,
    method: "GET",
    path: "/api/batches/:id",
  },
  {
    access: "inventory.write",
    handler: update,
    method: "PATCH",
    path: "/api/batches/:id",
  },
  {
    access: "inventory.delete",
    handler: remove,
    method: "DELETE",
    path: "/api/batches/:id",
  },
];
