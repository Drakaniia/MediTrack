import { scanQuerySchema } from "../../shared/schemas/scan";
import { ok, parseQuery } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { resolveScan } from "../services/scan/resolve";

/**
 * `GET /api/scan?code=` (spec §7.3): resolve a scanned or typed code to a batch, an item or a
 * list of candidate items. Read-only and high volume, so it is NOT written to the audit log.
 */
async function scan(ctx: ProtectedRouteContext): Promise<Response> {
  const { code } = parseQuery(ctx, scanQuerySchema);
  return ok(await resolveScan(ctx, code));
}

export const scanRoutes: RouteDef[] = [
  {
    access: "scan.use",
    handler: scan,
    method: "GET",
    path: "/api/scan",
  },
];
