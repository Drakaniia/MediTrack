import { describe, expect, it, vi } from "vitest";

import { onRequest as middleware } from "../functions/_middleware";
import { onRequest as catchAll } from "../functions/api/[[route]]";
import type { PagesContext } from "../server/env";
import { createTestApp, TEST_BASE_URL } from "./app";

function context(
  request: Request,
  env: PagesContext["env"],
  next: () => Promise<Response>
) {
  return { env, next, params: {}, request, waitUntil: () => undefined };
}

describe("functions/api/[[route]].ts", () => {
  it("hands the request to the API and returns its answer", async () => {
    const app = await createTestApp();
    const response = await catchAll({
      env: app.env,
      params: { route: ["health"] },
      request: new Request(`${TEST_BASE_URL}/api/health`),
      waitUntil: () => undefined,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = (await response.json()) as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
  });

  it("answers unknown API paths with JSON, not HTML", async () => {
    const app = await createTestApp();
    const response = await catchAll({
      env: app.env,
      params: { route: ["nope"] },
      request: new Request(`${TEST_BASE_URL}/api/nope`),
      waitUntil: () => undefined,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("functions/_middleware.ts", () => {
  it("adds no-store to API responses", async () => {
    const app = await createTestApp();
    const response = await middleware(
      context(new Request(`${TEST_BASE_URL}/api/health`), app.env, () =>
        Promise.resolve(
          new Response("{}", { headers: { "cache-control": "max-age=600" } })
        )
      )
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("copes with a response whose headers are immutable", async () => {
    const app = await createTestApp();
    const response = await middleware(
      context(new Request(`${TEST_BASE_URL}/api/x`), app.env, () =>
        Promise.resolve(
          Response.redirect("https://meditract.test/elsewhere", 302)
        )
      )
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("turns anything that escapes into a JSON 500 and logs it", async () => {
    const app = await createTestApp();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await middleware(
        context(new Request(`${TEST_BASE_URL}/api/health`), app.env, () =>
          Promise.reject(new Error("worker exploded: token=abc123"))
        )
      );
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain(
        "application/json"
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        error: {
          code: "internal_error",
          message: "Something went wrong on our side. Please try again.",
        },
      });
      expect(text).not.toContain("exploded");
      expect(spy).toHaveBeenCalledTimes(1);
      // The logger redacts by key, and the message itself stays in the log only.
      expect(String(spy.mock.calls[0][0])).toContain("worker exploded");
    } finally {
      spy.mockRestore();
    }
  });

  it("leaves non-API requests (static assets) completely untouched", async () => {
    const app = await createTestApp();
    const asset = new Response("<html></html>", {
      headers: { "cache-control": "max-age=3600" },
    });
    const response = await middleware(
      context(new Request(`${TEST_BASE_URL}/inventory`), app.env, () =>
        Promise.resolve(asset)
      )
    );
    expect(response).toBe(asset);
    expect(response.headers.get("cache-control")).toBe("max-age=3600");
  });

  it("does not catch failures of static assets", async () => {
    const app = await createTestApp();
    await expect(
      middleware(
        context(new Request(`${TEST_BASE_URL}/inventory`), app.env, () =>
          Promise.reject(new Error("asset store down"))
        )
      )
    ).rejects.toThrow("asset store down");
  });
});
