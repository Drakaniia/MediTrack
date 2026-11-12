/**
 * Pure building blocks of `pnpm web:seed-admin` (spec §8.4): argument parsing, credential
 * validation, the password hash and the SQL. Nothing here touches the network, the disk or the
 * environment, so it is unit-tested directly (`apps/web/test/seed-admin.test.ts`).
 *
 * The password hash is `pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>` with a 16-byte salt
 * and a 32-byte key: exactly what `apps/web/server/auth/password.ts` writes and verifies. Node's
 * `pbkdf2Sync` and the Workers' WebCrypto PBKDF2 derive the same bytes. 100 000 iterations is the
 * ceiling Cloudflare Workers accept, so it is both the default and the maximum.
 */

import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";

import { SeedError } from "./errors.mjs";
import { sqlValue } from "./sql.mjs";

export const ADMIN_ACTOR_NAME = "System (seed-admin)";
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const HASH_ITERATIONS = 100_000;
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;

const SCHEME = "pbkdf2-sha256";
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,40}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_EMAIL_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 80;
const DEFAULT_DISPLAY_NAME = "System Administrator";
const ENVIRONMENTS = ["production", "preview"];

export const ADMIN_USAGE = `Usage: pnpm web:seed-admin [--local | --remote [--env production|preview]] [options]

Creates the FIRST administrator. Credentials come from the environment, never from arguments:
  WEB_ADMIN_USERNAME   required, 3-40 letters, digits, dot, underscore, hyphen
  WEB_ADMIN_PASSWORD   required, 10-128 characters
  WEB_ADMIN_EMAIL      optional
  WEB_ADMIN_NAME       optional display name (default "${DEFAULT_DISPLAY_NAME}")

Target:
  --local              apps/web/.wrangler/state, the database of \`pnpm web:dev\` (default)
  --remote             the Cloudflare D1 database from apps/web/wrangler.toml
  --env <name>         with --remote: production (default) or preview

Options:
  --dry-run            print what would happen (no secrets, no database access) and exit
  --force              create the admin even though an active admin already exists
  --reset-password     with --force, when the user already exists: set a new password,
                       re-enable and force a change at next sign-in
  -h, --help           show this text

The account is created with must_change_password = 1 and an audit_log row ("user.create",
actor "${ADMIN_ACTOR_NAME}"). The password is never printed.`;

/**
 * @typedef {{
 *   dryRun: boolean,
 *   env: string | undefined,
 *   force: boolean,
 *   help: boolean,
 *   remote: boolean,
 *   resetPassword: boolean,
 * }} AdminOptions
 */

/**
 * @param {readonly string[]} argv
 * @returns {AdminOptions}
 */
export function parseAdminArgs(argv) {
  /** @type {AdminOptions} */
  const options = {
    dryRun: false,
    env: undefined,
    force: false,
    help: false,
    remote: false,
    resetPassword: false,
  };
  let local = false;
  const args = argv[Symbol.iterator]();
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--reset-password") {
      options.resetPassword = true;
    } else if (arg === "--remote") {
      options.remote = true;
    } else if (arg === "--local") {
      local = true;
    } else if (arg === "--env" || arg === "-e") {
      options.env = args.next().value;
    } else if (arg.startsWith("--env=")) {
      options.env = arg.slice("--env=".length);
    } else {
      throw new SeedError(`Unknown argument: ${arg}\n\n${ADMIN_USAGE}`);
    }
  }
  if (local && options.remote) {
    throw new SeedError("--local and --remote are mutually exclusive.");
  }
  if (options.env !== undefined && !options.remote) {
    throw new SeedError("--env only applies together with --remote.");
  }
  if (options.remote) {
    options.env ??= "production";
    if (!ENVIRONMENTS.includes(options.env)) {
      throw new SeedError('--env must be "production" or "preview".');
    }
  }
  return options;
}

/**
 * @typedef {{ displayName: string, email: string | null, password: string, username: string }} AdminCredentials
 */

/**
 * Reads and validates the credentials. Error messages never contain the password.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {AdminCredentials}
 */
