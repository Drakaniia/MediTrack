import {
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from "../../shared/schemas/alerts";
import { noContent, ok, parseJson } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import {
  getPushConfig,
  listSubscriptions,
  removeSubscription,
  subscribe,
  unsubscribe,
} from "../services/alerts-read/push-service";

/**
 * Web Push client side: the public key, and the caller's own device subscriptions.
 * Subscriptions are not privileged data (no audit rows), but they only ever belong to
 * and are only ever visible to the signed-in user.
 */

async function config(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await getPushConfig(ctx.db, ctx.env));
}

async function subscribeDevice(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, pushSubscribeSchema);
  return ok(await subscribe(ctx.db, ctx.user.id, input, ctx.now));
}

async function unsubscribeDevice(
  ctx: ProtectedRouteContext
): Promise<Response> {
  const { endpoint } = await parseJson(ctx, pushUnsubscribeSchema);
  return ok({ removed: await unsubscribe(ctx.db, ctx.user.id, endpoint) });
}

async function list(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await listSubscriptions(ctx.db, ctx.user.id));
}

async function removeDevice(ctx: ProtectedRouteContext): Promise<Response> {
  await removeSubscription(ctx.db, ctx.user.id, ctx.params.id);
  return noContent();
}

export const pushRoutes: RouteDef[] = [
  {
    access: "alerts.view",
    handler: config,
    method: "GET",
    path: "/api/push/config",
  },
  {
    access: "alerts.view",
    handler: subscribeDevice,
    method: "POST",
    path: "/api/push/subscribe",
  },
  {
    access: "alerts.view",
    handler: unsubscribeDevice,
    method: "POST",
    path: "/api/push/unsubscribe",
  },
  {
    access: "alerts.view",
    handler: list,
    method: "GET",
    path: "/api/push/subscriptions",
  },
  {
    access: "alerts.view",
    handler: removeDevice,
    method: "DELETE",
    path: "/api/push/subscriptions/:id",
  },
];
