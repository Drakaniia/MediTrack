import { ok } from "../http";
import { logError } from "../log";
import type { PublicRouteContext, RouteDef } from "../route-types";

const SERVICE_UNAVAILABLE = 503;

/** Liveness plus a `SELECT 1` against D1, for uptime monitors and deploy smoke tests. Public. */
async function health(ctx: PublicRouteContext): Promise<Response> {
  const report = {
    env: ctx.env.APP_ENV ?? "local",
    ok: true,
    time: ctx.now.toISOString(),
  };
  try {
    await ctx.db.prepare("SELECT 1").first();
  } catch (error) {
    logError("Health check could not reach D1", error, {
      requestId: ctx.requestId,
    });
    return ok({ ...report, ok: false }, undefined, {
      status: SERVICE_UNAVAILABLE,
    });
  }
  return ok(report);
}

export const healthRoutes: RouteDef[] = [
  { access: "public", handler: health, method: "GET", path: "/api/health" },
];
