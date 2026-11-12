/**
 * The API entry point: `handleApi(request, env)` is the only function the Pages
 * Function calls, and the only one tests need. Pipeline, in order:
 *
 *   1. not under /api/                 → 404 JSON
 *   2. route match                     → unknown path 404 · wrong method 405 + Allow
 *   3. unsafe method                   → CSRF check (header + Origin / Sec-Fetch-Site)
 *   4. protected route                 → session cookie → 401 · must-change-password gate
 *                                        → 403 · `access` permission → 403 forbidden
 *      public route                    → session resolved opportunistically, never fatal
 *   5. handler                         → HttpError → JSON error · anything else → logged,
 *                                        generic 500 (internals never leak)
 *   6. every response                  → security headers, x-request-id, Retry-After
 *
 * All permission logic lives HERE and in the route's `access`; handlers only add finer
 * rules ("your own request") on top.
 */

import { can } from "../shared/permissions";
import { checkCsrf, isUnsafeMethod } from "./auth/csrf";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  isSecureRequest,
  type ResolvedSession,
  readSessionToken,
  requirePepper,
  resolveSession,
} from "./auth/session";
import type { Env } from "./env";
import { errorResponse, HttpError } from "./http";
import { newId } from "./ids";
import { logError, logWarn } from "./log";
import type {
  AuthUser,
  BaseRouteContext,
  ProtectedRouteDef,
  PublicRouteDef,
  RouteDef,
} from "./route-types";
import { compileRoutes, type Router } from "./router";

export interface ApiDeps {
  /** The request clock. Tests inject a fake one; production uses the real time. */
  now?: () => Date;
  /** Route table. Defaults to `ALL_ROUTES` from `routes/registry.ts`. */
  routes?: RouteDef[];
}

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

const MAX_IP_LENGTH = 64;
const SIGN_IN_MESSAGE = "Sign in to continue.";
const SESSION_ENDED_MESSAGE = "Your session has ended. Sign in again.";
const INTERNAL_MESSAGE = "Something went wrong on our side. Please try again.";

type Auth =
  | { kind: "anonymous" }
  | { kind: "invalid" }
  | { kind: "signed_in"; session: ResolvedSession; token: string };

interface Match {
  params: Record<string, string>;
  route: RouteDef;
}

interface Scope {
  env: Env;
  now: Date;
  request: Request;
  requestId: string;
  secure: boolean;
  url: URL;
}

const routerCache = new WeakMap<readonly RouteDef[], Router>();

/**
 * Imported lazily so that tests (and the platform's own suites) which pass an explicit
 * route table never load every slice's module. esbuild inlines it for the Pages bundle.
 */
async function loadDefaultRoutes(): Promise<RouteDef[]> {
  const { ALL_ROUTES } = await import("./routes/registry");
  return ALL_ROUTES;
}