export function readAdminCredentials(env) {
  const username = (env.WEB_ADMIN_USERNAME ?? "").trim();
  const password = env.WEB_ADMIN_PASSWORD ?? "";
  const email = (env.WEB_ADMIN_EMAIL ?? "").trim();
  const displayName = (env.WEB_ADMIN_NAME ?? "").trim() || DEFAULT_DISPLAY_NAME;
  const problems = [];
  if (username === "") {
    problems.push("WEB_ADMIN_USERNAME is not set.");
  } else if (!USERNAME_PATTERN.test(username)) {
    problems.push(
      "WEB_ADMIN_USERNAME must be 3-40 letters, digits, dots, underscores or hyphens."
    );
  }
  if (password === "") {
    problems.push("WEB_ADMIN_PASSWORD is not set.");
  } else if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    problems.push(
      `WEB_ADMIN_PASSWORD must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters (got ${password.length}).`
    );
  }
  if (
    email !== "" &&
    !(EMAIL_PATTERN.test(email) && email.length <= MAX_EMAIL_LENGTH)
  ) {
    problems.push("WEB_ADMIN_EMAIL is not a valid email address.");
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    problems.push(
      `WEB_ADMIN_NAME must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`
    );
  }
  if (problems.length > 0) {
    throw new SeedError(
      `Cannot create the administrator:\n  - ${problems.join("\n  - ")}\nSet the variables in apps/web/.dev.vars (NAME=value) or in your shell (cmd: set NAME=value) and run the command again.`
    );
  }
  return {
    displayName,
    email: email === "" ? null : email,
    password,
    username,
  };
}

/**
 * `pbkdf2-sha256$<iterations>$<salt>$<hash>`, byte-for-byte what `hashPassword` in
 * `apps/web/server/auth/password.ts` stores.
 * @param {string} password
 * @param {{ iterations?: number, salt?: Buffer }} [options]
 * @returns {string}
 */
