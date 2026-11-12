import { afterEach, describe, expect, it, vi } from "vitest";

import { getOnline, resetOnlineState } from "@/lib/online";
import { failure, mockApi, page } from "@/test/mock-api";

import {
  apiDelete,
  apiGet,
  apiGetPage,
  apiPatch,
  apiPost,
  apiPut,
  buildQueryString,
  setApiClientHooks,
} from "./client";
import { ApiError } from "./errors";

afterEach(() => {
  setApiClientHooks({});
  resetOnlineState();
});

describe("apiGet", () => {
  it("unwraps the data envelope and sends same-origin credentials", async () => {
    const api = mockApi({ "GET /api/items": () => [{ id: "1" }] });

    await expect(apiGet<{ id: string }[]>("/items")).resolves.toEqual([
      { id: "1" },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      "/api/items",
      expect.objectContaining({ credentials: "same-origin", method: "GET" })
    );
    expect(api.calls).toHaveLength(1);
  });

  it("tolerates a leading /api in the path", async () => {
    mockApi({ "GET /api/items": () => [] });
    await expect(apiGet("/api/items")).resolves.toEqual([]);
  });

  it("drops undefined, null and empty params and joins arrays with commas", async () => {
    const api = mockApi({ "GET /api/expiry": () => [] });

    await apiGet("/expiry", {
      categoryId: undefined,
      class: ["urgent", "expired"],
      limit: 50,
      note: null,
      search: "",
      stock: false,
    });

    const [call] = api.calls;
    expect(call?.url.search).toBe("?class=urgent,expired&limit=50&stock=false");
  });

  it("sends no CSRF header on a read", async () => {
    const api = mockApi({ "GET /api/items": () => [] });
    await apiGet("/items");
    expect(api.calls[0]?.headers.get("x-meditract-csrf")).toBeNull();
  });
});

describe("apiGetPage", () => {
  it("returns the rows and the paging meta", async () => {
    mockApi({
      "GET /api/items": () => page([{ id: "1" }], { limit: 25, total: 90 }),
    });

    const result = await apiGetPage<{ id: string }[]>("/items");

    expect(result.data).toEqual([{ id: "1" }]);
    expect(result.meta).toMatchObject({ limit: 25, total: 90 });
  });
});

describe("unsafe methods", () => {
  it("send the CSRF header and a JSON body", async () => {
    const api = mockApi({
      "DELETE /api/items/:id": () => undefined,
      "PATCH /api/items/:id": (req) => ({ id: req.params.id }),
      "POST /api/items": (req) => req.body,
      "PUT /api/settings": () => ({ ok: true }),
    });

    await expect(apiPost("/items", { name: "Gauze" })).resolves.toEqual({
      name: "Gauze",
    });
    await apiPatch("/items/7", { name: "Tape" });
    await apiPut("/settings", { facility: { name: "Clinic" } });
    await expect(apiDelete("/items/7")).resolves.toBeUndefined();

    expect(api.calls).toHaveLength(4);
    for (const call of api.calls) {
      expect(call.headers.get("x-meditract-csrf")).toBe("1");
    }
    expect(api.calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(api.calls[1]?.params).toEqual({ id: "7" });
  });
});

describe("errors", () => {
  it("throws an ApiError carrying status, code, message and details", async () => {
    mockApi({
      "POST /api/items": () =>
        failure(400, "validation_error", "Fix the highlighted fields.", {
          issues: [{ message: "Required", path: ["name"] }],
        }),
    });

    const error = await apiPost("/items", {}).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "validation_error",
      details: { issues: [{ message: "Required", path: ["name"] }] },
      message: "Fix the highlighted fields.",
      status: 400,
    });
  });

  it("reads retryAfterSeconds from the details or the Retry-After header", async () => {
    mockApi({
      "GET /api/a": () =>
        failure(429, "rate_limited", "Slow down", { retryAfterSeconds: 42 }),
      "GET /api/b": () =>
        failure(429, "rate_limited", "Slow down", undefined, {
          "retry-after": "9",
        }),
    });

    await expect(apiGet("/a")).rejects.toMatchObject({ retryAfterSeconds: 42 });
    await expect(apiGet("/b")).rejects.toMatchObject({ retryAfterSeconds: 9 });
  });

  it("maps a non-JSON error body to a code by status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>Bad gateway</html>", { status: 502 })
      )
    );

    await expect(apiGet("/items")).rejects.toMatchObject({
      code: "internal_error",
      status: 502,
    });
    vi.unstubAllGlobals();
  });

  it("reports network_error when fetch rejects, and recovers on the next success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
    );

    await expect(apiGet("/items")).rejects.toMatchObject({
      code: "network_error",
      status: 0,
    });
    expect(getOnline()).toBe(false);

    vi.unstubAllGlobals();
    mockApi({ "GET /api/items": () => [] });
    await apiGet("/items");
    expect(getOnline()).toBe(true);
  });
});

describe("session hooks", () => {
  it("calls onUnauthenticated for a 401 unauthenticated", async () => {
    const onUnauthenticated = vi.fn();
    setApiClientHooks({ onUnauthenticated });
    mockApi({
      "GET /api/items": () => failure(401, "unauthenticated", "Sign in"),
    });

    await expect(apiGet("/items")).rejects.toMatchObject({ status: 401 });

    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("does not call it for invalid credentials", async () => {
    const onUnauthenticated = vi.fn();
    setApiClientHooks({ onUnauthenticated });
    mockApi({
      "POST /api/auth/login": () => failure(401, "invalid_credentials", "Nope"),
    });

    await expect(apiPost("/auth/login", {})).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it("does not call it for a quiet request (route guards handle their own 401)", async () => {
    const onUnauthenticated = vi.fn();
    setApiClientHooks({ onUnauthenticated });
    mockApi({
      "GET /api/auth/me": () => failure(401, "unauthenticated", "Sign in"),
    });

    await expect(
      apiGet("/auth/me", undefined, { quiet: true })
    ).rejects.toMatchObject({ code: "unauthenticated" });

    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it("calls onPasswordChangeRequired for a 403 password_change_required", async () => {
    const onPasswordChangeRequired = vi.fn();
    setApiClientHooks({ onPasswordChangeRequired });
    mockApi({
      "GET /api/items": () =>
        failure(403, "password_change_required", "Change your password"),
    });

    await expect(apiGet("/items")).rejects.toMatchObject({ status: 403 });

    expect(onPasswordChangeRequired).toHaveBeenCalledTimes(1);
  });
});

describe("buildQueryString", () => {
  it("is empty without usable params", () => {
    expect(buildQueryString(undefined)).toBe("");
    expect(buildQueryString({ a: undefined, b: "" })).toBe("");
  });

  it("encodes values but keeps commas readable", () => {
    expect(buildQueryString({ ids: ["x", "y"], q: "a&b c" })).toBe(
      "?ids=x,y&q=a%26b%20c"
    );
  });
});
