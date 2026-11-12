/**
 * TestApp — the API test harness every slice uses. The interface below is FROZEN: add to it,
 * never rename or remove.
 *
 * ```ts
 * import { createTestApp } from "./app";
 *
 * const app = await createTestApp();                    // fresh in-memory D1 + the full route table
 * const admin = await app.loginAs("admin");             // new admin user, signed in (cookie jar kept)
 * const res = await admin.post<ItemDto>("/api/items", { name: "Paracetamol" });
 * expect(res.status).toBe(201);                         // res.data = body.data, res.error = body.error
 * expect(res.data.name).toBe("Paracetamol");
 * expect((await app.anonymous.get("/api/items")).error?.code).toBe("unauthenticated");
 *
 * app.clock.advance(60_000);                            // fake clock; default 2026-11-12T02:00:00Z
 * await app.setSettings({ expiry: { urgentDays: 10 } });// settings written straight to the DB
 * app.sqlite.prepare("SELECT …").all();                 // direct access for fixtures and assertions
 * const nurse = await app.createUser({ role: "nurse" });// a user without signing in (for ownership checks)
 * const nurseClient = await app.login(nurse);           // …then sign in later
 * ```
 *
 * What the app gives you
 *  - `clock` is the request clock (`ctx.now`): the default instant is 10:00 in Asia/Manila (the default
 *    facility timezone), 02:00 UTC. It never ticks by itself.
 *  - Every client sends the CSRF header and a same-origin `Origin` for `https://meditract.test`, keeps its
 *    own cookie jar (Set-Cookie is parsed, clearing is honoured) and returns parsed JSON. The jar does NOT
 *    expire cookies by `Max-Age`, so session expiry is decided by the SERVER, as it should be in a test.
 *  - `createUser` inserts straight into the database (fast, no HTTP). `mustChangePassword` defaults to
 *    FALSE here, so a fresh user can use the API immediately. Pass `true` to test the forced-change gate.
 *  - `loginAs(role)` creates a NEW user of that role every call; two calls give two different people.
 *    Use `login(user)` to sign the same person in again (a second device).
 *  - `client.request(method, path, { body, headers, query })` is the escape hatch for custom headers
 *    (`cf-connecting-ip`, a foreign `origin`, …); `app.handle(request)` takes a raw `Request`.
 */

import type { DatabaseSync } from "node:sqlite";

import { handleApi } from "../server/api";
import { hashPassword } from "../server/auth/password";
import type { Env } from "../server/env";
import { newId } from "../server/ids";
import type { RouteDef } from "../server/route-types";
import {
  loadSettings,
  settingsWriteStatements,
} from "../server/settings-store";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "../shared/api";
import type { Role } from "../shared/roles";
import {
  mergeSettings,
  type SettingsPatch,
  validateSettings,
} from "../shared/settings";
import { createMigratedD1, type FakeD1 } from "./harness";

export const TEST_BASE_URL = "https://meditract.test";
export const TEST_PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";
export const TEST_START = "2026-11-12T02:00:00.000Z";
export const TEST_DEFAULT_PASSWORD = "Correct-Horse-Battery-9";

const TEST_PASSWORD_ITERATIONS = 10_000;
const MAX_AGE_PREFIX_LENGTH = "max-age=".length;

export interface TestUser {
  displayName: string;
  email: string | null;
  id: string;
  password: string;
  role: Role;
  username: string;
}

export interface TestResponse<T = unknown> {
  /** The parsed JSON body (or raw text when it is not JSON, null when empty). */
  body: unknown;
  /** `body.data` (undefined for errors and 204s). */
  data: T;
  /** The parsed `{ error }` object of a failure, else null. */
  error: { code: string; details?: unknown; message: string } | null;
  headers: Headers;
  /** The first `Set-Cookie` header, if any. */
  setCookie: string | null;
  status: number;
}

export type TestQuery = Record<string, string | number | undefined>;

export interface TestRequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  query?: TestQuery;
}

