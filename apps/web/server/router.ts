/**
 * Route table compilation and matching (ARCHITECTURE.md §5).
 *
 * `compileRoutes(defs)` validates the table at startup — a route without a valid `access`
 * rule, a malformed path or a duplicate method+path THROWS, so an unguarded or ambiguous
 * route can never be served. `lookup()` then answers one of three things: the matched
 * route (with URI-decoded `:param` values), `method_not_allowed` (the path exists under
 * other methods) or `not_found`.
 *
 * Precedence when several patterns match one path: more STATIC segments win, and a static
 * segment further left beats one further right. So `/api/items/bulk` beats
 * `/api/items/:id`, whatever order the modules are registered in.
 */

import { isPermission } from "../shared/permissions";
import type { HttpMethod, RouteDef } from "./route-types";

const HTTP_METHODS: readonly string[] = [
  "DELETE",
  "GET",
  "PATCH",
  "POST",
  "PUT",
];
const API_PREFIX = "/api/";
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const STATIC_SEGMENT_FORBIDDEN = /[:*?#]/;

type Segment =
  | { kind: "param"; name: string }
  | { kind: "static"; value: string };

interface CompiledRoute {
  def: RouteDef;
  segments: Segment[];
  staticCount: number;
}

export type RouteLookup =
  | { kind: "found"; params: Record<string, string>; route: RouteDef }
  | { allow: HttpMethod[]; kind: "method_not_allowed" }
  | { kind: "not_found" };

export interface Router {
  lookup: (method: string, pathname: string) => RouteLookup;
  routes: readonly RouteDef[];
}

function describe(def: RouteDef): string {
  return `${String(def.method)} ${String(def.path)}`;
}

function assertValidAccess(def: RouteDef): void {
  const access: unknown = def.access;
  if (
    access === "public" ||
    access === "authenticated" ||
    isPermission(access)
  ) {
    return;
  }
  throw new Error(
    `Route ${describe(def)} has no valid "access" rule (got ${String(access)}). Declare a permission, "authenticated" or "public".`
  );
}

function parseSegments(def: RouteDef): Segment[] {
  const label = describe(def);
  if (!HTTP_METHODS.includes(def.method)) {
    throw new Error(`Route ${label}: unsupported HTTP method.`);
  }
  if (typeof def.handler !== "function") {
    throw new Error(`Route ${label}: handler is not a function.`);
  }
  if (
    typeof def.path !== "string" ||
    !def.path.startsWith(API_PREFIX) ||
    def.path.endsWith("/")
  ) {
    throw new Error(
      `Route ${label}: path must start with "/api/" and must not end with a slash.`
    );
  }
  const seen = new Set<string>();
  return def.path
    .slice(1)
    .split("/")
    .map((raw): Segment => {
      if (raw === "") {
        throw new Error(`Route ${label}: empty path segment.`);
      }
      if (!raw.startsWith(":")) {
        if (STATIC_SEGMENT_FORBIDDEN.test(raw)) {
          throw new Error(`Route ${label}: bad static segment "${raw}".`);
        }
        return { kind: "static", value: raw };
      }
      const name = raw.slice(1);
      if (!PARAM_NAME.test(name) || seen.has(name)) {
        throw new Error(`Route ${label}: bad or duplicate parameter "${raw}".`);
      }
      seen.add(name);
      return { kind: "param", name };
    });
}

/** `GET /api/items/:` — parameter names do not matter for ambiguity. */
function shapeKey(def: RouteDef, segments: readonly Segment[]): string {
  const shape = segments
    .map((segment) => (segment.kind === "param" ? ":" : segment.value))
    .join("/");
  return `${def.method} /${shape}`;
}

/** Most static segments first; ties go to the route whose static segments sit further left. */
function bySpecificity(a: CompiledRoute, b: CompiledRoute): number {
  if (a.staticCount !== b.staticCount) {
    return b.staticCount - a.staticCount;
  }
  for (const [index, segment] of a.segments.entries()) {
    const aStatic = segment.kind === "static";
    const bStatic = b.segments[index]?.kind === "static";
    if (aStatic !== bStatic) {
      return aStatic ? -1 : 1;
    }
  }
  return 0;
}

function splitPath(pathname: string): string[] | null {
  let path = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  const parts: string[] = [];
  for (const raw of path.split("/")) {
    try {
      parts.push(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return parts;
}

function matchSegments(
  segments: readonly Segment[],
  parts: readonly string[]
): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (const [index, segment] of segments.entries()) {
    const part = parts[index];
    if (segment.kind === "static") {
      if (segment.value !== part) {
        return null;
      }
    } else {
      if (part === "") {
        return null;
      }
      params[segment.name] = part;
    }
  }
  return params;
}

export function compileRoutes(defs: readonly RouteDef[]): Router {
  const seen = new Set<string>();
  const compiled: CompiledRoute[] = [];
  for (const def of defs) {
    assertValidAccess(def);
    const segments = parseSegments(def);
    const key = shapeKey(def, segments);
    if (seen.has(key)) {
      throw new Error(`Duplicate route: ${describe(def)} (${key}).`);
    }
    seen.add(key);
    compiled.push({
      def,
      segments,
      staticCount: segments.filter((segment) => segment.kind === "static")
        .length,
    });
  }
  compiled.sort(bySpecificity);

  const bySegmentCount = new Map<number, CompiledRoute[]>();
  for (const route of compiled) {
    const bucket = bySegmentCount.get(route.segments.length) ?? [];
    bucket.push(route);
    bySegmentCount.set(route.segments.length, bucket);
  }

  const lookup = (method: string, pathname: string): RouteLookup => {
    const parts = splitPath(pathname);
    if (parts === null) {
      return { kind: "not_found" };
    }
    const matches: { params: Record<string, string>; route: RouteDef }[] = [];
    for (const candidate of bySegmentCount.get(parts.length) ?? []) {
      const params = matchSegments(candidate.segments, parts);
      if (params) {
        matches.push({ params, route: candidate.def });
      }
    }
    if (matches.length === 0) {
      return { kind: "not_found" };
    }
    const hit = matches.find((match) => match.route.method === method);
    if (hit) {
      return { kind: "found", params: hit.params, route: hit.route };
    }
    const allow = [...new Set(matches.map((match) => match.route.method))];
    return { allow: allow.sort(), kind: "method_not_allowed" };
  };

  return { lookup, routes: defs };
}
