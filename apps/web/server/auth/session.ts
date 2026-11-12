/**
 * Server-side sessions (spec §8.4).
 *
 *  - The browser holds a random 256-bit token in an `HttpOnly` cookie; the database
 *    only ever holds `sessions.id = hex(sha256(token + SESSION_PEPPER))`, so a leaked
 *    database cannot be replayed as cookies.
 *  - Two clocks: IDLE (`expires_at`, 8 h, slides forward while the user is active) and
 *    ABSOLUTE (`absolute_expires_at`, 7 d from sign-in, never extended).
 *  - Sliding is throttled: at most ONE `UPDATE` per `SESSION_REFRESH_AFTER_SECONDS`,
 *    so a page that fires ten requests does not write ten times.
 */

import { SESSION_COOKIE } from "../../shared/api";
import { isRole } from "../../shared/roles";
import type { D1DatabaseLike, D1PreparedStatement, Env } from "../env";
import type { AuthUser } from "../route-types";
import { randomToken, sha256Hex } from "./crypto";

export const SESSION_IDLE_SECONDS = 8 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_REFRESH_AFTER_SECONDS = 300;

const MS_PER_SECOND = 1000;
const MAX_USER_AGENT_LENGTH = 256;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{16,128}$/;
const EPOCH_HTTP_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";

export interface SessionRequestInfo {
  ip: string | null;
  now: Date;
  pepper: string;
  userAgent: string | null;
}

export interface CreatedSession {
  /** Idle expiry, ISO UTC. */
  expiresAt: string;
  sessionId: string;
  /** The raw cookie value. Shown once, never stored. */
  token: string;
}

export interface PreparedSession extends CreatedSession {
  /** The `INSERT`, for callers that put it in a larger `db.batch`. */
  insert: D1PreparedStatement;
}

export interface ResolvedSession {
  expiresAt: string;
  /** Seconds the cookie should still live (time left until `expiresAt`). */
  maxAgeSeconds: number;
  /** True when this call slid the expiry forward; re-issue the cookie. */
  refreshed: boolean;
  sessionId: string;
  user: AuthUser;
}

interface SessionRow {
  absolute_expires_at: string;
  disabled_at: string | null;
  display_name: string;
  email: string | null;
  expires_at: string;
  last_seen_at: string;
  must_change_password: number;
  role: string;
  user_id: string;
  username: string;
}

const SESSION_QUERY = [
  "SELECT s.absolute_expires_at, s.expires_at, s.last_seen_at,",
  "u.disabled_at, u.display_name, u.email, u.must_change_password, u.role,",
  "u.id AS user_id, u.username",
  "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
].join(" ");

export function sessionIdFor(token: string, pepper: string): Promise<string> {
  return sha256Hex(token + pepper);
}

/** The session pepper, or a loud failure: running without one is a deployment mistake. */
export function requirePepper(env: Pick<Env, "SESSION_PEPPER">): string {
  if (!env.SESSION_PEPPER) {
    throw new Error("SESSION_PEPPER is not configured.");
  }
  return env.SESSION_PEPPER;
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * MS_PER_SECOND);
}

/** Builds a session and its `INSERT` without running it (login batches it with the audit row). */
export async function prepareSession(
  db: D1DatabaseLike,
  user: Pick<AuthUser, "id">,
  info: SessionRequestInfo
): Promise<PreparedSession> {
  const token = randomToken();
  const sessionId = await sessionIdFor(token, info.pepper);
  const createdAt = info.now.toISOString();
  const expiresAt = addSeconds(info.now, SESSION_IDLE_SECONDS).toISOString();
  const absoluteExpiresAt = addSeconds(
    info.now,
    SESSION_ABSOLUTE_SECONDS
  ).toISOString();
  const insert = db
    .prepare(
      "INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, absolute_expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      sessionId,
      user.id,
      createdAt,
      createdAt,
      expiresAt,
      absoluteExpiresAt,
      info.ip,
      info.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null
    );
  return { expiresAt, insert, sessionId, token };
}

export async function createSession(
  db: D1DatabaseLike,
  user: Pick<AuthUser, "id">,
  info: SessionRequestInfo
): Promise<CreatedSession> {
  const { insert, ...created } = await prepareSession(db, user, info);
  await insert.run();
  return created;
}

