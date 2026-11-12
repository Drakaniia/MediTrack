import {
  cancelInputSchema,
  createRequestsInputSchema,
  dispenseInputSchema,
  reorderInputSchema,
  requestListQuerySchema,
  transitionInputSchema,
  updateRequestInputSchema,
} from "../../shared/schemas/requests";
import { created, ok, parseJson, parseQuery } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import {
  archiveClaimed,
  cancelRequest,
  reorderRequests,
  transitionRequest,
  updateRequest,
} from "../services/requests/board-service";
import { createRequests } from "../services/requests/create-service";
import { dispenseRequest } from "../services/requests/queue-dispense";
import { listRequests } from "../services/requests/request-list";
import { loadRequestDto } from "../services/requests/request-read";

/**
 * The request queue (spec §7.4). `requests.create` guards the routes the requester may use on
 * their own request (edit, cancel); the handler adds the "own request or requests.process" check.
 */

async function list(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, requestListQuerySchema);
  const page = await listRequests(ctx.db, query, ctx.user.id, ctx.now);
  return ok(page.requests, {
    limit: query.limit,
    offset: 0,
    total: page.total,
  });
}

async function create(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, createRequestsInputSchema);
  return created(await createRequests(ctx, input));
}

async function detail(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await loadRequestDto(ctx.db, ctx.params.id, ctx.now));
}

async function update(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, updateRequestInputSchema);
  return ok(await updateRequest(ctx, ctx.params.id, input));
}

async function transition(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, transitionInputSchema);
  return ok(await transitionRequest(ctx, ctx.params.id, input));
}

async function dispense(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, dispenseInputSchema);
  return ok(await dispenseRequest(ctx, ctx.params.id, input));
}

async function cancel(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, cancelInputSchema);
  return ok(await cancelRequest(ctx, ctx.params.id, input));
}

async function reorder(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, reorderInputSchema);
  return ok(await reorderRequests(ctx, input));
}

async function archive(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await archiveClaimed(ctx));
}

export const requestRoutes: RouteDef[] = [
  {
    access: "requests.view",
    handler: list,
    method: "GET",
    path: "/api/requests",
  },
  {
    access: "requests.create",
    handler: create,
    method: "POST",
    path: "/api/requests",
  },
  {
    access: "requests.process",
    handler: reorder,
    method: "POST",
    path: "/api/requests/reorder",
  },
  {
    access: "requests.process",
    handler: archive,
    method: "POST",
    path: "/api/requests/archive-claimed",
  },
  {
    access: "requests.view",
    handler: detail,
    method: "GET",
    path: "/api/requests/:id",
  },
  {
    access: "requests.create",
    handler: update,
    method: "PATCH",
    path: "/api/requests/:id",
  },
  {
    access: "requests.process",
    handler: transition,
    method: "POST",
    path: "/api/requests/:id/transition",
  },
  {
    access: "requests.process",
    handler: dispense,
    method: "POST",
    path: "/api/requests/:id/dispense",
  },
  {
    access: "requests.create",
    handler: cancel,
    method: "POST",
    path: "/api/requests/:id/cancel",
  },
];
