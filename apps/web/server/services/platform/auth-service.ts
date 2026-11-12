/**
 * The authentication flows behind `server/routes/auth.ts`: sign-in, sign-out, the `me`
 * bootstrap payload and password change. Route handlers stay thin; everything that
 * touches the database or decides a security question lives here.
 *
 * Sign-in is deliberately uniform:
 *  - the throttle is checked first (a locked bucket answers 429 without any work);
 *  - a password verification ALWAYS runs — against `DUMMY_PASSWORD_HASH` for unknown and
 *    disabled accounts — so response time does not reveal which accounts exist;
 *  - unknown account, wrong password and disabled account produce the IDENTICAL 401;
 *    only the audit row (visible to admins) records which one it was.
 */

import { todayInZone } from "../../../shared/dates";
import { permissionsFor } from "../../../shared/permissions";
import type { Role } from "../../../shared/roles";
import type {
  ChangePasswordInput,
  LoginInput,
  MeResponse,
} from "../../../shared/session";
import { toPublicSettings } from "../../../shared/settings";
import { actorOf, auditStatement } from "../../audit";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  iterationsFromEnv,
  verifyPassword,
} from "../../auth/password";
import {
  assertLoginAllowed,
  type LoginThrottleIds,
  loginAttemptStatements,
} from "../../auth/rate-limit";
import {
  buildSessionCookie,
  deleteSessionStatement,
  deleteUserSessionsStatement,
  isSecureRequest,
  prepareSession,
  purgeExpiredSessionsStatement,
  requirePepper,
  SESSION_IDLE_SECONDS,
} from "../../auth/session";
import type { D1DatabaseLike } from "../../env";
import { guardChanged } from "../../guards";
import { HttpError } from "../../http";
import type {
  AuthUser,
  ProtectedRouteContext,
  PublicRouteContext,
} from "../../route-types";
import { loadSettings } from "../../settings-store";

const MAX_AUDITED_IDENTIFIER = 80;
const INVALID_CREDENTIALS_MESSAGE = "Incorrect username or password.";

interface LoginCandidate {
  disabled_at: string | null;
  display_name: string;
  email: string | null;
  id: string;
  must_change_password: number;
  password_hash: string;
  role: Role;
  username: string;
}

export interface LoginOutcome {
  /** The `Set-Cookie` value for the new session. */
  cookie: string;
  me: MeResponse;
}

type LoginFailureReason =
  | "account_disabled"
  | "unknown_account"
  | "wrong_password";

// ─── me ─────────────────────────────────────────────────────────────────────

export async function buildMeResponse(
  db: D1DatabaseLike,
  user: AuthUser,
  now: Date
): Promise<MeResponse> {
  const settings = await loadSettings(db);
  return {
    permissions: permissionsFor(user.role),
    serverTime: now.toISOString(),
    settings: toPublicSettings(settings),
    today: todayInZone(now, settings.facility.timezone),
    user: {
      displayName: user.displayName,
      email: user.email,
      id: user.id,
      mustChangePassword: user.mustChangePassword,
      role: user.role,
      username: user.username,
    },
  };
}

// ─── sign-in ────────────────────────────────────────────────────────────────

function findLoginCandidate(
  db: D1DatabaseLike,
  identifier: string
): Promise<LoginCandidate | null> {
  const lower = identifier.trim().toLowerCase();
  return db
    .prepare(
      "SELECT id, username, email, display_name, role, password_hash, must_change_password, disabled_at FROM users WHERE username_lower = ? OR email_lower = ? LIMIT 1"
    )
    .bind(lower, lower)
    .first<LoginCandidate>();
}

function failureReason(candidate: LoginCandidate | null): LoginFailureReason {
  if (candidate === null) {
    return "unknown_account";
  }
  return candidate.disabled_at === null ? "wrong_password" : "account_disabled";
}

async function recordLoginFailure(
  ctx: PublicRouteContext,
  ids: LoginThrottleIds,
  candidate: LoginCandidate | null,
  reason: LoginFailureReason
): Promise<HttpError> {
  const attempted = ids.identifier.slice(0, MAX_AUDITED_IDENTIFIER);
  await ctx.db.batch([
    ...loginAttemptStatements(ctx.db, ids, false, ctx.now),
    auditStatement(ctx.db, {
      action: "auth.login_failed",
      actor: { id: null, name: attempted, role: null },
      after: { reason },
      at: ctx.now.toISOString(),
      entityId: candidate?.id ?? null,
      entityType: "user",
      ip: ctx.ip,
      summary: `Failed sign-in for "${attempted}"`,
    }),
  ]);
  return new HttpError("invalid_credentials", INVALID_CREDENTIALS_MESSAGE);
}

function toAuthUser(candidate: LoginCandidate): AuthUser {
  return {
    displayName: candidate.display_name,
    email: candidate.email,
    id: candidate.id,
    mustChangePassword: candidate.must_change_password === 1,
    role: candidate.role,
    username: candidate.username,
  };
}