async function routerFor(deps: ApiDeps): Promise<Router> {
  const routes = deps.routes ?? (await loadDefaultRoutes());
  const cached = routerCache.get(routes);
  if (cached) {
    return cached;
  }
  const compiled = compileRoutes(routes);
  routerCache.set(routes, compiled);
  return compiled;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function clientIp(request: Request): string | null {
  const value = request.headers.get("cf-connecting-ip")?.trim();
  return value ? value.slice(0, MAX_IP_LENGTH) : null;
}

// ─── Response helpers ───────────────────────────────────────────────────────

function withHeader(response: Response, name: string, value: string): Response {
  const headers = new Headers(response.headers);
  headers.append(name, value);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function finalize(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function retryAfterOf(error: HttpError): number | null {
  const { details } = error;
  if (typeof details !== "object" || details === null) {
    return null;
  }
  const seconds = (details as { retryAfterSeconds?: unknown })
    .retryAfterSeconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : null;
}

function httpErrorResponse(error: HttpError): Response {
  const response = errorResponse(error);
  const retryAfter = retryAfterOf(error);
  if (retryAfter !== null) {
    response.headers.set("retry-after", String(retryAfter));
  }
  return response;
}

function methodNotAllowed(allow: readonly string[]): Response {
  const response = errorResponse(
    new HttpError("method_not_allowed", "That method is not allowed here.")
  );
  response.headers.set("allow", allow.join(", "));
  return response;
}

function failureResponse(error: unknown, scope: Scope): Response {
  if (error instanceof HttpError) {
    return httpErrorResponse(error);
  }
  logError("Unhandled error in API route", error, {
    method: scope.request.method,
    path: scope.url.pathname,
    requestId: scope.requestId,
  });
  return errorResponse(new HttpError("internal_error", INTERNAL_MESSAGE));
}

/** Re-issues the cookie when the session's idle expiry just slid (never over a cookie the handler set). */
function withRefreshedCookie(
  response: Response,
  auth: Auth,
  secure: boolean
): Response {
  if (
    auth.kind !== "signed_in" ||
    !auth.session.refreshed ||
    response.headers.has("set-cookie")
  ) {
    return response;
  }
  return withHeader(
    response,
    "set-cookie",
    buildSessionCookie(auth.token, {
      maxAgeSeconds: auth.session.maxAgeSeconds,
      secure,
    })
  );
}

// ─── Authentication ─────────────────────────────────────────────────────────

async function authenticate(scope: Scope): Promise<Auth> {
  const token = readSessionToken(scope.request);
  if (token === null) {
    return { kind: "anonymous" };
  }
  const session = await resolveSession(
    scope.env.DB,
    token,
    requirePepper(scope.env),
    scope.now
  );
  return session ? { kind: "signed_in", session, token } : { kind: "invalid" };
}

/** Public routes never fail because of the session: a broken lookup just means "signed out". */
async function authenticateLoosely(scope: Scope): Promise<Auth> {
  try {
    return await authenticate(scope);
  } catch (error) {
    logWarn("Session lookup failed on a public route", error, {
      path: scope.url.pathname,
      requestId: scope.requestId,
    });
    return { kind: "anonymous" };
  }
}

function assertMayProceed(user: AuthUser, route: ProtectedRouteDef): void {
  if (user.mustChangePassword && !route.allowPasswordChangePending) {
    throw new HttpError(
      "password_change_required",
      "You must choose a new password before continuing."
    );
  }
  if (route.access !== "authenticated" && !can(user.role, route.access)) {
    throw new HttpError("forbidden", "Your role does not allow this action.");
  }
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

function baseContext(
  scope: Scope,
  match: Match,
  sessionId: string | null
): BaseRouteContext {
  return {
    db: scope.env.DB,
    env: scope.env,
    ip: clientIp(scope.request),
    now: scope.now,
    params: match.params,
    query: scope.url.searchParams,
    request: scope.request,
    requestId: scope.requestId,
    sessionId,
    url: scope.url,
  };
}

async function runPublic(
  scope: Scope,
  match: Match,
  route: PublicRouteDef
): Promise<Response> {
  const auth = await authenticateLoosely(scope);
  const session = auth.kind === "signed_in" ? auth.session : null;
  const response = await route.handler({
    ...baseContext(scope, match, session?.sessionId ?? null),
    user: session?.user ?? null,
  });
  return withRefreshedCookie(response, auth, scope.secure);
}

async function runProtected(
  scope: Scope,
  match: Match,
  route: ProtectedRouteDef
): Promise<Response> {
  const auth = await authenticate(scope);
  if (auth.kind === "anonymous") {
    throw new HttpError("unauthenticated", SIGN_IN_MESSAGE);
  }
  if (auth.kind === "invalid") {
    return withHeader(
      httpErrorResponse(
        new HttpError("unauthenticated", SESSION_ENDED_MESSAGE)
      ),
      "set-cookie",
      buildClearedSessionCookie({ secure: scope.secure })
    );
  }
  const { session } = auth;
  assertMayProceed(session.user, route);
  const response = await route.handler({
    ...baseContext(scope, match, session.sessionId),
    user: session.user,
  });
  return withRefreshedCookie(response, auth, scope.secure);
}

function execute(scope: Scope, match: Match): Promise<Response> {
  if (isUnsafeMethod(scope.request.method)) {
    checkCsrf(scope.request);
  }
  const { route } = match;
  return route.access === "public"
    ? runPublic(scope, match, route)
    : runProtected(scope, match, route);
}

async function respond(
  request: Request,
  env: Env,
  deps: ApiDeps,
  requestId: string
): Promise<Response> {
  const url = new URL(request.url);
  if (!isApiPath(url.pathname)) {
    return errorResponse(new HttpError("not_found", "Not found."));
  }
  // The one place the wall clock is read; everything below uses `ctx.now`.
  const now = deps.now?.() ?? new Date();
  const scope: Scope = {
    env,
    now,
    request,
    requestId,
    secure: isSecureRequest(request),
    url,
  };
  try {
    const router = await routerFor(deps);
    const lookup = router.lookup(request.method, url.pathname);
    if (lookup.kind === "not_found") {
      return errorResponse(new HttpError("not_found", "No such API route."));
    }
    if (lookup.kind === "method_not_allowed") {
      return methodNotAllowed(lookup.allow);
    }
    return await execute(scope, lookup);
  } catch (error) {
    return failureResponse(error, scope);
  }
}

/** Handles one request. Never throws: every failure becomes a JSON error response. */
export async function handleApi(
  request: Request,
  env: Env,
  deps: ApiDeps = {}
): Promise<Response> {
  const requestId = newId();
  return finalize(await respond(request, env, deps, requestId), requestId);
}
