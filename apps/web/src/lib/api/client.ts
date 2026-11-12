import {
  type ApiMeta,
  type ApiSuccessBody,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
} from "@shared/api";

import { reportNetworkFailure, reportNetworkSuccess } from "@/lib/online";

import {
  ApiError,
  codeForStatus,
  isApiErrorCode,
  isRecord,
  networkError,
} from "./errors";

/**
 * The only way the SPA talks to `/api/*`. It unwraps the `{ data }` envelope,
 * sends the cookie + CSRF header the server requires, and turns every failure
 * into an `ApiError` (`./errors.ts`).
 *
 * Paths are relative to `/api`: `apiGet("/items", { limit: 50 })` requests
 * `/api/items?limit=50`. (A leading `/api` is tolerated and not doubled.)
 */

export type QueryValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | readonly (boolean | number | string)[];

/** Query parameters. `undefined`, `null` and `""` are omitted; arrays are comma-joined. */
export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface RequestOptions {
  /**
   * Do not run the global session redirects (401 → /login, 403
   * `password_change_required` → /change-password) for this call. Route guards
   * pass this: they handle the 401 themselves, with the right `?redirect=`.
   */
  quiet?: boolean;
  signal?: AbortSignal;
}

export interface ApiClientHooks {
  onPasswordChangeRequired?: () => void;
  onUnauthenticated?: () => void;
}

type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

const API_PREFIX = "/api";
const UNSAFE_METHODS: ReadonlySet<HttpMethod> = new Set([
  "DELETE",
  "PATCH",
  "POST",
  "PUT",
]);
const LEADING_API_SEGMENT = /^\/?api(?=\/|$)/;
const LEADING_SLASHES = /^\/+/;
const STATUS_NO_CONTENT = 204;
const STATUS_RESET_CONTENT = 205;
const STATUS_UNAUTHORIZED = 401;
const STATUS_FORBIDDEN = 403;

const NETWORK_ERROR_MESSAGE =
  "Can't reach the server. Check your connection and try again.";
const UNREADABLE_MESSAGE = "The server sent a response the app can't read.";

let hooks: ApiClientHooks = {};

/** Installed once at startup (`app/router.ts`); tests install their own. */
export function setApiClientHooks(next: ApiClientHooks): void {
  hooks = next;
}

function resolvePath(path: string): string {
  const trimmed = path
    .replace(LEADING_API_SEGMENT, "")
    .replace(LEADING_SLASHES, "");
  return trimmed === "" ? API_PREFIX : `${API_PREFIX}/${trimmed}`;
}

function serializeValue(value: QueryValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return value
      .map((entry) => String(entry))
      .filter((entry) => entry !== "")
      .join(",");
  }
  return String(value);
}

export function buildQueryString(params: QueryParams | undefined): string {
  if (!params) {
    return "";
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const text = serializeValue(value);
    if (text !== "") {
      // Commas stay literal: `status=urgent,expired` reads better in the network tab.
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(text).replaceAll("%2C", ",")}`
      );
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readPayload(response: Response): Promise<unknown> {
  if (
    response.status === STATUS_NO_CONTENT ||
    response.status === STATUS_RESET_CONTENT
  ) {
    return undefined;
  }
  const text = await response.text();
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function retryAfterHeader(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  const seconds = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function toApiError(response: Response, payload: unknown): ApiError {
  const { status } = response;
  const retryAfterSeconds = retryAfterHeader(response);
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
  ) {
    const { code, details, message } = payload.error;
    return new ApiError({
      code: isApiErrorCode(code) ? code : codeForStatus(status),
      details,
      message,
      retryAfterSeconds,
      status,
    });
  }
  return new ApiError({
    code: codeForStatus(status),
    message: `The server could not complete the request (HTTP ${status}).`,
    retryAfterSeconds,
    status,
  });
}

function unwrap(response: Response, payload: unknown): ApiSuccessBody<unknown> {
  if (payload === undefined) {
    return { data: undefined };
  }
  if (isRecord(payload) && "data" in payload) {
    return {
      data: payload.data,
      meta: isRecord(payload.meta) ? (payload.meta as ApiMeta) : undefined,
    };
  }
  throw new ApiError({
    code: "internal_error",
    message: UNREADABLE_MESSAGE,
    status: response.status,
  });
}

function runSessionHooks(error: ApiError): void {
  if (
    error.status === STATUS_UNAUTHORIZED &&
    error.code === "unauthenticated"
  ) {
    hooks.onUnauthenticated?.();
    return;
  }
  if (
    error.status === STATUS_FORBIDDEN &&
    error.code === "password_change_required"
  ) {
    hooks.onPasswordChangeRequired?.();
  }
}

async function send(
  method: HttpMethod,
  path: string,
  params: QueryParams | undefined,
  body: unknown,
  options: RequestOptions | undefined
): Promise<ApiSuccessBody<unknown>> {
  const headers: Record<string, string> = { accept: "application/json" };
  const init: RequestInit = {
    credentials: "same-origin",
    headers,
    method,
    signal: options?.signal,
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (UNSAFE_METHODS.has(method)) {
    headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
  }

  let response: Response;
  try {
    response = await fetch(
      `${resolvePath(path)}${buildQueryString(params)}`,
      init
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    reportNetworkFailure();
    throw networkError(error, NETWORK_ERROR_MESSAGE);
  }

  reportNetworkSuccess();
  const payload = await readPayload(response);
  if (!response.ok) {
    const error = toApiError(response, payload);
    if (!options?.quiet) {
      runSessionHooks(error);
    }
    throw error;
  }
  return unwrap(response, payload);
}

/** `GET /api<path>` → the unwrapped `data`. */
export async function apiGet<T>(
  path: string,
  params?: QueryParams,
  options?: RequestOptions
): Promise<T> {
  const { data } = await send("GET", path, params, undefined, options);
  return data as T;
}

/** `GET /api<path>` for list endpoints → `data` plus the paging `meta`. */
export async function apiGetPage<T>(
  path: string,
  params?: QueryParams,
  options?: RequestOptions
): Promise<{ data: T; meta: ApiMeta }> {
  const { data, meta } = await send("GET", path, params, undefined, options);
  return { data: data as T, meta: meta ?? {} };
}

export async function apiPost<T = void>(
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<T> {
  const { data } = await send("POST", path, undefined, body, options);
  return data as T;
}

export async function apiPut<T = void>(
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<T> {
  const { data } = await send("PUT", path, undefined, body, options);
  return data as T;
}

export async function apiPatch<T = void>(
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<T> {
  const { data } = await send("PATCH", path, undefined, body, options);
  return data as T;
}

export async function apiDelete<T = void>(
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<T> {
  const { data } = await send("DELETE", path, undefined, body, options);
  return data as T;
}