/** Moves the idle expiry forward when the session was last touched long enough ago. */
async function refreshIfDue(
  db: D1DatabaseLike,
  sessionId: string,
  row: SessionRow,
  now: Date
): Promise<string | null> {
  const sinceSeenMs = now.getTime() - Date.parse(row.last_seen_at);
  if (sinceSeenMs < SESSION_REFRESH_AFTER_SECONDS * MS_PER_SECOND) {
    return null;
  }
  const nextExpiryMs = Math.min(
    addSeconds(now, SESSION_IDLE_SECONDS).getTime(),
    Date.parse(row.absolute_expires_at)
  );
  const expiresAt = new Date(nextExpiryMs).toISOString();
  await db
    .prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?"
    )
    .bind(now.toISOString(), expiresAt, sessionId)
    .run();
  return expiresAt;
}

/**
 * The signed-in user behind a cookie token, or `null` when the token is unknown, the
 * session has idled out or hit its absolute limit, or the account is disabled.
 */
export async function resolveSession(
  db: D1DatabaseLike,
  token: string,
  pepper: string,
  now: Date
): Promise<ResolvedSession | null> {
  const sessionId = await sessionIdFor(token, pepper);
  const row = await db
    .prepare(SESSION_QUERY)
    .bind(sessionId)
    .first<SessionRow>();
  if (!row || row.disabled_at !== null || !isRole(row.role)) {
    return null;
  }
  const nowMs = now.getTime();
  if (
    Date.parse(row.expires_at) <= nowMs ||
    Date.parse(row.absolute_expires_at) <= nowMs
  ) {
    return null;
  }
  const refreshedTo = await refreshIfDue(db, sessionId, row, now);
  const expiresAt = refreshedTo ?? row.expires_at;
  return {
    expiresAt,
    maxAgeSeconds: Math.max(
      1,
      Math.floor((Date.parse(expiresAt) - nowMs) / MS_PER_SECOND)
    ),
    refreshed: refreshedTo !== null,
    sessionId,
    user: {
      displayName: row.display_name,
      email: row.email,
      id: row.user_id,
      mustChangePassword: row.must_change_password === 1,
      role: row.role,
      username: row.username,
    },
  };
}

export function deleteSessionStatement(
  db: D1DatabaseLike,
  sessionId: string
): D1PreparedStatement {
  return db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId);
}

export async function deleteSession(
  db: D1DatabaseLike,
  sessionId: string
): Promise<void> {
  await deleteSessionStatement(db, sessionId).run();
}

/** Deletes every session of `userId`, optionally keeping one (change-password keeps the current). */
export function deleteUserSessionsStatement(
  db: D1DatabaseLike,
  userId: string,
  exceptSessionId?: string
): D1PreparedStatement {
  if (exceptSessionId) {
    return db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?")
      .bind(userId, exceptSessionId);
  }
  return db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId);
}

export async function deleteUserSessions(
  db: D1DatabaseLike,
  userId: string,
  exceptSessionId?: string
): Promise<void> {
  await deleteUserSessionsStatement(db, userId, exceptSessionId).run();
}

export function purgeExpiredSessionsStatement(
  db: D1DatabaseLike,
  now: Date
): D1PreparedStatement {
  const at = now.toISOString();
  return db
    .prepare(
      "DELETE FROM sessions WHERE expires_at <= ? OR absolute_expires_at <= ?"
    )
    .bind(at, at);
}

export async function purgeExpiredSessions(
  db: D1DatabaseLike,
  now: Date
): Promise<void> {
  await purgeExpiredSessionsStatement(db, now).run();
}

// ─── Cookies ────────────────────────────────────────────────────────────────

export interface SessionCookieOptions {
  maxAgeSeconds: number;
  /** True when the request came in over https. */
  secure: boolean;
}

export function buildSessionCookie(
  token: string,
  options: SessionCookieOptions
): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function buildClearedSessionCookie(options: {
  secure: boolean;
}): string {
  const attributes = [
    `${SESSION_COOKIE}=`,
    "Max-Age=0",
    `Expires=${EPOCH_HTTP_DATE}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

/** True when the request reached us over https (the cookie then carries `Secure`). */
export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

/** The session token from the `Cookie` header, or `null` when absent or malformed. */
export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (
      separator === -1 ||
      pair.slice(0, separator).trim() !== SESSION_COOKIE
    ) {
      continue;
    }
    const value = pair.slice(separator + 1).trim();
    return TOKEN_FORMAT.test(value) ? value : null;
  }
  return null;
}
