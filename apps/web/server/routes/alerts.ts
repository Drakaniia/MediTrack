import {
  alertsQuerySchema,
  NOTIFICATIONS_DEFAULT_LIMIT,
} from "../../shared/schemas/alerts";
import { ok, parseQuery, readPaging } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { loadBanner } from "../services/alerts-read/banner-queries";
import {
  listMeta,
  listNotifications,
} from "../services/alerts-read/notification-queries";
import {
  dismiss,
  markAllRead,
  markRead,
} from "../services/alerts-read/notification-state";

/**
 * Notification centre and dashboard banner (spec §7.6). Every role may read and manage
 * ITS OWN read/dismissed state; the rows themselves are written by the alert generator
 * (CRON slice). `alerts.view` is held by every role, so there is no finer check to make.
 */

async function list(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, alertsQuerySchema);
  const paging = readPaging(ctx, NOTIFICATIONS_DEFAULT_LIMIT);
  const page = await listNotifications(ctx.db, ctx.user.id, query, paging);
  return ok(page.rows, await listMeta(ctx.db, ctx.user.id, page, paging));
}

async function banner(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await loadBanner(ctx.db, ctx.user.id, ctx.now));
}

async function readAll(ctx: ProtectedRouteContext): Promise<Response> {
  const marked = await markAllRead(ctx.db, ctx.user.id, ctx.now);
  return ok({ marked });
}

async function read(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await markRead(ctx.db, ctx.user.id, ctx.params.id, ctx.now));
}

async function dismissOne(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await dismiss(ctx.db, ctx.user.id, ctx.params.id, ctx.now));
}

export const alertRoutes: RouteDef[] = [
  { access: "alerts.view", handler: list, method: "GET", path: "/api/alerts" },
  {
    access: "alerts.view",
    handler: banner,
    method: "GET",
    path: "/api/alerts/banner",
  },
  {
    access: "alerts.view",
    handler: readAll,
    method: "POST",
    path: "/api/alerts/read-all",
  },
  {
    access: "alerts.view",
    handler: read,
    method: "POST",
    path: "/api/alerts/:id/read",
  },
  {
    access: "alerts.view",
    handler: dismissOne,
    method: "POST",
    path: "/api/alerts/:id/dismiss",
  },
];
