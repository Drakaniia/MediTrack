import { auditQuerySchema } from "../../shared/schemas/audit";
import { ok, parseQuery, readPaging } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { queryAuditLog } from "../services/platform/audit-query";
import { loadSettings } from "../settings-store";

/** The audit log (spec §7.9) — `audit.view` (admin, healthcare administrator). Read-only: nothing here writes. */

async function list(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, auditQuerySchema);
  const paging = readPaging(ctx);
  const { facility } = await loadSettings(ctx.db);
  const page = await queryAuditLog(ctx.db, query, paging, facility.timezone);
  return ok(page.items, {
    limit: paging.limit,
    offset: paging.offset,
    total: page.total,
  });
}

export const auditRoutes: RouteDef[] = [
  { access: "audit.view", handler: list, method: "GET", path: "/api/audit" },
];