export interface TestClient {
  /** The value of a cookie in this client's jar (default: the session cookie), or null. */
  cookie: (name?: string) => string | null;
  delete: <T = unknown>(path: string) => Promise<TestResponse<T>>;
  get: <T = unknown>(
    path: string,
    query?: TestQuery
  ) => Promise<TestResponse<T>>;
  patch: <T = unknown>(
    path: string,
    body?: unknown
  ) => Promise<TestResponse<T>>;
  post: <T = unknown>(path: string, body?: unknown) => Promise<TestResponse<T>>;
  put: <T = unknown>(path: string, body?: unknown) => Promise<TestResponse<T>>;
  /** Any method, with extra headers / query. */
  request: <T = unknown>(
    method: string,
    path: string,
    options?: TestRequestOptions
  ) => Promise<TestResponse<T>>;
}

export interface TestClock {
  advance: (ms: number) => void;
  now: () => Date;
  set: (iso: string) => void;
}

export interface CreateUserInput {
  disabled?: boolean;
  displayName?: string;
  email?: string;
  mustChangePassword?: boolean;
  password?: string;
  role?: Role;
  username?: string;
}

export interface TestApp {
  anonymous: TestClient;
  clock: TestClock;
  createUser: (input?: CreateUserInput) => Promise<TestUser>;
  db: FakeD1;
  env: Env;
  handle: (request: Request) => Promise<Response>;
  login: (user: TestUser) => Promise<TestClient>;
  loginAs: (role: Role) => Promise<TestClient>;
  setSettings: (patch: SettingsPatch) => Promise<void>;
  sqlite: DatabaseSync;
}

export interface CreateTestAppOptions {
  /** ISO start instant of the fake clock. */
  now?: string;
  /** Route table; defaults to the full registry (`ALL_ROUTES`). */
  routes?: RouteDef[];
}

// ─── Clock ──────────────────────────────────────────────────────────────────

function parseInstant(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`Not an ISO timestamp: ${iso}`);
  }
  return ms;
}

function createClock(start: string): TestClock {
  let current = parseInstant(start);
  return {
    advance: (ms) => {
      current += ms;
    },
    now: () => new Date(current),
    set: (iso) => {
      current = parseInstant(iso);
    },
  };
}

// ─── Cookie jar ─────────────────────────────────────────────────────────────

interface CookieJar {
  get: (name: string) => string | null;
  header: () => string | null;
  store: (response: Response) => void;
}

function applySetCookie(cookies: Map<string, string>, line: string): void {
  const [pair, ...attributes] = line.split(";").map((part) => part.trim());
  const separator = pair.indexOf("=");
  if (separator <= 0) {
    return;
  }
  const name = pair.slice(0, separator);
  const value = pair.slice(separator + 1);
  const maxAge = attributes.find((attribute) =>
    attribute.toLowerCase().startsWith("max-age=")
  );
  const cleared =
    value === "" ||
    (maxAge !== undefined && Number(maxAge.slice(MAX_AGE_PREFIX_LENGTH)) <= 0);
  if (cleared) {
    cookies.delete(name);
    return;
  }
  cookies.set(name, value);
}

function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>();
  return {
    get: (name) => cookies.get(name) ?? null,
    header: () =>
      cookies.size === 0
        ? null
        : [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    store: (response) => {
      for (const line of response.headers.getSetCookie()) {
        applySetCookie(cookies, line);
      }
    },
  };
}

// ─── Client ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function toTestResponse<T>(response: Response): Promise<TestResponse<T>> {
  const text = await response.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  const record = isRecord(body) ? body : null;
  const failure = record && isRecord(record.error) ? record.error : null;
  return {
    body,
    // The caller chooses `T`; the envelope itself is checked by the platform's own tests.
    data: record?.data as T,
    error: failure as TestResponse["error"],
    headers: response.headers,
    setCookie: response.headers.getSetCookie()[0] ?? null,
    status: response.status,
  };
}

