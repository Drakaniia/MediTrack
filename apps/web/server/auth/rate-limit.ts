/**
 * Login throttling on the `login_attempts` table (spec §8.4).
 *
 * Two independent buckets are checked on every sign-in:
 *   `user:<identifier>|ip:<ip>`  5 failures / 15 min  (guessing one account from one address)
 *   `ip:<ip>`                    30 failures / 15 min (spraying many accounts from one address)
 *
 * Only FAILURES count. A success clears the user+ip bucket (a fat-fingered password is
 * forgiven) but never the ip bucket, so a spray cannot be reset by signing in to an
 * account the attacker owns. Blocked attempts are not recorded, so waiting is enough:
 * hammering a locked bucket does not extend the lock. Attempts older than a day are
 * purged by every write. Without a client address (local dev) the literal `unknown`
 * stands in for the ip.
 */

import type { D1DatabaseLike, D1PreparedStatement } from "../env";
import { HttpError } from "../http";

export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_USER_LIMIT = 5;
export const LOGIN_IP_LIMIT = 30;
export const LOGIN_ATTEMPT_RETENTION_SECONDS = 24 * 60 * 60;
export const UNKNOWN_IP = "unknown";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MAX_IDENTIFIER_LENGTH = 100;

export interface LoginThrottleIds {
  /** What the person typed (username or email). Case-insensitive. */
  identifier: string;
  /** `CF-Connecting-IP`, or null when there is none (local dev). */
  ip: string | null;
}

export interface LoginBuckets {
  ip: string;
  user: string;
}

export function loginBuckets(ids: LoginThrottleIds): LoginBuckets {
  const ip = ids.ip?.trim() || UNKNOWN_IP;
  const identifier = ids.identifier
    .trim()
    .toLowerCase()
    .slice(0, MAX_IDENTIFIER_LENGTH);
  return { ip: `ip:${ip}`, user: `user:${identifier}|ip:${ip}` };
}

/**
 * When `bucket` has `limit` failures inside the window, the instant (epoch ms) at which
 * the oldest of them ages out and one more attempt is allowed. `null` = not blocked.
 */
async function blockedUntilMs(
  db: D1DatabaseLike,
  bucket: string,
  limit: number,
  sinceIso: string
): Promise<number | null> {
  const { results } = await db
    .prepare(
      "SELECT attempted_at FROM login_attempts WHERE bucket = ? AND success = 0 AND attempted_at > ? ORDER BY attempted_at DESC LIMIT ?"
    )
    .bind(bucket, sinceIso, limit)
    .all<{ attempted_at: string }>();
  const oldestCounted = results.at(-1);
  if (results.length < limit || !oldestCounted) {
    return null;
  }
  return (
    Date.parse(oldestCounted.attempted_at) +
    LOGIN_WINDOW_SECONDS * MS_PER_SECOND
  );
}

function throttledError(retryAfterSeconds: number): HttpError {
  const minutes = Math.ceil(retryAfterSeconds / SECONDS_PER_MINUTE);
  const unit = minutes === 1 ? "minute" : "minutes";
  return new HttpError(
    "rate_limited",
    `Too many failed sign-in attempts. Try again in ${minutes} ${unit}.`,
    { retryAfterSeconds }
  );
}

/** Throws `HttpError("rate_limited", …, { retryAfterSeconds })` when either bucket is full. */
export async function assertLoginAllowed(
  db: D1DatabaseLike,
  ids: LoginThrottleIds,
  now: Date
): Promise<void> {
  const buckets = loginBuckets(ids);
  const sinceIso = new Date(
    now.getTime() - LOGIN_WINDOW_SECONDS * MS_PER_SECOND
  ).toISOString();
  const [userUntil, ipUntil] = await Promise.all([
    blockedUntilMs(db, buckets.user, LOGIN_USER_LIMIT, sinceIso),
    blockedUntilMs(db, buckets.ip, LOGIN_IP_LIMIT, sinceIso),
  ]);
  if (userUntil === null && ipUntil === null) {
    return;
  }
  const until = Math.max(userUntil ?? 0, ipUntil ?? 0);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((until - now.getTime()) / MS_PER_SECOND)
  );
  throw throttledError(retryAfterSeconds);
}

export function purgeLoginAttemptsStatement(
  db: D1DatabaseLike,
  now: Date
): D1PreparedStatement {
  const cutoff = new Date(
    now.getTime() - LOGIN_ATTEMPT_RETENTION_SECONDS * MS_PER_SECOND
  ).toISOString();
  return db
    .prepare("DELETE FROM login_attempts WHERE attempted_at < ?")
    .bind(cutoff);
}

function insertAttempt(
  db: D1DatabaseLike,
  bucket: string,
  success: boolean,
  now: Date
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO login_attempts (bucket, attempted_at, success) VALUES (?, ?, ?)"
    )
    .bind(bucket, now.toISOString(), success ? 1 : 0);
}

/**
 * The statements that record one sign-in outcome, for callers that batch them with their
 * own writes. Failure: one row per bucket. Success: clear the user+ip bucket, note the win.
 */
export function loginAttemptStatements(
  db: D1DatabaseLike,
  ids: LoginThrottleIds,
  success: boolean,
  now: Date
): D1PreparedStatement[] {
  const buckets = loginBuckets(ids);
  const statements: D1PreparedStatement[] = [];
  if (success) {
    statements.push(
      db
        .prepare("DELETE FROM login_attempts WHERE bucket = ?")
        .bind(buckets.user)
    );
  }
  statements.push(
    insertAttempt(db, buckets.user, success, now),
    insertAttempt(db, buckets.ip, success, now),
    purgeLoginAttemptsStatement(db, now)
  );
  return statements;
}

export async function recordLoginAttempt(
  db: D1DatabaseLike,
  ids: LoginThrottleIds,
  success: boolean,
  now: Date
): Promise<void> {
  await db.batch(loginAttemptStatements(db, ids, success, now));
}
