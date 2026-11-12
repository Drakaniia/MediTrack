import { API_ERROR_CODES, type ApiErrorCode } from "@shared/api";

/** The status → code map for responses that carry no `{ error }` envelope (gateway pages, etc.). */
const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  429: "rate_limited",
};

export function codeForStatus(status: number): ApiErrorCode {
  return CODE_BY_STATUS[status] ?? "internal_error";
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === "string" &&
    (API_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function retryAfterFromDetails(details: unknown): number | null {
  if (!isRecord(details)) {
    return null;
  }
  const seconds = details.retryAfterSeconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : null;
}

export interface ApiErrorInit {
  cause?: unknown;
  code: ApiErrorCode;
  details?: unknown;
  message: string;
  /** From `details.retryAfterSeconds`, falling back to the `Retry-After` header. */
  retryAfterSeconds?: number | null;
  /** 0 for `network_error` (no response). */
  status: number;
}

/**
 * Every failed API call rejects with one of these. `code` is the server's
 * error code (`shared/api.ts`) or the client-side `network_error`; `message` is
 * safe to show to the user; `details` is the machine-readable extra (e.g.
 * `{ existingBatchId }` for `duplicate_batch`, `{ issues }` for validation).
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: unknown;
  readonly retryAfterSeconds: number | null;
  readonly status: number;

  constructor(init: ApiErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = "ApiError";
    this.code = init.code;
    this.details = init.details;
    this.retryAfterSeconds =
      init.retryAfterSeconds ?? retryAfterFromDetails(init.details);
    this.status = init.status;
  }
}

/** The error for a `fetch` that never got a response (offline, DNS, server down); `cause` is the original failure. */
export function networkError(cause: unknown, message: string): ApiError {
  return new ApiError({ cause, code: "network_error", message, status: 0 });
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isNetworkError(error: unknown): boolean {
  return isApiError(error) && error.code === "network_error";
}

/** The message to show for any thrown value: the API's own text, else `fallback`. */
export function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) && error.message !== "" ? error.message : fallback;
}

export interface ValidationIssue {
  message: string;
  /** Dotted path of the offending field, e.g. `newPassword` or `lines.0.qty`. */
  path: string;
}

/** `details.issues` of a `validation_error`, normalised; `[]` for any other error. */
export function validationIssues(error: unknown): ValidationIssue[] {
  if (!(isApiError(error) && isRecord(error.details))) {
    return [];
  }
  const { issues } = error.details;
  if (!Array.isArray(issues)) {
    return [];
  }
  const result: ValidationIssue[] = [];
  for (const issue of issues) {
    if (isRecord(issue) && typeof issue.message === "string") {
      const { path } = issue;
      result.push({
        message: issue.message,
        path: Array.isArray(path) ? path.join(".") : String(path ?? ""),
      });
    }
  }
  return result;
}

/** First message per field path from a `validation_error`. */
export function fieldErrors(error: unknown): Record<string, string> {
  const byField: Record<string, string> = {};
  for (const { message, path } of validationIssues(error)) {
    if (!(path in byField)) {
      byField[path] = message;
    }
  }
  return byField;
}
