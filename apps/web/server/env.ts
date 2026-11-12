/**
 * Cloudflare bindings, typed by hand.
 *
 * Deliberately no `@cloudflare/workers-types` dependency: the app needs a
 * handful of declarations, and a
 * generated types package would add a second source of truth for the runtime.
 * The shapes below are the subset of D1 / Pages the code actually calls.
 *
 * D1 limits that shape how queries are written (they are enforced by the test
 * harness in `test/harness.ts` so a violation fails locally, not in production):
 *  - at most 100 bound parameters per statement → chunk `IN (…)` lists to ≤ 90;
 *  - `undefined` cannot be bound → pass `null`; booleans → bind `1` / `0` explicitly
 *    (D1 would coerce them, the test harness rejects them so intent stays visible);
 *  - `exec()` splits on newlines → never use it in application code;
 *  - `batch()` is one implicit transaction: if any statement throws, all roll back.
 */

export interface D1ResultMeta {
  changed_db?: boolean;
  changes: number;
  duration?: number;
  last_row_id: number;
  rows_read?: number;
  rows_written?: number;
  size_after?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  meta: D1ResultMeta;
  results: T[];
  success: boolean;
}

export interface D1PreparedStatement {
  all: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  raw: <T = unknown[]>() => Promise<T[]>;
  run: () => Promise<D1Result>;
}

export interface D1DatabaseLike {
  batch: <T = Record<string, unknown>>(
    statements: D1PreparedStatement[]
  ) => Promise<D1Result<T>[]>;
  exec: (query: string) => Promise<{ count: number; duration: number }>;
  prepare: (query: string) => D1PreparedStatement;
}

/** Bindings and variables available to the Pages Functions API. */
export interface Env {
  /** `production` | `preview` | `local`. Informational (e.g. the health endpoint). */
  APP_ENV?: string;
  /** The D1 binding declared in `wrangler.toml`. */
  DB: D1DatabaseLike;
  /** PBKDF2 iterations for new password hashes (bounded 10_000..100_000). Default 100_000. */
  PASSWORD_ITERATIONS?: string;
  /** Secret mixed into session-token hashes. Set with `wrangler pages secret put SESSION_PEPPER`. */
  SESSION_PEPPER: string;
  /** Public VAPID key (base64url, 65-byte point) handed to browsers for Web Push. */
  VAPID_PUBLIC_KEY?: string;
}

/** The slice of Pages' `EventContext` the catch-all Function uses. */
export interface PagesContext {
  env: Env;
  params: Record<string, string | string[] | undefined>;
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
}