function buildRequest(
  method: string,
  path: string,
  options: TestRequestOptions,
  cookie: string | null
): Request {
  const url = new URL(path, TEST_BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  const headers = new Headers({
    [CSRF_HEADER]: CSRF_HEADER_VALUE,
    origin: TEST_BASE_URL,
    ...options.headers,
  });
  if (cookie !== null) {
    headers.set("cookie", cookie);
  }
  const hasBody = options.body !== undefined;
  if (hasBody) {
    headers.set("content-type", "application/json");
  }
  return new Request(url, {
    body: hasBody ? JSON.stringify(options.body) : undefined,
    headers,
    method,
  });
}

function createClient(
  handle: (request: Request) => Promise<Response>
): TestClient {
  const jar = createCookieJar();
  const request: TestClient["request"] = async (method, path, options = {}) => {
    const response = await handle(
      buildRequest(method, path, options, jar.header())
    );
    jar.store(response);
    return await toTestResponse(response);
  };
  return {
    cookie: (name = "mt_session") => jar.get(name),
    delete: (path) => request("DELETE", path),
    get: (path, query) => request("GET", path, { query }),
    patch: (path, body) => request("PATCH", path, { body }),
    post: (path, body) => request("POST", path, { body }),
    put: (path, body) => request("PUT", path, { body }),
    request,
  };
}

// ─── Users ──────────────────────────────────────────────────────────────────

/** PBKDF2 is the slow part of creating a user; identical passwords share one hash in tests. */
const passwordHashes = new Map<string, Promise<string>>();

function testPasswordHash(password: string): Promise<string> {
  const cached = passwordHashes.get(password);
  if (cached) {
    return cached;
  }
  const created = hashPassword(password, {
    iterations: TEST_PASSWORD_ITERATIONS,
  });
  passwordHashes.set(password, created);
  return created;
}

async function loadAllRoutes(): Promise<RouteDef[]> {
  const { ALL_ROUTES } = await import("../server/routes/registry");
  return ALL_ROUTES;
}

export async function createTestApp(
  options: CreateTestAppOptions = {}
): Promise<TestApp> {
  const db = createMigratedD1();
  const clock = createClock(options.now ?? TEST_START);
  const routes = options.routes ?? (await loadAllRoutes());
  const env: Env = {
    APP_ENV: "test",
    DB: db,
    PASSWORD_ITERATIONS: String(TEST_PASSWORD_ITERATIONS),
    SESSION_PEPPER: TEST_PEPPER,
  };
  const handle = (request: Request): Promise<Response> =>
    handleApi(request, env, { now: () => clock.now(), routes });

  let userCounter = 0;

  const createUser = async (input: CreateUserInput = {}): Promise<TestUser> => {
    userCounter += 1;
    const role = input.role ?? "admin";
    const username = input.username ?? `${role}-${userCounter}`;
    const password = input.password ?? TEST_DEFAULT_PASSWORD;
    const displayName = input.displayName ?? `Test ${role} ${userCounter}`;
    const email = input.email ?? null;
    const id = newId();
    const at = clock.now().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO users (id, username, username_lower, email, email_lower, display_name, role, password_hash, must_change_password, disabled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        id,
        username,
        username.toLowerCase(),
        email,
        email?.toLowerCase() ?? null,
        displayName,
        role,
        await testPasswordHash(password),
        input.mustChangePassword ? 1 : 0,
        input.disabled ? at : null,
        at,
        at
      );
    return { displayName, email, id, password, role, username };
  };

  const login = async (user: TestUser): Promise<TestClient> => {
    const client = createClient(handle);
    const response = await client.post("/api/auth/login", {
      identifier: user.username,
      password: user.password,
    });
    if (response.status !== 200) {
      throw new Error(
        `Test sign-in failed for "${user.username}": ${response.status} ${response.error?.code ?? ""} ${response.error?.message ?? ""}`
      );
    }
    return client;
  };

  const setSettings = async (patch: SettingsPatch): Promise<void> => {
    const previous = await loadSettings(db);
    const next = mergeSettings(previous, patch);
    const problems = validateSettings(next);
    if (problems.length > 0) {
      throw new Error(`setSettings: ${problems.join(" ")}`);
    }
    await db.batch(
      settingsWriteStatements(db, next, previous, {
        actorId: null,
        now: clock.now(),
      })
    );
  };

  return {
    anonymous: createClient(handle),
    clock,
    createUser,
    db,
    env,
    handle,
    login,
    loginAs: async (role) => await login(await createUser({ role })),
    setSettings,
    sqlite: db.sqlite,
  };
}
