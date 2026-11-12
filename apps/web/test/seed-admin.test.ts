/**
 * `pnpm web:seed-admin`: the pure parts (`scripts/web-seed/admin.mjs`) against the real schema
 * (SQLite with foreign keys on and the append-only audit triggers), plus the hash contract with
 * `server/auth/password.ts` and the dry-run of the real script.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  ADMIN_ACTOR_NAME,
  adminWasWritten,
  buildAdminPreflightSql,
  buildAdminSql,
  buildAdminVerifySql,
  hashAdminPassword,
  parseAdminArgs,
  planAdminAction,
  readAdminCredentials,
  readAdminState,
  type AdminCredentials,
  type WranglerJsonResult,
} from "../../../scripts/web-seed/admin.mjs";
import {
  d1ExecuteArgs,
  describeTarget,
  ID_PLACEHOLDER,
  parseWranglerJson,
  readD1Blocks,
  resolveRemoteBlock,
} from "../../../scripts/web-seed/wrangler.mjs";
import { hashPassword, verifyPassword } from "../server/auth/password";
import { createMigratedD1 } from "./harness";

const PASSWORD = "Seed-Admin-Passphrase-42";
const NOW = "2026-11-12T02:00:00.000Z";
const SCRIPT = join(import.meta.dirname, "..", "..", "..", "scripts", "web-seed-admin.mjs");

const CREDENTIALS: AdminCredentials = {
  displayName: "System Administrator",
  email: "owner@example.org",
  password: PASSWORD,
  username: "Owner",
};

/** What `wrangler d1 execute --json` would return for the one-statement-per-line preflight. */
function wranglerShape(sqlite: DatabaseSync, sql: string): WranglerJsonResult[] {
  return sql
    .split("\n")
    .filter((statement) => statement !== "")
    .map((statement) => ({
      results: sqlite.prepare(statement).all() as Record<string, unknown>[],
    }));
}

function seedAdmin(
  sqlite: DatabaseSync,
  credentials: AdminCredentials,
  flags: { force?: boolean; resetPassword?: boolean } = {}
): { id: string; sql: string; hash: string } {
  const force = flags.force ?? false;
  const state = readAdminState(
    wranglerShape(sqlite, buildAdminPreflightSql(credentials.username))
  );
  const action = planAdminAction(
    state,
    { force, resetPassword: flags.resetPassword ?? false },
    credentials.username
  );
  const hash = hashAdminPassword(credentials.password);
  const built = buildAdminSql({
    action,
    credentials,
    existingId: state.existing?.id,
    force,
    hash,
    now: NOW,
  });
  sqlite.exec(built.sql);
  return { ...built, hash };
}

function userRow(sqlite: DatabaseSync, username: string): Record<string, unknown> {
  return sqlite
    .prepare("SELECT * FROM users WHERE username_lower = ?")
    .get(username.toLowerCase()) as Record<string, unknown>;
}

function auditRows(sqlite: DatabaseSync): Record<string, unknown>[] {
  return sqlite.prepare("SELECT * FROM audit_log ORDER BY id").all() as Record<
    string,
    unknown
  >[];
}

describe("seed-admin arguments", () => {
  it("defaults to the local database", () => {
    expect(parseAdminArgs([])).toEqual({
      dryRun: false,
      env: undefined,
      force: false,
      help: false,
      remote: false,
      resetPassword: false,
    });
  });

  it("targets production by default with --remote, and takes --env", () => {
    expect(parseAdminArgs(["--remote"]).env).toBe("production");
    expect(parseAdminArgs(["--remote", "--env", "preview"]).env).toBe("preview");
    expect(parseAdminArgs(["--remote", "--env=preview"]).env).toBe("preview");
  });

  it("rejects contradictory or unknown arguments", () => {
    expect(() => parseAdminArgs(["--env", "preview"])).toThrow(/--remote/);
    expect(() => parseAdminArgs(["--remote", "--env", "staging"])).toThrow(/production/);
    expect(() => parseAdminArgs(["--local", "--remote"])).toThrow(/mutually exclusive/);
    expect(() => parseAdminArgs(["--password", "x"])).toThrow(/Unknown argument/);
  });
});

