/**
 * The permission table, enforced route by route.
 *
 * This test iterates the REAL route registry (`ALL_ROUTES`), so it covers every route any
 * slice registers later without being edited: for each route it signs in (with a fresh
 * session) as anonymous and as each of the five roles and compares the answer with
 * `shared/permissions.ts`.
 *
 *   allowed principal  → anything except 401 / 403 `forbidden`, and never a 5xx
 *   denied role        → exactly 403 `forbidden`
 *   anonymous          → 401 `unauthenticated` unless the route is `public`
 *
 * Bodies are empty `{}` and ids are a well-formed but unknown uuid, so allowed principals
 * typically get 400 / 404 from the handler — that is fine; what matters is that the router
 * let them in (and that nothing crashes).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { createSession } from "../server/auth/session";
import type { HttpMethod, RouteDef } from "../server/route-types";
import { compileRoutes } from "../server/router";
import { ALL_ROUTES } from "../server/routes/registry";
import { can, isPermission } from "../shared/permissions";
import { ROLES, type Role } from "../shared/roles";
import {
  createTestApp,
  TEST_BASE_URL,
  TEST_PEPPER,
  type TestApp,
  type TestUser,
} from "./app";

const ZERO_UUID = "00000000-0000-4000-8000-000000000000";
const BODY_METHODS: ReadonlySet<HttpMethod> = new Set(["PATCH", "POST", "PUT"]);

interface Probe {
  code: string | null;
  status: number;
}

let app: TestApp;
const usersByRole = new Map<Role, TestUser>();

beforeAll(async () => {
  app = await createTestApp();
  const users = await Promise.all(
    ROLES.map(async (role) => ({ role, user: await app.createUser({ role }) }))
  );
  for (const { role, user } of users) {
    usersByRole.set(role, user);
  }
});

function concretePath(path: string): string {
  return path.replace(":type", "item").replaceAll(/:\w+/g, ZERO_UUID);
}

function label(route: RouteDef): string {
  return `${route.method} ${route.path}`;
}

async function sessionCookie(role: Role | null): Promise<string | null> {
  if (role === null) {
    return null;
  }
  const user = usersByRole.get(role);
  if (!user) {
    throw new Error(`No test user for ${role}`);
  }
  const { token } = await createSession(app.db, user, {
    ip: null,
    now: app.clock.now(),
    pepper: TEST_PEPPER,
    userAgent: "permissions-matrix",
  });
  return `mt_session=${token}`;
}

async function probe(
  route: RouteDef,
  role: Role | null,
  headers: Record<string, string> = {}
): Promise<Probe> {
  const cookie = await sessionCookie(role);
  const response = await app.handle(
    new Request(`${TEST_BASE_URL}${concretePath(route.path)}`, {
      body: BODY_METHODS.has(route.method) ? "{}" : undefined,
      headers: {
        "content-type": "application/json",
        origin: TEST_BASE_URL,
        "x-meditract-csrf": "1",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      method: route.method,
    })
  );
  const text = await response.text();
  let code: string | null = null;
  if (text !== "") {
    const parsed = JSON.parse(text) as { error?: { code?: string } };
    code = parsed.error?.code ?? null;
  }
  return { code, status: response.status };
}

function expectAllowed(result: Probe, who: string, route: RouteDef): void {
  const context = `${who} on ${label(route)} -> ${result.status} ${result.code ?? ""}`;
  expect(result.status, context).not.toBe(401);
  expect(result.status < 500, context).toBe(true);
  expect(result.code, context).not.toBe("forbidden");
  expect(result.code, context).not.toBe("csrf_failed");
  expect(result.code, context).not.toBe("password_change_required");
}

describe("route table integrity", () => {
  it("compiles: every route has a valid access rule and a unique method+path", () => {
    expect(ALL_ROUTES.length).toBeGreaterThan(0);
    expect(() => compileRoutes(ALL_ROUTES)).not.toThrow();
  });

  it("has no duplicate method+path (parameter names ignored)", () => {
    const keys = ALL_ROUTES.map(
      (route) => `${route.method} ${route.path.replaceAll(/:\w+/g, ":")}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares only valid access rules", () => {
    for (const route of ALL_ROUTES) {
      const valid =
        route.access === "public" ||
        route.access === "authenticated" ||
        isPermission(route.access);
      expect(valid, label(route)).toBe(true);
    }
  });

  it("lets only /api/auth/* routes through the forced password change", () => {
    for (const route of ALL_ROUTES) {
      if (
        "allowPasswordChangePending" in route &&
        route.allowPasswordChangePending
      ) {
        expect(route.path.startsWith("/api/auth/"), label(route)).toBe(true);
      }
    }
  });
});

describe("permissions per route", () => {
  it.each(ALL_ROUTES.map((route) => [label(route), route] as const))(
    "%s",
    async (_name, route) => {
      const anonymous = await probe(route, null);
      if (route.access === "public") {
        expectAllowed({ ...anonymous }, "anonymous", route);
      } else {
        expect(anonymous.status, `anonymous on ${label(route)}`).toBe(401);
        expect(anonymous.code).toBe("unauthenticated");
      }

      for (const role of ROLES) {
        const result = await probe(route, role);
        const allowed =
          route.access === "public" ||
          route.access === "authenticated" ||
          can(role, route.access);
        if (allowed) {
          expectAllowed(result, role, route);
        } else {
          expect(result, `${role} on ${label(route)}`).toEqual({
            code: "forbidden",
            status: 403,
          });
        }
      }
    }
  );
});

describe("CSRF on every state-changing route", () => {
  it("refuses a write without the custom header, whoever sends it", async () => {
    const unsafe = ALL_ROUTES.filter((route) => route.method !== "GET");
    expect(unsafe.length).toBeGreaterThan(0);
    const results = await Promise.all(
      unsafe.map(async (route) => ({
        result: await probe(route, route.access === "public" ? null : "admin", {
          "x-meditract-csrf": "0",
        }),
        route,
      }))
    );
    for (const { result, route } of results) {
      expect(result, label(route)).toEqual({
        code: "csrf_failed",
        status: 403,
      });
    }
  });

  it("refuses a write from a foreign origin", async () => {
    const unsafe = ALL_ROUTES.filter((route) => route.method !== "GET");
    const results = await Promise.all(
      unsafe.map(async (route) => ({
        result: await probe(route, route.access === "public" ? null : "admin", {
          origin: "https://evil.example",
        }),
        route,
      }))
    );
    for (const { result, route } of results) {
      expect(result, label(route)).toEqual({
        code: "csrf_failed",
        status: 403,
      });
    }
  });
});
