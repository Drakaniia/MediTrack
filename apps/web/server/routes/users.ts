import { MAX_PAGE_SIZE } from "../../shared/api";
import {
  createUserInputSchema,
  listUsersQuerySchema,
  updateUserInputSchema,
} from "../../shared/schemas/users";
import { created, ok, parseJson, parseQuery, readPaging } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import {
  createUserAccount,
  disableUserAccount,
  enableUserAccount,
  listUsers,
  resetUserPassword,
  updateUserAccount,
} from "../services/platform/users";

/**
 * User management (spec §4, §7.10) — `users.manage` (admin) on every route. Users are never
 * deleted; see `services/platform/users.ts` for the last-admin and self-lockout rules.
 */

async function list(ctx: ProtectedRouteContext): Promise<Response> {
  const query = parseQuery(ctx, listUsersQuerySchema);
  const paging = readPaging(ctx, MAX_PAGE_SIZE);
  const page = await listUsers(ctx.db, query, paging);
  return ok(page.items, {
    limit: paging.limit,
    offset: paging.offset,
    total: page.total,
  });
}

async function create(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, createUserInputSchema);
  return created(await createUserAccount(ctx, input));
}

async function update(ctx: ProtectedRouteContext): Promise<Response> {
  const input = await parseJson(ctx, updateUserInputSchema);
  return ok(await updateUserAccount(ctx, ctx.params.id, input));
}

async function disable(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await disableUserAccount(ctx, ctx.params.id));
}

async function enable(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await enableUserAccount(ctx, ctx.params.id));
}

async function resetPassword(ctx: ProtectedRouteContext): Promise<Response> {
  return ok(await resetUserPassword(ctx, ctx.params.id));
}

export const userRoutes: RouteDef[] = [
  { access: "users.manage", handler: list, method: "GET", path: "/api/users" },
  {
    access: "users.manage",
    handler: create,
    method: "POST",
    path: "/api/users",
  },
  {
    access: "users.manage",
    handler: update,
    method: "PATCH",
    path: "/api/users/:id",
  },
  {
    access: "users.manage",
    handler: disable,
    method: "POST",
    path: "/api/users/:id/disable",
  },
  {
    access: "users.manage",
    handler: enable,
    method: "POST",
    path: "/api/users/:id/enable",
  },
  {
    access: "users.manage",
    handler: resetPassword,
    method: "POST",
    path: "/api/users/:id/reset-password",
  },
];