describe("seed-admin credentials", () => {
  const base = { WEB_ADMIN_PASSWORD: PASSWORD, WEB_ADMIN_USERNAME: "owner" };

  it("reads them from the environment with defaults", () => {
    expect(readAdminCredentials(base)).toEqual({
      displayName: "System Administrator",
      email: null,
      password: PASSWORD,
      username: "owner",
    });
    expect(
      readAdminCredentials({
        ...base,
        WEB_ADMIN_EMAIL: " Owner@Example.org ",
        WEB_ADMIN_NAME: "Dr. Owner",
      })
    ).toMatchObject({ displayName: "Dr. Owner", email: "Owner@Example.org" });
  });

  it("requires username and password and never echoes the password", () => {
    expect(() => readAdminCredentials({})).toThrow(/WEB_ADMIN_USERNAME is not set/);
    const tooShort = "short-pw1";
    let message = "";
    try {
      readAdminCredentials({ WEB_ADMIN_PASSWORD: tooShort, WEB_ADMIN_USERNAME: "owner" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/10-128 characters/);
    expect(message).not.toContain(tooShort);
  });

  it("enforces the 10-128 character password window", () => {
    const attempt = (password: string) =>
      readAdminCredentials({ WEB_ADMIN_PASSWORD: password, WEB_ADMIN_USERNAME: "owner" });
    expect(() => attempt("a".repeat(9))).toThrow();
    expect(attempt("a".repeat(10)).password).toHaveLength(10);
    expect(attempt("a".repeat(128)).password).toHaveLength(128);
    expect(() => attempt("a".repeat(129))).toThrow();
  });

  it("validates username and email", () => {
    expect(() => readAdminCredentials({ ...base, WEB_ADMIN_USERNAME: "a b" })).toThrow(/WEB_ADMIN_USERNAME/);
    expect(() => readAdminCredentials({ ...base, WEB_ADMIN_USERNAME: "ab" })).toThrow(/WEB_ADMIN_USERNAME/);
    expect(() => readAdminCredentials({ ...base, WEB_ADMIN_EMAIL: "not-an-email" })).toThrow(/WEB_ADMIN_EMAIL/);
  });
});

describe("seed-admin password hash", () => {
  it("uses the exact stored format", () => {
    const hash = hashAdminPassword(PASSWORD);
    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  });

  it("verifies with the server's verifyPassword", async () => {
    const hash = hashAdminPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toEqual({ needsRehash: false, ok: true });
    expect((await verifyPassword("wrong-password-1", hash)).ok).toBe(false);
  });

  it("is byte-identical to the server's hashPassword for the same salt", async () => {
    const salt = randomBytes(16);
    const fromScript = hashAdminPassword(PASSWORD, { salt });
    const fromServer = await hashPassword(PASSWORD, {
      salt: new Uint8Array(salt),
    });
    expect(fromScript).toBe(fromServer);
  });

  it("refuses more iterations than Workers accept, and uses a fresh salt", () => {
    expect(() => hashAdminPassword(PASSWORD, { iterations: 100_001 })).toThrow(/100000/);
    expect(hashAdminPassword(PASSWORD, { iterations: 1000 })).not.toBe(
      hashAdminPassword(PASSWORD, { iterations: 1000 })
    );
  });
});

describe("seed-admin SQL", () => {
  it("creates an admin that must change the password, with an audit row", async () => {
    const { sqlite } = createMigratedD1();
    const { id, sql, hash } = seedAdmin(sqlite, CREDENTIALS);

    const row = userRow(sqlite, "owner");
    expect(row).toMatchObject({
      disabled_at: null,
      display_name: "System Administrator",
      email: "owner@example.org",
      email_lower: "owner@example.org",
      id,
      must_change_password: 1,
      role: "admin",
      username: "Owner",
      username_lower: "owner",
    });
    expect(row.password_hash).toBe(hash);
    expect(await verifyPassword(PASSWORD, String(row.password_hash))).toMatchObject({ ok: true });

    const audit = auditRows(sqlite);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "user.create",
      actor_id: null,
      actor_name: ADMIN_ACTOR_NAME,
      entity_id: id,
      entity_type: "user",
    });
    expect(String(audit[0].after)).not.toContain(PASSWORD);
    expect(String(audit[0].after)).not.toContain("pbkdf2");

    expect(sql).not.toContain(PASSWORD);
    expect(
      adminWasWritten(wranglerShape(sqlite, buildAdminVerifySql(id)))
    ).toBe(true);
  });

  it("refuses a second admin without --force", () => {
    const { sqlite } = createMigratedD1();
    seedAdmin(sqlite, CREDENTIALS);
    expect(() =>
      seedAdmin(sqlite, { ...CREDENTIALS, email: null, username: "second" })
    ).toThrow(/active administrator already exists/);
    expect(sqlite.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });
  });

  it("allows another admin with --force, but not an existing username without --reset-password", () => {
    const { sqlite } = createMigratedD1();
    seedAdmin(sqlite, CREDENTIALS);
    seedAdmin(sqlite, { ...CREDENTIALS, email: null, username: "second" }, { force: true });
    expect(sqlite.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin'").get()).toEqual({ n: 2 });

    expect(() => seedAdmin(sqlite, CREDENTIALS, { force: true })).toThrow(/already exists/);
    expect(() => seedAdmin(sqlite, CREDENTIALS, { resetPassword: true })).toThrow(/active administrator/);
    expect(() =>
      seedAdmin(sqlite, { ...CREDENTIALS, username: "nobody" }, { force: true, resetPassword: true })
    ).toThrow(/does not exist/);
  });

  it("resets an existing admin's password with --force --reset-password", async () => {
    const { sqlite } = createMigratedD1();
    const first = seedAdmin(sqlite, CREDENTIALS);
    sqlite
      .prepare("UPDATE users SET must_change_password = 0 WHERE id = ?")
      .run(first.id);
    sqlite
      .prepare(
        "INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES ('s1', ?, ?, ?, ?, ?)"
      )
      .run(first.id, NOW, NOW, NOW, NOW);

    const newPassword = "A-Brand-New-Passphrase-7";
    seedAdmin(sqlite, { ...CREDENTIALS, password: newPassword }, { force: true, resetPassword: true });

    const row = userRow(sqlite, "owner");
    expect(row.id).toBe(first.id);
    expect(row.must_change_password).toBe(1);
    expect(await verifyPassword(newPassword, String(row.password_hash))).toMatchObject({ ok: true });
    expect((await verifyPassword(PASSWORD, String(row.password_hash))).ok).toBe(false);
    expect(sqlite.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(auditRows(sqlite).map((entry) => entry.action)).toEqual([
      "user.create",
      "user.reset_password",
    ]);
  });

  it("a disabled admin does not count as active", () => {
    const { sqlite } = createMigratedD1();
    const first = seedAdmin(sqlite, CREDENTIALS);
    sqlite.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(NOW, first.id);
    expect(() =>
      seedAdmin(sqlite, { ...CREDENTIALS, email: null, username: "rescue" })
    ).not.toThrow();
  });

  it("the SQL guards hold even if the preflight raced", () => {
    const { sqlite } = createMigratedD1();
    seedAdmin(sqlite, CREDENTIALS);
    const hash = hashAdminPassword(PASSWORD, { iterations: 1000 });

    const sameName = buildAdminSql({
      action: "create",
      credentials: CREDENTIALS,
      force: true,
      hash,
      id: "dup-name",
      now: NOW,
    });
    sqlite.exec(sameName.sql);
    const otherName = buildAdminSql({
      action: "create",
      credentials: { ...CREDENTIALS, email: null, username: "late" },
      force: false,
      hash,
      id: "late-admin",
      now: NOW,
    });
    sqlite.exec(otherName.sql);

    expect(sqlite.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });
    expect(auditRows(sqlite)).toHaveLength(1);
  });

  it("adminWasWritten rejects a missing or non-forced row", () => {
    expect(adminWasWritten([{ results: [] }])).toBe(false);
    expect(
      adminWasWritten([
        { results: [{ disabled_at: null, must_change_password: 0, role: "admin" }] },
      ])
    ).toBe(false);
  });
});

