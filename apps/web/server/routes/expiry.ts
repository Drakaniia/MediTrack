import { can } from "../../shared/permissions";
import {
  adjustInputSchema,
  disposalsQuerySchema,
  disposeInputSchema,
  expiryQuerySchema,
  lowStockQuerySchema,
  quarantineQuerySchema,
  thresholdInputSchema,
} from "../../shared/schemas/expiry";
import { ok, parseJson, parseQuery, readPaging } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { adjustBatch } from "../services/expiry/adjust-service";
import { loadExpiryContext } from "../services/expiry/context";
import { listDisposals } from "../services/expiry/disposal-queries";
import { disposeBatch } from "../services/expiry/dispose-service";
import { expirySummary, listExpiry } from "../services/expiry/expiry-queries";
import { listLowStock } from "../services/expiry/low-stock-queries";
import { listQuarantine } from "../services/expiry/quarantine-queries";
import { updateThreshold } from "../services/expiry/threshold-service";

/**
 * Expiry alerts, low stock, quarantine, stock adjustment and disposal (spec §4, §6.2–6.5, §7.2).
 *
 * `GET /api/disposals` is guarded by `reports.view`, a superset of `stock.dispose`: everyone who
 * may write stock off (admin, inventory, pharmacist) can read the log, and so can the health
 * admin, who may see reports but not dispose.
 */

async function expiryList(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, expiryQuerySchema);
  const paging = readPaging(ctx);
  const context = await loadExpiryContext(ctx.db, ctx.now);
  const page = await listExpiry(ctx.db, context, query, paging);
  return ok(page.rows, { ...paging, total: page.total });
}

async function expirySummaryHandler(
  ctx: ProtectedRouteContext
): Promise<Response> {
  const context = await loadExpiryContext(ctx.db, ctx.now);
  return ok(await expirySummary(ctx.db, context));
}

async function lowStockList(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, lowStockQuerySchema);
  const paging = readPaging(ctx);
  const context = await loadExpiryContext(ctx.db, ctx.now);
  const page = await listLowStock(ctx.db, context, query, paging);
  return ok(page.rows, { ...paging, total: page.total });
}

async function threshold(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, thresholdInputSchema);
  return ok(await updateThreshold(ctx, ctx.params.id, input));
}

async function quarantineList(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, quarantineQuerySchema);
  const paging = readPaging(ctx);
  const context = await loadExpiryContext(ctx.db, ctx.now);
  const page = await listQuarantine(ctx.db, context, query, paging, {
    canDispose: can(ctx.user.role, "stock.dispose"),
  });
  return ok(page.rows, { ...paging, total: page.total });
}

async function adjust(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, adjustInputSchema);
  return ok(await adjustBatch(ctx, ctx.params.id, input));
}

async function dispose(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, disposeInputSchema);
  return ok(await disposeBatch(ctx, ctx.params.id, input));
}

async function disposalsList(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, disposalsQuerySchema);
  const paging = readPaging(ctx);
  const context = await loadExpiryContext(ctx.db, ctx.now);
  const page = await listDisposals(ctx.db, context, query, paging);
  return ok(page.rows, { ...paging, total: page.total });
}

export const expiryRoutes: RouteDef[] = [
  {
    access: "inventory.view",
    handler: expiryList,
    method: "GET",
    path: "/api/expiry",
  },
  {
    access: "inventory.view",
    handler: expirySummaryHandler,
    method: "GET",
    path: "/api/expiry/summary",
  },
  {
    access: "inventory.view",
    handler: lowStockList,
    method: "GET",
    path: "/api/low-stock",
  },
  {
    access: "inventory.write",
    handler: threshold,
    method: "PATCH",
    path: "/api/items/:id/threshold",
  },
  {
    access: "inventory.view",
    handler: quarantineList,
    method: "GET",
    path: "/api/quarantine",
  },
  {
    access: "stock.adjust",
    handler: adjust,
    method: "POST",
    path: "/api/batches/:id/adjust",
  },
  {
    access: "stock.dispose",
    handler: dispose,
    method: "POST",
    path: "/api/batches/:id/dispose",
  },
  {
    access: "reports.view",
    handler: disposalsList,
    method: "GET",
    path: "/api/disposals",
  },
];
