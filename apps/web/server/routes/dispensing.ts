import {
  dispensingListQuerySchema,
  monthlyQuerySchema,
  quickDeductInputSchema,
} from "../../shared/schemas/requests";
import { created, ok, parseJson, parseQuery, readPaging } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import {
  listDispensing,
  monthlyDispensing,
} from "../services/requests/dispensing-queries";
import {
  quickDeduct,
  undoQuickDeduct,
} from "../services/requests/quick-deduct-service";

/** Dispensing log (per batch), monthly totals, Quick Deduct and its undo (spec §7.5). */

async function list(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, dispensingListQuerySchema);
  const paging = readPaging(ctx);
  const page = await listDispensing(ctx.db, query, paging, ctx.now);
  return ok(page.records, { ...paging, total: page.total });
}

async function monthly(ctx: ProtectedRouteContext): Promise<Response> {
  const { month } = parseQuery(ctx, monthlyQuerySchema);
  return ok(await monthlyDispensing(ctx.db, month, ctx.now));
}

async function deduct(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, quickDeductInputSchema);
  return created(await quickDeduct(ctx, input));
}

async function undo(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await undoQuickDeduct(ctx, ctx.params.recordId));
}

export const dispensingRoutes: RouteDef[] = [
  {
    access: "dispensing.view",
    handler: list,
    method: "GET",
    path: "/api/dispensing",
  },
  {
    access: "dispensing.view",
    handler: monthly,
    method: "GET",
    path: "/api/dispensing/monthly",
  },
  {
    access: "stock.quick_deduct",
    handler: deduct,
    method: "POST",
    path: "/api/quick-deduct",
  },
  {
    access: "stock.quick_deduct",
    handler: undo,
    method: "POST",
    path: "/api/quick-deduct/:recordId/undo",
  },
];
