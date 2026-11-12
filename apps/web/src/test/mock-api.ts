import { vi } from "vitest";

/**
 * A `fetch` stub for component tests. No network, no server:
 *
 *   const api = mockApi({
 *     "GET /api/items": (req) => [{ id: "1", name: "Gauze" }],
 *     "POST /api/items": (req) => created({ id: "2" }),
 *     "GET /api/items/:id": (req) => ({ id: req.params.id }),
 *     "DELETE /api/items/:id": () => undefined,                 // → 204
 *     "GET /api/audit": () => page(rows, { total: 120 }),
 *     "POST /api/auth/login": () => failure(401, "invalid_credentials", "Nope"),
 *   });
 *   …
 *   expect(api.callsTo("POST /api/items")[0].body).toEqual({ … });
 *
 * A handler returns the payload, which is wrapped as `{ data }` (like the real
 * API); `undefined` answers 204. `page()`, `failure()` and `created()` shape
 * the other responses. A request with no matching handler is recorded and
 * answered with a network failure, and the test FAILS in the automatic
 * teardown (`restoreMockApi`, run from `setup.ts`), so a forgotten handler can
 * never pass silently.
 */

export interface MockRequest {
  /** Parsed JSON body, or `undefined`. */
  body: unknown;
  headers: Headers;
  method: string;
  /** `:name` segments of the matched pattern. */
  params: Record<string, string>;
  /** Path without the query string, e.g. `/api/items`. */
  path: string;
  /** Query string as a flat map (repeated keys: the last wins). */
  query: Record<string, string>;
  url: URL;
}

const RESPONSE_BRAND = Symbol("mockApi.response");

export interface MockResponse {
  body: unknown;
  headers: Record<string, string>;
  status: number;
  [RESPONSE_BRAND]: true;
}

export type MockHandler = (
  request: MockRequest
) => MockResponse | Promise<MockResponse | unknown> | unknown;

export type MockHandlers = Readonly<Record<string, MockHandler>>;

export interface MockCall extends MockRequest {
  /** The handler key that answered it, or `null` when none matched. */
  matched: string | null;
}

export interface MockApi {
  /** Every request made so far, in order. */
  calls: MockCall[];
  /** Requests answered by `key` (e.g. `"POST /api/items"`). */
  callsTo: (key: string) => MockCall[];
  /** Adds or replaces handlers mid-test. */
  respond: (handlers: MockHandlers) => void;
  restore: () => void;
  /** Requests nobody handled. */
  unhandled: MockCall[];
}

function brand(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): MockResponse {
  return { [RESPONSE_BRAND]: true, body, headers, status };
}

function isMockResponse(value: unknown): value is MockResponse {
  return typeof value === "object" && value !== null && RESPONSE_BRAND in value;
}

/** `201` with `{ data }`. */
export function created(data: unknown): MockResponse {
  return brand(201, { data });
}

/** A list response: `{ data: rows, meta }`. */
export function page(
  rows: readonly unknown[],
  meta: { limit?: number; offset?: number; total?: number } = {}
): MockResponse {
  return brand(200, {
    data: rows,
    meta: { limit: 50, offset: 0, total: rows.length, ...meta },
  });
}

/** `{ error: { code, message, details? } }` with the given HTTP status. */
export function failure(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers?: Record<string, string>
): MockResponse {
  return brand(status, { error: { code, details, message } }, headers);
}

/** 204 No Content. */
export function noContent(): MockResponse {
  return brand(204, undefined);
}

function toSpec(result: unknown): MockResponse {
  if (isMockResponse(result)) {
    return result;
  }
  return result === undefined ? noContent() : brand(200, { data: result });
}

function toResponse(result: unknown): Response {
  const spec = toSpec(result);
  const empty = spec.status === 204 || spec.body === undefined;
  return new Response(empty ? null : JSON.stringify(spec.body), {
    headers: { "content-type": "application/json", ...spec.headers },
    status: spec.status,
  });
}

function parseKey(key: string): { method: string; path: string } {
  const space = key.indexOf(" ");
  if (space === -1) {
    throw new Error(
      `mockApi: handler key "${key}" must look like "GET /api/x"`
    );
  }
  return {
    method: key.slice(0, space).toUpperCase(),
    path: key.slice(space + 1).trim(),
  };
}

function matchPath(
  pattern: string,
  path: string
): Record<string, string> | null {
  const wanted = pattern.split("/");
  const actual = path.split("/");
  if (wanted.length !== actual.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, segment] of wanted.entries()) {
    const value = actual[index] ?? "";
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeURIComponent(value);
    } else if (segment !== value) {
      return null;
    }
  }
  return params;
}

function parseBody(init: RequestInit | undefined): unknown {
  const raw = init?.body;
  if (typeof raw !== "string" || raw === "") {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function toUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") {
    return new URL(input, "http://localhost");
  }
  return new URL(
    input instanceof URL ? input.href : input.url,
    "http://localhost"
  );
}

function findHandler(
  handlers: ReadonlyMap<string, MockHandler>,
  method: string,
  pathname: string
): {
  handler: MockHandler;
  key: string;
  params: Record<string, string>;
} | null {
  for (const [key, handler] of handlers) {
    const target = parseKey(key);
    const params =
      target.method === method ? matchPath(target.path, pathname) : null;
    if (params) {
      return { handler, key, params };
    }
  }
  return null;
}

const active = new Set<MockApi>();
const originalFetch = globalThis.fetch;

export function mockApi(initial: MockHandlers = {}): MockApi {
  const handlers = new Map<string, MockHandler>(Object.entries(initial));
  const calls: MockCall[] = [];
  const unhandled: MockCall[] = [];

  const fetchStub = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = toUrl(input);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const base = {
        body: parseBody(init),
        headers: new Headers(init?.headers),
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        url,
      };

      const match = findHandler(handlers, method, url.pathname);
      if (match) {
        const request: MockRequest = { ...base, params: match.params };
        calls.push({ ...request, matched: match.key });
        return toResponse(await match.handler(request));
      }

      const call: MockCall = { ...base, matched: null, params: {} };
      calls.push(call);
      unhandled.push(call);
      throw new TypeError(`mockApi: no handler for ${method} ${url.pathname}`);
    }
  );

  vi.stubGlobal("fetch", fetchStub);

  const api: MockApi = {
    calls,
    callsTo: (key) => calls.filter((call) => call.matched === key),
    respond: (more) => {
      for (const [key, handler] of Object.entries(more)) {
        handlers.set(key, handler);
      }
    },
    restore: () => {
      active.delete(api);
      globalThis.fetch = originalFetch;
      vi.unstubAllGlobals();
    },
    unhandled,
  };
  active.add(api);
  return api;
}

/**
 * Restores the real `fetch` and fails the test if any request went unhandled.
 * Called from `setup.ts` after every test; tests do not need to call it.
 */
export function restoreMockApi(): void {
  const missed = [...active].flatMap((api) => api.unhandled);
  // Deleting the current entry while iterating a Set is safe: iteration continues with the next.
  for (const api of active) {
    api.restore();
  }
  if (missed.length > 0) {
    const list = missed.map((call) => `${call.method} ${call.path}`).join(", ");
    throw new Error(`mockApi: unhandled request(s): ${list}`);
  }
}
