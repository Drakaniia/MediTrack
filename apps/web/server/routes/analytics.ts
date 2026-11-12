import { analyticsQuerySchema } from "../../shared/schemas/analytics";
import { ok, parseQuery } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { loadAnalytics } from "../services/analytics/analytics-service";

/** Analytics widgets (spec §7.7): `?from=&to=&categoryId=`, default the last 30 facility days. */
async function analytics(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, analyticsQuerySchema);
  return ok(await loadAnalytics(ctx.db, { now: ctx.now, query }));
}

export const analyticsRoutes: RouteDef[] = [
  {
    access: "analytics.view",
    handler: analytics,
    method: "GET",
    path: "/api/analytics",
  },
];
