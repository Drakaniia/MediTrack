import { describe, expect, it, vi } from "vitest";

import { handleApi } from "../server/api";
import type { Env } from "../server/env";
import { ok } from "../server/http";
import type {
  BaseRouteContext,
  PublicRouteContext,
  RouteDef,
} from "../server/route-types";
import { compileRoutes } from "../server/router";
import { authRoutes } from "../server/routes/auth";
import { createTestApp, TEST_BASE_URL, type TestApp } from "./app";

/** Works as a public AND a protected handler: both contexts extend `BaseRouteContext`. */
const echoParams = async (ctx: BaseRouteContext): Promise<Response> => {
  await Promise.resolve();
  return ok({ params: ctx.params, route: ctx.url.pathname });
};

function route(
  method: RouteDef["method"],
  path: string,
  extra: { access?: RouteDef["access"] } = {}
): RouteDef {
  return {
    access: extra.access ?? "public",
    handler: echoParams,
    method,
    path,
  } as RouteDef;
}

function paramsOf(
  lookup: ReturnType<ReturnType<typeof compileRoutes>["lookup"]>
) {
  return lookup.kind === "found" ? lookup.params : null;
}

describe("compileRoutes: matching", () => {
  const router = compileRoutes([
    route("GET", "/api/items"),
    route("GET", "/api/items/:id"),
    route("GET", "/api/items/bulk"),
    route("POST", "/api/items/bulk"),
    route("GET", "/api/items/:id/batches"),
    route("GET", "/api/batches/suggest-number"),
    route("GET", "/api/batches/:id"),
    route("GET", "/api/trash/:type/:id"),
    route("DELETE", "/api/trash/:type/:id"),
  ]);

  it("extracts and URI-decodes params", () => {
    expect(paramsOf(router.lookup("GET", "/api/items/abc-123"))).toEqual({
      id: "abc-123",
    });
    expect(
      paramsOf(router.lookup("GET", "/api/items/a%20b%2Fc%C3%A9"))
    ).toEqual({
      id: "a b/cé",
    });
    expect(paramsOf(router.lookup("GET", "/api/trash/item/42"))).toEqual({
      id: "42",
      type: "item",
    });
    expect(paramsOf(router.lookup("GET", "/api/items/x/batches"))).toEqual({
      id: "x",
    });
  });

  it("lets a static segment beat a param, whatever the registration order", () => {
    const hit = router.lookup("GET", "/api/items/bulk");
    expect(hit.kind === "found" && hit.route.path).toBe("/api/items/bulk");
    expect(paramsOf(hit)).toEqual({});
    expect(
      router.lookup("GET", "/api/batches/suggest-number").kind === "found" &&
        (
          router.lookup("GET", "/api/batches/suggest-number") as {
            route: RouteDef;
          }
        ).route.path
    ).toBe("/api/batches/suggest-number");

    const reversed = compileRoutes([
      route("GET", "/api/batches/:id"),
      route("GET", "/api/batches/suggest-number"),
    ]);
    const other = reversed.lookup("GET", "/api/batches/suggest-number");
    expect(other.kind === "found" && other.route.path).toBe(
      "/api/batches/suggest-number"
    );
    expect(paramsOf(reversed.lookup("GET", "/api/batches/other"))).toEqual({
      id: "other",
    });
  });

  it("falls back to the param route for other methods of a static path", () => {
    // DELETE /api/items/bulk has no static route, but DELETE-by-id is not registered either.
    expect(router.lookup("DELETE", "/api/items/bulk").kind).toBe(
      "method_not_allowed"
    );
  });

  it("prefers more static segments, then further-left statics", () => {
    const table = compileRoutes([
      route("GET", "/api/a/:x/:y"),
      route("GET", "/api/a/:x/leaf"),
      route("GET", "/api/a/mid/:y"),
      route("GET", "/api/:x/mid/leaf"),
    ]);
    const pick = (path: string) => {
      const hit = table.lookup("GET", path);
      return hit.kind === "found" ? hit.route.path : null;
    };
    expect(pick("/api/a/mid/leaf")).toBe("/api/a/mid/:y");
    expect(pick("/api/a/other/leaf")).toBe("/api/a/:x/leaf");
    expect(pick("/api/a/other/thing")).toBe("/api/a/:x/:y");
    expect(pick("/api/z/mid/leaf")).toBe("/api/:x/mid/leaf");
  });

  it("answers not_found and method_not_allowed (with the allowed methods)", () => {
    expect(router.lookup("GET", "/api/nothing").kind).toBe("not_found");
    expect(router.lookup("GET", "/api/items/1/2/3").kind).toBe("not_found");
    expect(router.lookup("GET", "/").kind).toBe("not_found");
    expect(router.lookup("GET", "/api").kind).toBe("not_found");
    expect(router.lookup("GET", "/api/items//x").kind).toBe("not_found");
    expect(router.lookup("GET", "/api/items/%E0%A4%A").kind).toBe("not_found");

    expect(router.lookup("DELETE", "/api/items")).toEqual({
      allow: ["GET"],
      kind: "method_not_allowed",
    });
    expect(router.lookup("PATCH", "/api/items/bulk")).toEqual({
      allow: ["GET", "POST"],
      kind: "method_not_allowed",
    });
  });

  it("ignores a single trailing slash", () => {
    expect(router.lookup("GET", "/api/items/").kind).toBe("found");
    expect(paramsOf(router.lookup("GET", "/api/items/abc/"))).toEqual({
      id: "abc",
    });
  });
});

