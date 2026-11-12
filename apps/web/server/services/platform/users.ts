/**
 * User accounts: the queries and admin mutations behind `server/routes/users.ts`.
 *
 * Rules enforced here (spec §4, §7.10):
 *  - users are NEVER deleted — disabling is the off switch, so audit history keeps its actor;
 *  - the last ACTIVE administrator can be neither demoted nor disabled, checked twice: once
 *    up front for a readable error, and once INSIDE the write (`WHERE … EXISTS (another
 *    active admin)` + `guardChanged`) so two admins demoting each other at the same moment
 *    cannot both succeed;
 *  - an admin cannot disable their own account or reset their own password (the second
 *    would end the very session that asked for it — use Change password);
 *  - every change is ONE `db.batch` of the write(s) and its audit row; snapshots contain
 *    profile fields only, never a hash.
 */

import type { Role } from "../../../shared/roles";
import type {
  CreateUserInput,
  ListUsersQuery,
  TemporaryPasswordResponse,
  UpdateUserInput,
  UserDto,
} from "../../../shared/schemas/users";
import { actorOf, auditStatement } from "../../audit";
import {
  generateTemporaryPassword,
  hashPassword,
  iterationsFromEnv,
} from "../../auth/password";
import { deleteUserSessionsStatement } from "../../auth/session";
import type { D1DatabaseLike, D1PreparedStatement } from "../../env";
import { guardChanged, isGuardFailure, isUniqueViolation } from "../../guards";
import { escapeLike, HttpError, type Paging } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";

export interface UserRow {
  created_at: string;
  disabled_at: string | null;
  display_name: string;
  email: string | null;
  id: string;
  last_login_at: string | null;
  must_change_password: number;
  password_changed_at: string | null;
  /** Constrained by a CHECK in the schema, so always a valid `Role`. */
  role: Role;
  updated_at: string;
  username: string;
}

export interface UserPage {
  items: UserDto[];
  total: number;
}

/** Deliberately lists no `password_hash`: a query built from this cannot leak it. */
const USER_COLUMNS =
  "id, username, email, display_name, role, must_change_password, disabled_at, last_login_at, password_changed_at, created_at, updated_at";

const OTHER_ACTIVE_ADMIN =
  "EXISTS (SELECT 1 FROM users other WHERE other.id <> users.id AND other.role = 'admin' AND other.disabled_at IS NULL)";

const UPDATE_PROFILE_SQL = `UPDATE users SET display_name = ?, email = ?, email_lower = ?, role = ?, updated_at = ? WHERE id = ? AND (? = 0 OR ${OTHER_ACTIVE_ADMIN})`;
const DISABLE_SQL = `UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ? AND disabled_at IS NULL AND (role <> 'admin' OR ${OTHER_ACTIVE_ADMIN})`;
const ENABLE_SQL =
  "UPDATE users SET disabled_at = NULL, updated_at = ? WHERE id = ? AND disabled_at IS NOT NULL";
const RESET_PASSWORD_SQL =
  "UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?";
const INSERT_USER_SQL =
  "INSERT INTO users (id, username, username_lower, email, email_lower, display_name, role, password_hash, must_change_password, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)";

export function toUserDto(row: UserRow): UserDto {
  return {
    createdAt: row.created_at,
    disabled: row.disabled_at !== null,
    disabledAt: row.disabled_at,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    lastLoginAt: row.last_login_at,
    mustChangePassword: row.must_change_password === 1,
    passwordChangedAt: row.password_changed_at,
    role: row.role,
    updatedAt: row.updated_at,
    username: row.username,
  };
}

async function findUser(
  db: D1DatabaseLike,
  id: string
): Promise<UserRow | null> {
  return await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(id)
    .first<UserRow>();
}

async function requireUser(db: D1DatabaseLike, id: string): Promise<UserRow> {
  const row = await findUser(db, id);
  if (!row) {
    throw new HttpError("not_found", "That user does not exist.");
  }
  return row;
}

function listFilter(query: ListUsersQuery): {
  values: string[];
  where: string;
} {
  const clauses: string[] = [];
  const values: string[] = [];
  if (query.role) {
    clauses.push("role = ?");
    values.push(query.role);
  }
  if (query.status === "active") {
    clauses.push("disabled_at IS NULL");
  }
  if (query.status === "disabled") {
    clauses.push("disabled_at IS NOT NULL");
  }
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    clauses.push(
      "(username_lower LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR email_lower LIKE ? ESCAPE '\\')"
    );
    values.push(pattern, pattern, pattern);
  }
  return {
    values,
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}

