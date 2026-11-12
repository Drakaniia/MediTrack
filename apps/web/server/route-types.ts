/**
 * The contract between the router (`server/router.ts`) and every route module.
 *
 * A route module exports `RouteDef[]`; `server/routes/registry.ts` concatenates
 * them. The router REFUSES to start if a route has no `access` rule, so a
 * handler can never be reachable unguarded, and `test/permissions-matrix.test.ts`
 * asserts every registered route against spec §4.
 *
 * Imports in `server/` and `shared/` are RELATIVE ONLY — wrangler bundles the
 * Functions with esbuild and does not apply the SPA's `@/…` aliases.
 */

import type { Permission } from "../shared/permissions";
import type { Role } from "../shared/roles";
import type { D1DatabaseLike, Env } from "./env";

/** The signed-in user as the API sees them (never includes the password hash). */
export interface AuthUser {
  displayName: string;
  email: string | null;
  id: string;
  mustChangePassword: boolean;
  role: Role;
  username: string;
}

export interface BaseRouteContext {
  db: D1DatabaseLike;
  env: Env;
  /** Client IP from `CF-Connecting-IP`, when present. */
  ip: string | null;
  /** The request clock. Always use this, never `new Date()`, so tests control time. */
  now: Date;
  /** `:name` segments from the matched path, URI-decoded. */
  params: Record<string, string>;
  query: URLSearchParams;
  request: Request;
  requestId: string;
  /** Hash id of the current session row, or null on public routes. */
  sessionId: string | null;
  url: URL;
}

export interface ProtectedRouteContext extends BaseRouteContext {
  user: AuthUser;
}

export interface PublicRouteContext extends BaseRouteContext {
  /** Present when the caller happens to be signed in, null otherwise. */
  user: AuthUser | null;
}

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface ProtectedRouteDef {
  /**
   * `"authenticated"` = any signed-in user; otherwise the permission required.
   * Checked by the router BEFORE the handler runs.
   */
  access: Permission | "authenticated";
  /** Reachable while `must_change_password` is set. Only `/api/auth/*` should say yes. */
  allowPasswordChangePending?: boolean;
  handler: (ctx: ProtectedRouteContext) => Promise<Response>;
  method: HttpMethod;
  /** e.g. `/api/items/:id`. Static segments win over `:param` segments. */
  path: string;
}

export interface PublicRouteDef {
  access: "public";
  handler: (ctx: PublicRouteContext) => Promise<Response>;
  method: HttpMethod;
  path: string;
}

export type RouteDef = ProtectedRouteDef | PublicRouteDef;
