import { dashboardQuerySchema } from "../../shared/schemas/dashboard";
import { ok, parseQuery } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { loadDashboard } from "../services/dashboard/dashboard-service";

/** The home dashboard (spec §7.1). Which cards come back depends on the caller's role. */
async function dashboard(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, dashboardQuerySchema);
  return ok(
    await loadDashboard(ctx.db, {
      month: query.month,
      now: ctx.now,
      role: ctx.user.role,
    })
  );
}

export const dashboardRoutes: RouteDef[] = [
  {
    access: "dashboard.view",
    handler: dashboard,
    method: "GET",
    path: "/api/dashboard",
  },
];