describe("compileRoutes: validation", () => {
  it("refuses a route without a valid access rule", () => {
    expect(() =>
      compileRoutes([
        { ...route("GET", "/api/x"), access: undefined } as unknown as RouteDef,
      ])
    ).toThrow(/no valid "access"/);
    expect(() =>
      compileRoutes([
        {
          ...route("GET", "/api/x"),
          access: "items.read",
        } as unknown as RouteDef,
      ])
    ).toThrow(/no valid "access"/);
    expect(() =>
      compileRoutes([
        { ...route("GET", "/api/x"), access: "" } as unknown as RouteDef,
      ])
    ).toThrow(/no valid "access"/);
  });

  it("accepts public, authenticated and every permission", () => {
    expect(() =>
      compileRoutes([
        route("GET", "/api/a", { access: "public" }),
        route("GET", "/api/b", { access: "authenticated" }),
        route("GET", "/api/c", { access: "inventory.view" }),
      ])
    ).not.toThrow();
  });

  it("refuses duplicate method+path, even with different param names", () => {
    expect(() =>
      compileRoutes([route("GET", "/api/x/:id"), route("GET", "/api/x/:other")])
    ).toThrow(/Duplicate route/);
    expect(() =>
      compileRoutes([route("GET", "/api/x"), route("GET", "/api/x")])
    ).toThrow(/Duplicate route/);
    expect(() =>
      compileRoutes([route("GET", "/api/x"), route("POST", "/api/x")])
    ).not.toThrow();
  });

  it("refuses malformed paths, methods and parameters", () => {
    for (const path of [
      "/items",
      "/api/",
      "/api/x/",
      "/api//x",
      "/api/x/:",
      "/api/x/:1a",
      "/api/:id/:id",
      "/api/x:y",
      "/api/*",
    ]) {
      expect(() => compileRoutes([route("GET", path)]), path).toThrow();
    }
    expect(() =>
      compileRoutes([
        { ...route("GET", "/api/x"), method: "TRACE" } as unknown as RouteDef,
      ])
    ).toThrow(/unsupported HTTP method/);
    expect(() =>
      compileRoutes([
        {
          ...route("GET", "/api/x"),
          handler: undefined,
        } as unknown as RouteDef,
      ])
    ).toThrow(/handler/);
  });
});

/** What the `/api/whoami` test route reports about the request it saw. */
interface Who {
  ip: string | null;
  requestId: string;
  signedIn: boolean;
  username: string | null;
}