async function completeLogin(
  ctx: PublicRouteContext,
  ids: LoginThrottleIds,
  candidate: LoginCandidate,
  upgradedHash: string | null
): Promise<LoginOutcome> {
  const user = toAuthUser(candidate);
  const session = await prepareSession(ctx.db, user, {
    ip: ctx.ip,
    now: ctx.now,
    pepper: requirePepper(ctx.env),
    userAgent: ctx.request.headers.get("user-agent"),
  });
  const at = ctx.now.toISOString();
  await ctx.db.batch([
    ...loginAttemptStatements(ctx.db, ids, true, ctx.now),
    purgeExpiredSessionsStatement(ctx.db, ctx.now),
    session.insert,
    ctx.db
      .prepare(
        "UPDATE users SET last_login_at = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?"
      )
      .bind(at, upgradedHash, user.id),
    auditStatement(ctx.db, {
      action: "auth.login",
      actor: actorOf(user),
      at,
      entityId: user.id,
      entityType: "user",
      ip: ctx.ip,
      summary: "Signed in",
    }),
  ]);
  return {
    cookie: buildSessionCookie(session.token, {
      maxAgeSeconds: SESSION_IDLE_SECONDS,
      secure: isSecureRequest(ctx.request),
    }),
    me: await buildMeResponse(ctx.db, user, ctx.now),
  };
}

export async function performLogin(
  ctx: PublicRouteContext,
  input: LoginInput
): Promise<LoginOutcome> {
  const ids: LoginThrottleIds = { identifier: input.identifier, ip: ctx.ip };
  await assertLoginAllowed(ctx.db, ids, ctx.now);

  const candidate = await findLoginCandidate(ctx.db, input.identifier);
  const target = iterationsFromEnv(ctx.env);
  const usable = candidate !== null && candidate.disabled_at === null;
  // Always verify, even when there is nobody to verify against (see the file header).
  const check = await verifyPassword(
    input.password,
    usable ? candidate.password_hash : DUMMY_PASSWORD_HASH,
    target
  );

  if (candidate === null || candidate.disabled_at !== null || !check.ok) {
    throw await recordLoginFailure(
      ctx,
      ids,
      candidate,
      failureReason(candidate)
    );
  }
  const upgradedHash = check.needsRehash
    ? await hashPassword(input.password, { iterations: target })
    : null;
  return await completeLogin(ctx, ids, candidate, upgradedHash);
}

// ─── sign-out ───────────────────────────────────────────────────────────────

/** Ends the current session, or every session of the user when `everywhere`. */
export async function performLogout(
  ctx: ProtectedRouteContext,
  everywhere: boolean
): Promise<void> {
  const removal =
    everywhere || ctx.sessionId === null
      ? deleteUserSessionsStatement(ctx.db, ctx.user.id)
      : deleteSessionStatement(ctx.db, ctx.sessionId);
  await ctx.db.batch([
    removal,
    auditStatement(ctx.db, {
      action: everywhere ? "auth.logout_all" : "auth.logout",
      actor: actorOf(ctx.user),
      at: ctx.now.toISOString(),
      entityId: ctx.user.id,
      entityType: "user",
      ip: ctx.ip,
      summary: everywhere ? "Signed out everywhere" : "Signed out",
    }),
  ]);
}

// ─── change password ────────────────────────────────────────────────────────

function passwordIssue(path: string, message: string): HttpError {
  return new HttpError("validation_error", "The request is not valid.", {
    issues: [{ message, path }],
  });
}

export async function performPasswordChange(
  ctx: ProtectedRouteContext,
  input: ChangePasswordInput
): Promise<MeResponse> {
  const stored = await ctx.db
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(ctx.user.id)
    .first<{ password_hash: string }>();
  const target = iterationsFromEnv(ctx.env);
  const current = await verifyPassword(
    input.currentPassword,
    stored?.password_hash ?? DUMMY_PASSWORD_HASH,
    target
  );
  if (!(stored && current.ok)) {
    throw passwordIssue(
      "currentPassword",
      "Your current password is incorrect."
    );
  }
  if (input.newPassword === input.currentPassword) {
    throw passwordIssue(
      "newPassword",
      "Choose a password that is different from your current one."
    );
  }
  if (input.newPassword.toLowerCase() === ctx.user.username.toLowerCase()) {
    throw passwordIssue(
      "newPassword",
      "Your password cannot be the same as your username."
    );
  }

  const newHash = await hashPassword(input.newPassword, { iterations: target });
  const at = ctx.now.toISOString();
  await ctx.db.batch([
    ctx.db
      .prepare(
        "UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?"
      )
      .bind(newHash, at, at, ctx.user.id),
    guardChanged(ctx.db, 1),
    deleteUserSessionsStatement(
      ctx.db,
      ctx.user.id,
      ctx.sessionId ?? undefined
    ),
    auditStatement(ctx.db, {
      action: "auth.password_changed",
      actor: actorOf(ctx.user),
      at,
      entityId: ctx.user.id,
      entityType: "user",
      ip: ctx.ip,
      summary: "Changed their password and signed out other devices",
    }),
  ]);
  return await buildMeResponse(
    ctx.db,
    { ...ctx.user, mustChangePassword: false },
    ctx.now
  );
}