export async function listUsers(
  db: D1DatabaseLike,
  query: ListUsersQuery,
  paging: Paging
): Promise<UserPage> {
  const { values, where } = listFilter(query);
  const [counted, page] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total FROM users ${where}`)
      .bind(...values)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT ${USER_COLUMNS} FROM users ${where} ORDER BY lower(display_name), username_lower LIMIT ? OFFSET ?`
      )
      .bind(...values, paging.limit, paging.offset)
      .all<UserRow>(),
  ]);
  return { items: page.results.map(toUserDto), total: counted?.total ?? 0 };
}

// ─── Helpers for the mutations ──────────────────────────────────────────────

function snapshot(
  row: Pick<
    UserRow,
    "disabled_at" | "display_name" | "email" | "role" | "username"
  >
): Record<string, unknown> {
  return {
    disabled: row.disabled_at !== null,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    username: row.username,
  };
}

function isActiveAdmin(row: UserRow): boolean {
  return row.role === "admin" && row.disabled_at === null;
}

async function countOtherActiveAdmins(
  db: D1DatabaseLike,
  excludeId: string
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL AND id <> ?"
    )
    .bind(excludeId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function lastAdminError(action: string): HttpError {
  return new HttpError(
    "conflict",
    `You can't ${action} the last active administrator. Make someone else an administrator first.`
  );
}

function translateWriteError(error: unknown, guardError: HttpError): Error {
  if (isUniqueViolation(error, "users.username_lower")) {
    return new HttpError("conflict", "That username is already taken.", {
      field: "username",
    });
  }
  if (isUniqueViolation(error, "users.email_lower")) {
    return new HttpError("conflict", "That email address is already in use.", {
      field: "email",
    });
  }
  if (isGuardFailure(error)) {
    return guardError;
  }
  return error instanceof Error
    ? error
    : new Error("Database write failed.", { cause: error });
}

async function writeUserBatch(
  db: D1DatabaseLike,
  statements: D1PreparedStatement[],
  guardError: HttpError
): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    throw translateWriteError(error, guardError);
  }
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export async function createUserAccount(
  ctx: ProtectedRouteContext,
  input: CreateUserInput
): Promise<TemporaryPasswordResponse> {
  const temporaryPassword =
    input.temporaryPassword ?? generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword, {
    iterations: iterationsFromEnv(ctx.env),
  });
  const id = newId();
  const at = ctx.now.toISOString();
  const email = input.email ?? null;

  await writeUserBatch(
    ctx.db,
    [
      ctx.db
        .prepare(INSERT_USER_SQL)
        .bind(
          id,
          input.username,
          input.username.toLowerCase(),
          email,
          email?.toLowerCase() ?? null,
          input.displayName,
          input.role,
          passwordHash,
          ctx.user.id,
          at,
          at
        ),
      auditStatement(ctx.db, {
        action: "user.create",
        actor: actorOf(ctx.user),
        after: {
          disabled: false,
          displayName: input.displayName,
          email,
          role: input.role,
          username: input.username,
        },
        at,
        entityId: id,
        entityType: "user",
        ip: ctx.ip,
        summary: `Created user "${input.username}" (${input.role})`,
      }),
    ],
    lastAdminError("change")
  );
  return {
    temporaryPassword,
    user: toUserDto(await requireUser(ctx.db, id)),
  };
}

function describeProfileChange(
  before: UserRow,
  next: { displayName: string; email: string | null; role: Role }
): string {
  const changes: string[] = [];
  if (next.role !== before.role) {
    changes.push(`role ${before.role} → ${next.role}`);
  }
  if (next.displayName !== before.display_name) {
    changes.push("name");
  }
  if (next.email !== before.email) {
    changes.push("email");
  }
  return `Updated user "${before.username}": ${changes.join(", ")}`;
}