describe("handleApi pipeline", () => {
  const routes: RouteDef[] = [
    route("GET", "/api/echo/:name"),
    route("GET", "/api/echo/fixed"),
    route("POST", "/api/things", { access: "inventory.write" }),
    route("GET", "/api/me", { access: "authenticated" }),
    {
      access: "public",
      handler: async (ctx: PublicRouteContext) => {
        await Promise.resolve();
        return ok({
          ip: ctx.ip,
          requestId: ctx.requestId,
          signedIn: ctx.sessionId !== null,
          username: ctx.user?.username ?? null,
        });
      },
      method: "GET",
      path: "/api/whoami",
    },
    {
      access: "public",
      handler: async () => {
        await Promise.resolve();
        throw new Error("boom: database password is hunter2");
      },
      method: "GET",
      path: "/api/boom",
    },
  ];

  async function appWith(): Promise<TestApp> {
    // Sign-in is a real route, so the custom table keeps the platform's auth routes.
    return await createTestApp({ routes: [...authRoutes, ...routes] });
  }

  it("decodes params and prefers static routes end to end", async () => {
    const app = await appWith();
    const dynamic = await app.anonymous.get<{ params: Record<string, string> }>(
      "/api/echo/caf%C3%A9%20au%20lait"
    );
    expect(dynamic.data.params).toEqual({ name: "café au lait" });
    const fixed = await app.anonymous.get<{ params: Record<string, string> }>(
      "/api/echo/fixed"
    );
    expect(fixed.data.params).toEqual({});
  });

  it("answers 404 JSON for unknown paths and anything outside /api", async () => {
    const app = await appWith();
    for (const path of [
      "/api/nope",
      "/api",
      "/",
      "/index.html",
      "/apix/echo/a",
      "/api/echo",
    ]) {
      const res = await app.anonymous.get(path);
      expect(res.status, path).toBe(404);
      expect(res.error?.code).toBe("not_found");
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("answers 405 with an Allow header when the path exists under other methods", async () => {
    const app = await appWith();
    const res = await app.anonymous.delete("/api/echo/x");
    expect(res.status).toBe(405);
    expect(res.error?.code).toBe("method_not_allowed");
    expect(res.headers.get("allow")).toBe("GET");

    const head = await app.anonymous.request("HEAD", "/api/echo/x");
    expect(head.status).toBe(405);
  });

  it("enforces access: 401 anonymous, 403 wrong role, allowed role passes", async () => {
    const app = await appWith();
    expect((await app.anonymous.post("/api/things", {})).status).toBe(401);
    const nurse = await app.loginAs("nurse");
    const denied = await nurse.post("/api/things", {});
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("forbidden");
    const inventory = await app.loginAs("inventory");
    expect((await inventory.post("/api/things", {})).status).toBe(200);
    // "authenticated" admits every signed-in role.
    expect((await nurse.get("/api/me")).status).toBe(200);
  });

  it("turns unexpected errors into a generic 500 and logs the details", async () => {
    const app = await appWith();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await app.anonymous.get("/api/boom");
      expect(res.status).toBe(500);
      expect(res.error?.code).toBe("internal_error");
      expect(JSON.stringify(res.body)).not.toMatch(/boom|hunter2|database/i);
      expect(res.headers.get("x-request-id")).toBeTruthy();

      expect(spy).toHaveBeenCalledTimes(1);
      const line = String(spy.mock.calls[0][0]);
      expect(line).toContain("boom");
      expect(line).toContain(res.headers.get("x-request-id") ?? "?");
    } finally {
      spy.mockRestore();
    }
  });

  it("gives public routes the session when there is one, the client ip and the request id", async () => {
    const app = await appWith();
    const user = await app.createUser({ role: "nurse", username: "nina" });
    const client = await app.login(user);

    const anonymous = await app.anonymous.get<Who>("/api/whoami");
    expect(anonymous.data).toMatchObject({
      ip: null,
      signedIn: false,
      username: null,
    });

    const signedIn = await client.request<Who>("GET", "/api/whoami", {
      headers: { "cf-connecting-ip": "203.0.113.77" },
    });
    expect(signedIn.data).toMatchObject({
      ip: "203.0.113.77",
      signedIn: true,
      username: "nina",
    });
    expect(signedIn.data.requestId).toBe(signedIn.headers.get("x-request-id"));

    // A dead cookie on a public route is simply "not signed in": no error, no cleared cookie.
    const stale = await app.anonymous.request<Who>("GET", "/api/whoami", {
      headers: { cookie: `mt_session=${"z".repeat(43)}` },
    });
    expect(stale.status).toBe(200);
    expect(stale.data.signedIn).toBe(false);
    expect(stale.setCookie).toBeNull();
  });

  it("puts the security headers and a unique request id on EVERY response", async () => {
    const app = await createTestApp();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const nurse = await app.loginAs("nurse");
    const answers = [
      await app.anonymous.get("/api/health"),
      await app.anonymous.get("/api/auth/me"),
      await app.anonymous.get("/api/nope"),
      await app.anonymous.delete("/api/health"),
      await app.anonymous.get("/index.html"),
      await app.anonymous.post("/api/auth/login", {}),
      await nurse.get("/api/users"),
      await nurse.post("/api/auth/logout"),
      await app.anonymous.request("POST", "/api/auth/login", {
        headers: { origin: "https://evil.example" },
      }),
    ];
    spy.mockRestore();

    const ids = new Set<string>();
    for (const res of answers) {
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("cross-origin-resource-policy")).toBe(
        "same-origin"
      );
      expect(res.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'"
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      ids.add(res.headers.get("x-request-id") ?? "");
    }
    expect(answers.map((res) => res.status)).toEqual([
      200, 401, 404, 405, 404, 400, 403, 204, 403,
    ]);
    expect(ids.size).toBe(answers.length);
    expect(ids.has("")).toBe(false);
  });
});

describe("GET /api/health", () => {
  it("reports ok with the environment and the clock", async () => {
    const app = await createTestApp();
    const res = await app.anonymous.get<{
      env: string;
      ok: boolean;
      time: string;
    }>("/api/health");
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      env: "test",
      ok: true,
      time: "2026-11-12T02:00:00.000Z",
    });
  });

  it("defaults the environment name to 'local'", async () => {
    const app = await createTestApp();
    const { APP_ENV: _unused, ...rest } = app.env;
    const response = await handleApi(
      new Request(`${TEST_BASE_URL}/api/health`),
      rest as Env
    );
    const body = (await response.json()) as { data: { env: string } };
    expect(body.data.env).toBe("local");
  });

  it("answers 503 ok:false when D1 is unreachable, and stays public", async () => {
    const app = await createTestApp();
    const broken: Env = {
      ...app.env,
      DB: {
        batch: () => Promise.reject(new Error("D1 down")),
        exec: () => Promise.reject(new Error("D1 down")),
        prepare: () => {
          throw new Error("D1 down");
        },
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const response = await handleApi(
        new Request(`${TEST_BASE_URL}/api/health`, {
          headers: { cookie: `mt_session=${"a".repeat(43)}` },
        }),
        broken
      );
      expect(response.status).toBe(503);
      const body = (await response.json()) as { data: { ok: boolean } };
      expect(body.data.ok).toBe(false);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });
});
