/**
 * Response and request-parsing helpers shared by every route (spec §8.3).
 *
 * Routes never build `Response` objects by hand: `ok()` / `created()` produce the
 * `{ data, meta? }` envelope and `throw new HttpError(...)` produces
 * `{ error: { code, message, details? } }` via the router's catch-all.
 */

import type { z } from "zod";

import {
  API_ERROR_STATUS,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiMeta,
  type ApiSuccessBody,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../shared/api";
import type { BaseRouteContext } from "./route-types";

export const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

/** Largest JSON body accepted (bulk inventory import is the biggest legitimate one). */
export const MAX_BODY_BYTES = 1_048_576;

/** An expected failure: becomes a JSON error response with the code's status. */
export class HttpError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.details = details;
    this.status = API_ERROR_STATUS[code];
  }
}

export function ok<T>(data: T, meta?: ApiMeta, init?: ResponseInit): Response {
  const body: ApiSuccessBody<T> = meta ? { data, meta } : { data };
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...init?.headers },
    status: init?.status ?? 200,
  });
}

export function created<T>(data: T, meta?: ApiMeta): Response {
  return ok(data, meta, { status: 201 });
}

export function noContent(): Response {
  return new Response(null, {
    headers: { "cache-control": "no-store" },
    status: 204,
  });
}

export function errorResponse(error: HttpError): Response {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
  return new Response(JSON.stringify(body), {
    headers: JSON_HEADERS,
    status: error.status,
  });
}

function validationError(error: z.ZodError): HttpError {
  return new HttpError("validation_error", "The request is not valid.", {
    issues: error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.join("."),
    })),
  });
}

/** Reads and validates the JSON body. Throws `bad_request` / `validation_error` / `payload_too_large`. */
export async function parseJson<S extends z.ZodType>(
  ctx: Pick<BaseRouteContext, "request">,
  schema: S
): Promise<z.output<S>> {
  const declared = Number(ctx.request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    throw new HttpError("payload_too_large", "The request body is too large.");
  }
  let text: string;
  try {
    text = await ctx.request.text();
  } catch {
    throw new HttpError("bad_request", "The request body could not be read.");
  }
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError("payload_too_large", "The request body is too large.");
  }
  let raw: unknown;
  try {
    raw = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new HttpError("bad_request", "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  return parsed.data;
}

/**
 * Validates the query string. Repeated keys collapse to the LAST value; send
 * lists comma-separated (`?status=urgent,expired`) and split in the schema.
 * Use `z.coerce.number()` etc. for numeric params.
 */
export function parseQuery<S extends z.ZodType>(
  ctx: Pick<BaseRouteContext, "query">,
  schema: S
): z.output<S> {
  const parsed = schema.safeParse(Object.fromEntries(ctx.query.entries()));
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  return parsed.data;
}

export interface Paging {
  limit: number;
  offset: number;
}

/** `?limit=&offset=` with defaults and a hard cap. Invalid values fall back, never throw. */
export function readPaging(
  ctx: Pick<BaseRouteContext, "query">,
  defaultLimit: number = DEFAULT_PAGE_SIZE
): Paging {
  const limit = Number(ctx.query.get("limit"));
  const offset = Number(ctx.query.get("offset"));
  return {
    limit:
      Number.isInteger(limit) && limit > 0
        ? Math.min(limit, MAX_PAGE_SIZE)
        : defaultLimit,
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

/** Escapes `%`, `_` and `\` so user text can be used in `LIKE ? ESCAPE '\'`. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Splits `ids` into groups of at most `size` (D1 allows 100 bound parameters per statement). */
export function chunk<T>(values: readonly T[], size = 90): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

/** `?, ?, ?` for an `IN (…)` list. Caller guarantees `count` ≤ 90 (see `chunk`). */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}
