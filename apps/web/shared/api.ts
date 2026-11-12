/**
 * The wire format every `/api/*` route shares (spec §8.3).
 *
 *   success  → { data: T, meta?: ApiMeta }          HTTP 200 / 201
 *   failure  → { error: { code, message, details? } } HTTP 4xx / 5xx
 *
 * Lists are `{ data: T[], meta: { total, limit, offset } }`. JSON keys are
 * camelCase; database columns are snake_case and are mapped in the services.
 *
 * Add a new error code HERE (append to the list, keep it alphabetical) rather
 * than inventing strings in a route — the SPA switches on `code`.
 */

export const API_ERROR_CODES = [
  "account_disabled",
  "bad_request",
  "conflict",
  "csrf_failed",
  "duplicate_batch",
  "expired_stock",
  "forbidden",
  "insufficient_stock",
  "internal_error",
  "invalid_credentials",
  "invalid_transition",
  "method_not_allowed",
  "network_error",
  "not_found",
  "password_change_required",
  "payload_too_large",
  "rate_limited",
  "restore_conflict",
  "scan_not_found",
  "stock_conflict",
  "unauthenticated",
  "validation_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** HTTP status each code is returned with. `network_error` is client-side only. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  account_disabled: 403,
  bad_request: 400,
  conflict: 409,
  csrf_failed: 403,
  duplicate_batch: 409,
  expired_stock: 409,
  forbidden: 403,
  insufficient_stock: 409,
  internal_error: 500,
  invalid_credentials: 401,
  invalid_transition: 409,
  method_not_allowed: 405,
  network_error: 0,
  not_found: 404,
  password_change_required: 403,
  payload_too_large: 413,
  rate_limited: 429,
  restore_conflict: 409,
  scan_not_found: 404,
  stock_conflict: 409,
  unauthenticated: 401,
  validation_error: 400,
};

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Safe to show to the user. */
    message: string;
    /** Machine-readable extras, e.g. `{ existingBatchId }` for `duplicate_batch`. */
    details?: unknown;
  };
}

export interface ApiMeta {
  limit?: number;
  nextCursor?: string | null;
  offset?: number;
  total?: number;
}

export interface ApiSuccessBody<T> {
  data: T;
  meta?: ApiMeta;
}

/** Every mutating request must carry this header (CSRF defence, spec §8.4). */
export const CSRF_HEADER = "x-meditract-csrf";
export const CSRF_HEADER_VALUE = "1";

export const SESSION_COOKIE = "mt_session";

/** Default and maximum page sizes for list endpoints. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Quick Deduct can be undone for this long after it happened (server-enforced). */
export const QUICK_DEDUCT_UNDO_SECONDS = 60;