export function hashAdminPassword(password, options = {}) {
  const iterations = options.iterations ?? HASH_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > HASH_ITERATIONS) {
    throw new SeedError(
      `PBKDF2 iterations must be a whole number between 1 and ${HASH_ITERATIONS} (the Workers ceiling).`
    );
  }
  const salt = options.salt ?? randomBytes(SALT_BYTES);
  if (salt.length !== SALT_BYTES) {
    throw new SeedError(`The salt must be ${SALT_BYTES} bytes.`);
  }
  const key = pbkdf2Sync(password, salt, iterations, KEY_BYTES, "sha256");
  return [
    SCHEME,
    String(iterations),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * What the database already holds, from the preflight query.
 * @typedef {{ activeAdmins: number, existing: { disabled: boolean, id: string, role: string } | null }} AdminState
 */

/**
 * The preflight: how many ACTIVE admins exist and whether the username is taken.
 * @param {string} username
 * @returns {string}
 */
export function buildAdminPreflightSql(username) {
  return [
    "SELECT count(*) AS admins FROM users WHERE role = 'admin' AND disabled_at IS NULL;",
    `SELECT id, role, disabled_at FROM users WHERE username_lower = ${sqlValue(username.toLowerCase())};`,
  ].join("\n");
}

/**
 * @param {{ results?: Record<string, unknown>[] }[]} parsed `wrangler d1 execute --json` output
 * @returns {AdminState}
 */
export function readAdminState(parsed) {
  const admins = parsed[0]?.results?.[0]?.admins;
  const existing = parsed[1]?.results?.[0];
  if (typeof admins !== "number") {
    throw new SeedError(
      "Could not read the users table. Has the database been migrated? Run `pnpm web:migrate` (add --remote for a deployed database)."
    );
  }
  return {
    activeAdmins: admins,
    existing: existing
      ? {
          disabled: existing.disabled_at !== null,
          id: String(existing.id),
          role: String(existing.role),
        }
      : null,
  };
}

/**
 * Decides between creating and resetting, or refuses.
 * @param {AdminState} state
 * @param {{ force: boolean, resetPassword: boolean }} flags
 * @param {string} username
 * @returns {"create" | "reset"}
 */
export function planAdminAction(state, flags, username) {
  if (state.activeAdmins > 0 && !flags.force) {
    throw new SeedError(
      `An active administrator already exists (${state.activeAdmins}). The first admin is created only once.\n` +
        "Create further accounts in the app (Users). If you really need another seeded admin, run again with --force."
    );
  }
  if (state.existing) {
    if (!flags.resetPassword) {
      throw new SeedError(
        `The username "${username}" already exists. Choose another WEB_ADMIN_USERNAME, or add --reset-password to give that account a new password, make it an enabled admin and force a password change.`
      );
    }
    return "reset";
  }
  if (flags.resetPassword) {
    throw new SeedError(
      `--reset-password given but the user "${username}" does not exist.`
    );
  }
  return "create";
}

/**
 * @typedef {{
 *   action: "create" | "reset",
 *   credentials: AdminCredentials,
 *   existingId?: string,
 *   force: boolean,
 *   hash: string,
 *   id?: string,
 *   now: string,
 * }} AdminSqlInput
 */

/** @param {unknown} value */
function auditJson(value) {
  return sqlValue(JSON.stringify(value));
}

/**
 * The SQL that creates (or resets) the admin and appends its audit row. The statements carry
 * their own guards, so a race with another seed cannot create a second admin: the INSERT selects
 * nothing when an active admin appeared (unless forced) or the username was taken, and the audit
 * row is written only when the user row is there.
 * @param {AdminSqlInput} input
 * @returns {{ id: string, sql: string }}
 */
export function buildAdminSql(input) {
  return input.action === "reset" ? buildResetSql(input) : buildCreateSql(input);
}

/** @param {AdminSqlInput} input */
function buildCreateSql(input) {
  const { credentials, force, hash, now } = input;
  const id = input.id ?? randomUUID();
  const lower = credentials.username.toLowerCase();
  const guards = [
    `NOT EXISTS (SELECT 1 FROM users WHERE username_lower = ${sqlValue(lower)})`,
  ];
  if (credentials.email !== null) {
    guards.push(
      `NOT EXISTS (SELECT 1 FROM users WHERE email_lower = ${sqlValue(credentials.email.toLowerCase())})`
    );
  }
  if (!force) {
    guards.push(
      "NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND disabled_at IS NULL)"
    );
  }
  const values = [
    id,
    credentials.username,
    lower,
    credentials.email,
    credentials.email === null ? null : credentials.email.toLowerCase(),
    credentials.displayName,
    "admin",
    hash,
    1,
    null,
    null,
    null,
    null,
    now,
    now,
  ]
    .map(sqlValue)
    .join(", ");
  const insert = `INSERT INTO users (id, username, username_lower, email, email_lower, display_name, role, password_hash, must_change_password, disabled_at, last_login_at, password_changed_at, created_by, created_at, updated_at) SELECT ${values} WHERE ${guards.join(" AND ")};`;
  const audit = auditInsert({
    action: "user.create",
    after: {
      mustChangePassword: true,
      role: "admin",
      username: credentials.username,
    },
    entityId: id,
    now,
    summary: `Created the administrator "${credentials.username}" with seed-admin`,
  });
  return { id, sql: `${insert}\n${audit}\n` };
}

/** @param {AdminSqlInput} input */
function buildResetSql(input) {
  const { credentials, existingId, hash, now } = input;
  if (!existingId) {
    throw new SeedError("A password reset needs the id of the existing user.");
  }
  const statements = [
    `UPDATE users SET password_hash = ${sqlValue(hash)}, must_change_password = 1, role = 'admin', disabled_at = NULL, password_changed_at = NULL, updated_at = ${sqlValue(now)} WHERE id = ${sqlValue(existingId)};`,
    `DELETE FROM sessions WHERE user_id = ${sqlValue(existingId)};`,
    auditInsert({
      action: "user.reset_password",
      after: { mustChangePassword: true, role: "admin", username: credentials.username },
      entityId: existingId,
      now,
      summary: `Reset the password of "${credentials.username}" with seed-admin`,
    }),
  ];
  return { id: existingId, sql: `${statements.join("\n")}\n` };
}

/**
 * @param {{ action: string, after: unknown, entityId: string, now: string, summary: string }} entry
 */
function auditInsert({ action, after, entityId, now, summary }) {
  const values = [
    sqlValue(now),
    "NULL",
    sqlValue(ADMIN_ACTOR_NAME),
    "NULL",
    sqlValue(action),
    sqlValue("user"),
    sqlValue(entityId),
    sqlValue(summary),
    "NULL",
    auditJson(after),
    "NULL",
  ].join(", ");
  return `INSERT INTO audit_log (at, actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, before, after, ip) SELECT ${values} WHERE EXISTS (SELECT 1 FROM users WHERE id = ${sqlValue(entityId)});`;
}

/**
 * The follow-up query proving the account is there and must change its password.
 * @param {string} id
 * @returns {string}
 */
export function buildAdminVerifySql(id) {
  return `SELECT role, must_change_password, disabled_at FROM users WHERE id = ${sqlValue(id)};`;
}

/**
 * @param {{ results?: Record<string, unknown>[] }[]} parsed
 * @returns {boolean}
 */
export function adminWasWritten(parsed) {
  const row = parsed[0]?.results?.[0];
  return (
    row !== undefined &&
    row.role === "admin" &&
    row.must_change_password === 1 &&
    row.disabled_at === null
  );
}