export async function updateUserAccount(
  ctx: ProtectedRouteContext,
  id: string,
  input: UpdateUserInput
): Promise<UserDto> {
  const before = await requireUser(ctx.db, id);
  const next = {
    displayName: input.displayName ?? before.display_name,
    email: input.email === undefined ? before.email : input.email,
    role: input.role ?? before.role,
  };
  const unchanged =
    next.displayName === before.display_name &&
    next.email === before.email &&
    next.role === before.role;
  if (unchanged) {
    return toUserDto(before);
  }

  const removesAdmin = isActiveAdmin(before) && next.role !== "admin";
  const guardError = lastAdminError("change the role of");
  if (removesAdmin && (await countOtherActiveAdmins(ctx.db, id)) === 0) {
    throw guardError;
  }
  const at = ctx.now.toISOString();
  await writeUserBatch(
    ctx.db,
    [
      ctx.db
        .prepare(UPDATE_PROFILE_SQL)
        .bind(
          next.displayName,
          next.email,
          next.email?.toLowerCase() ?? null,
          next.role,
          at,
          id,
          removesAdmin ? 1 : 0
        ),
      guardChanged(ctx.db, 1),
      auditStatement(ctx.db, {
        action: "user.update",
        actor: actorOf(ctx.user),
        after: snapshot({ ...before, ...toRowFields(next) }),
        at,
        before: snapshot(before),
        entityId: id,
        entityType: "user",
        ip: ctx.ip,
        summary: describeProfileChange(before, next),
      }),
    ],
    guardError
  );
  return toUserDto(await requireUser(ctx.db, id));
}

function toRowFields(next: {
  displayName: string;
  email: string | null;
  role: Role;
}): Pick<UserRow, "display_name" | "email" | "role"> {
  return { display_name: next.displayName, email: next.email, role: next.role };
}

export async function disableUserAccount(
  ctx: ProtectedRouteContext,
  id: string
): Promise<UserDto> {
  if (id === ctx.user.id) {
    throw new HttpError("conflict", "You can't disable your own account.");
  }
  const before = await requireUser(ctx.db, id);
  if (before.disabled_at !== null) {
    return toUserDto(before);
  }
  const guardError = lastAdminError("disable");
  if (
    isActiveAdmin(before) &&
    (await countOtherActiveAdmins(ctx.db, id)) === 0
  ) {
    throw guardError;
  }
  const at = ctx.now.toISOString();
  await writeUserBatch(
    ctx.db,
    [
      ctx.db.prepare(DISABLE_SQL).bind(at, at, id),
      guardChanged(ctx.db, 1),
      deleteUserSessionsStatement(ctx.db, id),
      auditStatement(ctx.db, {
        action: "user.disable",
        actor: actorOf(ctx.user),
        after: snapshot({ ...before, disabled_at: at }),
        at,
        before: snapshot(before),
        entityId: id,
        entityType: "user",
        ip: ctx.ip,
        summary: `Disabled user "${before.username}"`,
      }),
    ],
    guardError
  );
  return toUserDto(await requireUser(ctx.db, id));
}

export async function enableUserAccount(
  ctx: ProtectedRouteContext,
  id: string
): Promise<UserDto> {
  const before = await requireUser(ctx.db, id);
  if (before.disabled_at === null) {
    return toUserDto(before);
  }
  const at = ctx.now.toISOString();
  await writeUserBatch(
    ctx.db,
    [
      ctx.db.prepare(ENABLE_SQL).bind(at, id),
      guardChanged(ctx.db, 1),
      auditStatement(ctx.db, {
        action: "user.enable",
        actor: actorOf(ctx.user),
        after: snapshot({ ...before, disabled_at: null }),
        at,
        before: snapshot(before),
        entityId: id,
        entityType: "user",
        ip: ctx.ip,
        summary: `Enabled user "${before.username}"`,
      }),
    ],
    lastAdminError("change")
  );
  return toUserDto(await requireUser(ctx.db, id));
}

export async function resetUserPassword(
  ctx: ProtectedRouteContext,
  id: string
): Promise<TemporaryPasswordResponse> {
  if (id === ctx.user.id) {
    throw new HttpError(
      "conflict",
      "Use Change password to update your own password."
    );
  }
  const before = await requireUser(ctx.db, id);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword, {
    iterations: iterationsFromEnv(ctx.env),
  });
  const at = ctx.now.toISOString();
  await writeUserBatch(
    ctx.db,
    [
      ctx.db.prepare(RESET_PASSWORD_SQL).bind(passwordHash, at, id),
      guardChanged(ctx.db, 1),
      deleteUserSessionsStatement(ctx.db, id),
      auditStatement(ctx.db, {
        action: "user.reset_password",
        actor: actorOf(ctx.user),
        after: { temporaryCredential: true },
        at,
        before: { temporaryCredential: before.must_change_password === 1 },
        entityId: id,
        entityType: "user",
        ip: ctx.ip,
        summary: `Reset the password of "${before.username}" and ended their sessions`,
      }),
    ],
    lastAdminError("change")
  );
  return {
    temporaryPassword,
    user: toUserDto(await requireUser(ctx.db, id)),
  };
}