describe("seed-admin targets", () => {
  const toml = `
[[d1_databases]]
binding = "DB"
database_name = "meditract"
database_id = "${ID_PLACEHOLDER}"

[env.preview]

[[env.preview.d1_databases]]
binding = "DB"
database_name = "meditract-preview"
database_id = "11111111-2222-3333-4444-555555555555"

[[env.production.d1_databases]]
binding = "DB"
database_name = "meditract"
database_id = "${ID_PLACEHOLDER}"
`;

  it("reads every D1 block", () => {
    expect(readD1Blocks(toml)).toEqual([
      { env: undefined, id: ID_PLACEHOLDER, name: "meditract" },
      { env: "preview", id: "11111111-2222-3333-4444-555555555555", name: "meditract-preview" },
      { env: "production", id: ID_PLACEHOLDER, name: "meditract" },
    ]);
  });

  it("refuses --remote while database_id is the placeholder", () => {
    const blocks = readD1Blocks(toml);
    expect(() => resolveRemoteBlock({ blocks, env: "production" })).toThrow(/placeholder/);
    expect(resolveRemoteBlock({ blocks, env: "preview" }).name).toBe("meditract-preview");
    expect(() => resolveRemoteBlock({ blocks, env: "staging" })).toThrow(/No \[\[env\.staging/);
  });

  it("builds wrangler arguments without any secret, local by default", () => {
    const local = d1ExecuteArgs({ remote: false });
    expect(local).toEqual(["d1", "execute", "DB", "--local", "--persist-to", ".wrangler/state"]);
    expect(d1ExecuteArgs({ env: "preview", remote: true })).toEqual([
      "d1", "execute", "DB", "--remote", "--env", "preview",
    ]);
    expect(describeTarget({ env: "production", remote: true })).toMatch(/REMOTE/);
  });

  it("parses wrangler's JSON output, tolerating a banner", () => {
    const payload = JSON.stringify([{ results: [{ admins: 0 }], success: true }]);
    expect(parseWranglerJson(payload)).toHaveLength(1);
    expect(parseWranglerJson(`⛅️ wrangler 4.0\n${payload}`)[0].results?.[0]).toEqual({ admins: 0 });
    expect(() => parseWranglerJson("nope")).toThrow(/JSON/);
  });
});

describe("seed-admin script", () => {
  function run(args: string[], env: Record<string, string>) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  }

  it("--dry-run prints the plan without the password and touches nothing", () => {
    const result = run(["--dry-run"], {
      WEB_ADMIN_NAME: "Dr. Owner",
      WEB_ADMIN_PASSWORD: PASSWORD,
      WEB_ADMIN_USERNAME: "owner",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Dry run");
    expect(result.stdout).toContain("owner");
    expect(result.stdout).not.toContain(PASSWORD);
    expect(result.stderr).not.toContain(PASSWORD);
  });

  it("fails with a clear message, still without the password", () => {
    const result = run(["--dry-run"], {
      WEB_ADMIN_PASSWORD: "tiny",
      WEB_ADMIN_USERNAME: "owner",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/10-128 characters \(got 4\)/);
    expect(result.stderr).not.toMatch(/tiny/);
  });

  it("accepts no credential on the command line", () => {
    const result = run(["--password", PASSWORD], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Unknown argument/);
    expect(result.stderr).not.toContain(PASSWORD);
  });
});
