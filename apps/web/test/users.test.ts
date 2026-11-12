import { describe, expect, it } from "vitest";

import { ROLES } from "../shared/roles";
import type {
  TemporaryPasswordResponse,
  UserDto,
} from "../shared/schemas/users";
import type { MeResponse } from "../shared/session";
import {
  createTestApp,
  type TestApp,
  type TestClient,
  type TestUser,
} from "./app";

const USERS = "/api/users";
const LOGIN = "/api/auth/login";
const ME = "/api/auth/me";
const ZERO_UUID = "00000000-0000-4000-8000-000000000000";
const TEMP_PASSWORD = /^[A-HJ-NP-Za-km-np-z2-9]{16}$/;
const HASH_LEAK = /pbkdf2|password_hash|passwordHash/i;

const VALID_NEW_USER = {
  displayName: "Maria Santos",
  role: "pharmacist",
  username: "maria",
} as const;

interface Fixture {
  admin: TestClient;
  adminUser: TestUser;
  app: TestApp;
}

async function setup(): Promise<Fixture> {
  const app = await createTestApp();
  const adminUser = await app.createUser({
    role: "admin",
    username: "root.admin",
  });
  return { admin: await app.login(adminUser), adminUser, app };
}

function auditRows(app: TestApp) {
  return app.sqlite
    .prepare("SELECT * FROM audit_log ORDER BY id")
    .all() as unknown as {
    action: string;
    actor_id: string | null;
    after: string | null;
    before: string | null;
    entity_id: string | null;
    entity_type: string;
    summary: string;
  }[];
}

function auditActions(app: TestApp): string[] {
  return auditRows(app)
    .map((row) => row.action)
    .filter((action) => action !== "auth.login");
}

async function createViaApi(
  admin: TestClient,
  overrides: Record<string, unknown> = {}
): Promise<TemporaryPasswordResponse> {
  const res = await admin.post<TemporaryPasswordResponse>(USERS, {
    ...VALID_NEW_USER,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.data;
}

describe("access", () => {
  it("is admin-only for every users route", async () => {
    const { app } = await setup();
    const target = await app.createUser({ role: "nurse" });
    const calls: [string, string, unknown][] = [
      ["GET", USERS, undefined],
      ["POST", USERS, VALID_NEW_USER],
      ["PATCH", `${USERS}/${target.id}`, { displayName: "X" }],
      ["POST", `${USERS}/${target.id}/disable`, undefined],
      ["POST", `${USERS}/${target.id}/enable`, undefined],
      ["POST", `${USERS}/${target.id}/reset-password`, undefined],
    ];
    const before = auditRows(app).length;

    for (const role of ROLES.filter((candidate) => candidate !== "admin")) {
      const client = await app.loginAs(role);
      const answers = await Promise.all(
        calls.map(([method, path, body]) =>
          client.request(method, path, { body })
        )
      );
      for (const res of answers) {
        expect(res.status, `${role}`).toBe(403);
        expect(res.error?.code).toBe("forbidden");
      }
    }
    for (const [method, path, body] of calls) {
      const res = await app.anonymous.request(method, path, { body });
      expect(res.status).toBe(401);
    }
    // Nothing was written by any refused request (only the sign-ins are audited).
    expect(
      auditRows(app).filter((row) => !row.action.startsWith("auth.")).length
    ).toBe(0);
    expect(auditRows(app).length).toBeGreaterThan(before);
  });
});

describe("GET /api/users", () => {
  it("lists users without any secret, with paging metadata", async () => {
    const { admin, app } = await setup();
    await app.createUser({
      displayName: "Carol",
      role: "nurse",
      username: "carol",
    });
    await app.createUser({
      displayName: "alice",
      role: "pharmacist",
      username: "alice",
    });

    const res = await admin.get<UserDto[]>(USERS);
    expect(res.status).toBe(200);
    expect(res.data.map((user) => user.displayName)).toEqual(
      ["alice", "Carol", expect.stringContaining("Test admin")].sort((a, b) =>
        String(a).toLowerCase().localeCompare(String(b).toLowerCase())
      ) as string[]
    );
    expect(Object.keys(res.data[0]).sort()).toEqual([
      "createdAt",
      "disabled",
      "disabledAt",
      "displayName",
      "email",
      "id",
      "lastLoginAt",
      "mustChangePassword",
      "passwordChangedAt",
      "role",
      "updatedAt",
      "username",
    ]);
    expect(res.body).toMatchObject({
      meta: { limit: 200, offset: 0, total: 3 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(HASH_LEAK);
  });

  it("filters by role, status and search text, and pages", async () => {
    const { admin, app } = await setup();
    await app.createUser({
      displayName: "Ana Cruz",
      email: "ana@clinic.test",
      role: "nurse",
      username: "ana",
    });
    await app.createUser({
      displayName: "Ben 100% Real",
      role: "nurse",
      username: "ben",
    });
    await app.createUser({
      displayName: "Ben 100x Fake",
      role: "pharmacist",
      username: "ben2",
    });
    await app.createUser({
      disabled: true,
      displayName: "Dee Gone",
      role: "nurse",
      username: "dee",
    });

    const nurses = await admin.get<UserDto[]>(USERS, { role: "nurse" });
    expect(nurses.data.map((user) => user.username)).toEqual([
      "ana",
      "ben",
      "dee",
    ]);

    const disabled = await admin.get<UserDto[]>(USERS, { status: "disabled" });
    expect(disabled.data.map((user) => user.username)).toEqual(["dee"]);
    const active = await admin.get<UserDto[]>(USERS, { status: "active" });
    expect(active.data.every((user) => !user.disabled)).toBe(true);
    expect(active.data).toHaveLength(4);

    expect(
      (await admin.get<UserDto[]>(USERS, { q: "CLINIC.test" })).data.map(
        (u) => u.username
      )
    ).toEqual(["ana"]);
    expect(
      (await admin.get<UserDto[]>(USERS, { q: "ben" })).data.map(
        (u) => u.username
      )
    ).toEqual(["ben", "ben2"]);
    // % and _ are literal characters, not wildcards.
    expect(
      (await admin.get<UserDto[]>(USERS, { q: "100%" })).data.map(
        (u) => u.username
      )
    ).toEqual(["ben"]);
    expect(
      (await admin.get<UserDto[]>(USERS, { q: "ben_" })).data
    ).toHaveLength(0);

    const page = await admin.get<UserDto[]>(USERS, { limit: 2, offset: 1 });
    expect(page.data).toHaveLength(2);
    expect(page.body).toMatchObject({
      meta: { limit: 2, offset: 1, total: 5 },
    });

    const bad = await admin.get(USERS, { role: "wizard" });
    expect(bad.status).toBe(400);
    expect(bad.error?.code).toBe("validation_error");
    expect((await admin.get(USERS, { q: "", role: "" })).status).toBe(200);
  });
});

describe("POST /api/users", () => {
  it("creates a user, shows the temporary password once, and it works at sign-in", async () => {
    const { admin, adminUser, app } = await setup();
    const res = await admin.post<TemporaryPasswordResponse>(USERS, {
      ...VALID_NEW_USER,
      email: "Maria@Example.com",
    });
    expect(res.status).toBe(201);
    const { temporaryPassword, user } = res.data;
    expect(temporaryPassword).toMatch(TEMP_PASSWORD);
    expect(user).toMatchObject({
      disabled: false,
      displayName: "Maria Santos",
      email: "Maria@Example.com",
      lastLoginAt: null,
      mustChangePassword: true,
      passwordChangedAt: null,
      role: "pharmacist",
      username: "maria",
    });

    // Never repeated by any later response.
    const listing = await admin.get(USERS);
    expect(JSON.stringify(listing.body)).not.toContain(temporaryPassword);

    const row = app.sqlite
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(user.id) as Record<string, string | number | null>;
    expect(row.created_by).toBe(adminUser.id);
    expect(row.email_lower).toBe("maria@example.com");
    expect(row.must_change_password).toBe(1);
    expect(String(row.password_hash)).toMatch(/^pbkdf2-sha256\$10000\$/);
    expect(String(row.password_hash)).not.toContain(temporaryPassword);

    for (const identifier of ["maria", "MARIA", "maria@example.com"]) {
      const login = await app.anonymous.post<MeResponse>(LOGIN, {
        identifier,
        password: temporaryPassword,
      });
      expect(login.status).toBe(200);
      expect(login.data.user.mustChangePassword).toBe(true);
    }
  });

  it("generates a different password each time, and honours one you supply", async () => {
    const { admin, app } = await setup();
    const first = await createViaApi(admin, { username: "first.user" });
    const second = await createViaApi(admin, { username: "second.user" });
    expect(first.temporaryPassword).not.toBe(second.temporaryPassword);

    const chosen = await createViaApi(admin, {
      temporaryPassword: "Chosen-Pass-123",
      username: "third.user",
    });
    expect(chosen.temporaryPassword).toBe("Chosen-Pass-123");
    const login = await app.anonymous.post(LOGIN, {
      identifier: "third.user",
      password: "Chosen-Pass-123",
    });
    expect(login.status).toBe(200);

    const blank = await createViaApi(admin, {
      temporaryPassword: "  ",
      username: "fourth.user",
    });
    expect(blank.temporaryPassword).toMatch(TEMP_PASSWORD);
  });

  it("validates the input, field by field", async () => {
    const { admin, app } = await setup();
    const cases: [Record<string, unknown>, string][] = [
      [{ username: "ab" }, "username"],
      [{ username: "has space" }, "username"],
      [{ username: "a@b.com" }, "username"],
      [{ username: "x".repeat(41) }, "username"],
      [{ displayName: "" }, "displayName"],
      [{ displayName: "n".repeat(81) }, "displayName"],
      [{ role: "superuser" }, "role"],
      [{ email: "not-an-email" }, "email"],
      [{ temporaryPassword: "short" }, "temporaryPassword"],
    ];
    for (const [override, field] of cases) {
      const res = await admin.post(USERS, { ...VALID_NEW_USER, ...override });
      expect(res.status, field).toBe(400);
      expect(res.error?.code).toBe("validation_error");
      const details = res.error?.details as
        | { issues: { path: string }[] }
        | undefined;
      expect((details?.issues ?? []).map((issue) => issue.path)).toContain(
        field
      );
    }
    const missing = await admin.post(USERS, { username: "someone" });
    expect(missing.status).toBe(400);
    const extra = await admin.post(USERS, { ...VALID_NEW_USER, isAdmin: true });
    expect(extra.status).toBe(400);
    expect(
      (
        app.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as {
          n: number;
        }
      ).n
    ).toBe(1);
  });

  it("stores a blank email as none", async () => {
    const { admin } = await setup();
    const { user } = await createViaApi(admin, { email: "  " });
    expect(user.email).toBeNull();
  });

  it("answers 409 with a readable message for a taken username or email", async () => {
    const { admin, app } = await setup();
    await createViaApi(admin, { email: "maria@example.com" });
    const auditBefore = auditRows(app).length;

    const sameName = await admin.post(USERS, {
      ...VALID_NEW_USER,
      username: "MARIA",
    });
    expect(sameName.status).toBe(409);
    expect(sameName.error).toMatchObject({
      code: "conflict",
      details: { field: "username" },
      message: "That username is already taken.",
    });

    const sameEmail = await admin.post(USERS, {
      ...VALID_NEW_USER,
      email: "MARIA@example.com",
      username: "maria2",
    });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.error).toMatchObject({
      details: { field: "email" },
      message: "That email address is already in use.",
    });

    expect(auditRows(app)).toHaveLength(auditBefore);
    expect(
      (
        app.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as {
          n: number;
        }
      ).n
    ).toBe(2);
  });

  it("audits the creation without any secret", async () => {
    const { admin, adminUser, app } = await setup();
    const { temporaryPassword, user } = await createViaApi(admin, {
      email: "maria@example.com",
      temporaryPassword: "Chosen-Pass-123",
    });
    const rows = auditRows(app).filter((row) => row.action === "user.create");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: adminUser.id,
      entity_id: user.id,
      entity_type: "user",
      summary: 'Created user "maria" (pharmacist)',
    });
    expect(JSON.parse(rows[0].after ?? "null")).toEqual({
      disabled: false,
      displayName: "Maria Santos",
      email: "maria@example.com",
      role: "pharmacist",
      username: "maria",
    });
    const everything = JSON.stringify(auditRows(app));
    expect(everything).not.toContain(temporaryPassword);
    expect(everything).not.toMatch(/pbkdf2/i);
  });
});

describe("PATCH /api/users/:id", () => {
  it("changes name, email and role, audited with before and after", async () => {
    const { admin, adminUser, app } = await setup();
    const { user } = await createViaApi(admin, { email: "old@example.com" });
    app.clock.advance(60_000);

    const res = await admin.patch<UserDto>(`${USERS}/${user.id}`, {
      displayName: "Maria S. Santos",
      email: "new@example.com",
      role: "inventory",
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      displayName: "Maria S. Santos",
      email: "new@example.com",
      role: "inventory",
      updatedAt: app.clock.now().toISOString(),
    });

    const row = auditRows(app).find((entry) => entry.action === "user.update");
    expect(row).toMatchObject({ actor_id: adminUser.id, entity_id: user.id });
    expect(row?.summary).toBe(
      'Updated user "maria": role pharmacist → inventory, name, email'
    );
    expect(JSON.parse(row?.before ?? "null")).toMatchObject({
      email: "old@example.com",
      role: "pharmacist",
    });
    expect(JSON.parse(row?.after ?? "null")).toMatchObject({
      email: "new@example.com",
      role: "inventory",
    });
  });

  it("clears the email with null and leaves omitted fields alone", async () => {
    const { admin } = await setup();
    const { user } = await createViaApi(admin, { email: "maria@example.com" });
    const kept = await admin.patch<UserDto>(`${USERS}/${user.id}`, {
      displayName: "Renamed",
    });
    expect(kept.data).toMatchObject({
      displayName: "Renamed",
      email: "maria@example.com",
    });
    const cleared = await admin.patch<UserDto>(`${USERS}/${user.id}`, {
      email: null,
    });
    expect(cleared.data.email).toBeNull();
  });

  it("is a no-op, with no audit row, when nothing changes", async () => {
    const { admin, app } = await setup();
    const { user } = await createViaApi(admin);
    const before = auditRows(app).length;
    const res = await admin.patch<UserDto>(`${USERS}/${user.id}`, {
      displayName: user.displayName,
      role: user.role,
    });
    expect(res.status).toBe(200);
    expect(auditRows(app)).toHaveLength(before);
  });

  it("rejects empty or unknown fields and answers 404 for an unknown user", async () => {
    const { admin } = await setup();
    const { user } = await createViaApi(admin);
    expect((await admin.patch(`${USERS}/${user.id}`, {})).status).toBe(400);
    expect(
      (await admin.patch(`${USERS}/${user.id}`, { username: "renamed" })).status
    ).toBe(400);
    expect(
      (await admin.patch(`${USERS}/${user.id}`, { role: "boss" })).status
    ).toBe(400);
    const missing = await admin.patch(`${USERS}/${ZERO_UUID}`, {
      displayName: "X",
    });
    expect(missing.status).toBe(404);
    expect(missing.error?.code).toBe("not_found");
  });

  it("answers 409 when the new email belongs to someone else", async () => {
    const { admin } = await setup();
    await createViaApi(admin, {
      email: "a@example.com",
      username: "first.user",
    });
    const { user } = await createViaApi(admin, {
      email: "b@example.com",
      username: "second.user",
    });
    const res = await admin.patch(`${USERS}/${user.id}`, {
      email: "A@example.com",
    });
    expect(res.status).toBe(409);
    expect(res.error?.details).toEqual({ field: "email" });
  });

  it("takes effect on the person's live session immediately", async () => {
    const { admin, app } = await setup();
    const nurse = await app.createUser({ role: "nurse" });
    const nurseClient = await app.login(nurse);
    expect((await nurseClient.get(USERS)).status).toBe(403);

    await admin.patch(`${USERS}/${nurse.id}`, { role: "admin" });
    expect((await nurseClient.get(USERS)).status).toBe(200);
    expect((await nurseClient.get<MeResponse>(ME)).data.user.role).toBe(
      "admin"
    );

    await admin.patch(`${USERS}/${nurse.id}`, { role: "nurse" });
    expect((await nurseClient.get(USERS)).status).toBe(403);
  });

  it("never demotes the last active administrator", async () => {
    const { admin, adminUser, app } = await setup();
    const refused = await admin.patch(`${USERS}/${adminUser.id}`, {
      role: "nurse",
    });
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe("conflict");
    expect(refused.error?.message).toContain("last active administrator");

    // A disabled administrator does not count as a second one.
    const spare = await app.createUser({ disabled: true, role: "admin" });
    expect(
      (await admin.patch(`${USERS}/${adminUser.id}`, { role: "nurse" })).status
    ).toBe(409);

    // Once someone else is an ACTIVE administrator the demotion goes through.
    await app.createUser({ role: "admin" });
    const allowed = await admin.patch<UserDto>(`${USERS}/${adminUser.id}`, {
      role: "nurse",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.data.role).toBe("nurse");
    expect(spare.role).toBe("admin");
  });

  it("keeps the last-admin rule inside the write itself (a stale pre-check cannot beat it)", async () => {
    const { adminUser, app } = await setup();
    const other = await app.createUser({
      role: "admin",
      username: "second.admin",
    });
    const { updateUserAccount } = await import(
      "../server/services/platform/users"
    );
    // Both admins demote each other in the same instant: exactly one may win.
    const context = (actorId: string, username: string) => ({
      db: app.db,
      env: app.env,
      ip: null,
      now: app.clock.now(),
      params: {},
      query: new URLSearchParams(),
      request: new Request("https://meditract.test/x"),
      requestId: "r",
      sessionId: null,
      url: new URL("https://meditract.test/x"),
      user: {
        displayName: username,
        email: null,
        id: actorId,
        mustChangePassword: false,
        role: "admin" as const,
        username,
      },
    });
    const results = await Promise.allSettled([
      updateUserAccount(context(adminUser.id, "root.admin"), other.id, {
        role: "nurse",
      }),
      updateUserAccount(context(other.id, "second.admin"), adminUser.id, {
        role: "nurse",
      }),
    ]);
    const outcomes = results.map((result) => result.status);
    const remaining = app.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL"
      )
      .get() as { n: number };
    expect(remaining.n).toBe(1);
    expect(outcomes.filter((status) => status === "fulfilled")).toHaveLength(1);
  });
});

describe("disable and enable", () => {
  it("disabling blocks sign-in, ends their sessions and is audited", async () => {
    const { admin, app } = await setup();
    const nurse = await app.createUser({ role: "nurse" });
    const phone = await app.login(nurse);
    await app.login(nurse);

    const res = await admin.post<UserDto>(`${USERS}/${nurse.id}/disable`);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      disabled: true,
      disabledAt: app.clock.now().toISOString(),
    });

    expect((await phone.get(ME)).status).toBe(401);
    const sessions = app.sqlite
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")
      .get(nurse.id) as { n: number };
    expect(sessions.n).toBe(0);
    const login = await app.anonymous.post(LOGIN, {
      identifier: nurse.username,
      password: nurse.password,
    });
    expect(login.status).toBe(401);
    expect(login.error?.code).toBe("invalid_credentials");

    const row = auditRows(app).find((entry) => entry.action === "user.disable");
    expect(row?.entity_id).toBe(nurse.id);
    expect(JSON.parse(row?.before ?? "null")).toMatchObject({
      disabled: false,
    });
    expect(JSON.parse(row?.after ?? "null")).toMatchObject({ disabled: true });
  });

  it("refuses to disable yourself", async () => {
    const { admin, adminUser, app } = await setup();
    const res = await admin.post(`${USERS}/${adminUser.id}/disable`);
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("conflict");
    expect((await admin.get(ME)).status).toBe(200);
    expect(auditRows(app).some((row) => row.action === "user.disable")).toBe(
      false
    );
  });

  it("can disable another administrator but not leave zero active ones", async () => {
    const { admin, adminUser, app } = await setup();
    const second = await app.createUser({ role: "admin" });
    const secondClient = await app.login(second);

    expect((await admin.post(`${USERS}/${second.id}/disable`)).status).toBe(
      200
    );
    // The second admin is gone, so the remaining one can no longer step down.
    expect(
      (await admin.patch(`${USERS}/${adminUser.id}`, { role: "nurse" })).status
    ).toBe(409);
    expect((await secondClient.get(ME)).status).toBe(401);
  });

  it("is idempotent and answers 404 for unknown users", async () => {
    const { admin, app } = await setup();
    const nurse = await app.createUser({ role: "nurse" });
    await admin.post(`${USERS}/${nurse.id}/disable`);
    const count = auditRows(app).length;
    expect((await admin.post(`${USERS}/${nurse.id}/disable`)).status).toBe(200);
    expect(auditRows(app)).toHaveLength(count);
    expect((await admin.post(`${USERS}/${ZERO_UUID}/disable`)).status).toBe(
      404
    );
    expect((await admin.post(`${USERS}/${ZERO_UUID}/enable`)).status).toBe(404);
  });

  it("enabling restores sign-in", async () => {
    const { admin, app } = await setup();
    const nurse = await app.createUser({ role: "nurse" });
    await admin.post(`${USERS}/${nurse.id}/disable`);

    const res = await admin.post<UserDto>(`${USERS}/${nurse.id}/enable`);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ disabled: false, disabledAt: null });
    const login = await app.anonymous.post(LOGIN, {
      identifier: nurse.username,
      password: nurse.password,
    });
    expect(login.status).toBe(200);
    expect(auditRows(app).some((row) => row.action === "user.enable")).toBe(
      true
    );

    const count = auditRows(app).length;
    await admin.post(`${USERS}/${nurse.id}/enable`);
    expect(auditRows(app)).toHaveLength(count);
  });
});

describe("POST /api/users/:id/reset-password", () => {
  it("issues a new temporary password, ends sessions and forces a change", async () => {
    const { admin, app } = await setup();
    const nurse = await app.createUser({ role: "nurse" });
    const phone = await app.login(nurse);

    const res = await admin.post<TemporaryPasswordResponse>(
      `${USERS}/${nurse.id}/reset-password`
    );
    expect(res.status).toBe(200);
    const { temporaryPassword, user } = res.data;
    expect(temporaryPassword).toMatch(TEMP_PASSWORD);
    expect(user.mustChangePassword).toBe(true);

    expect((await phone.get(ME)).status).toBe(401);
    const oldLogin = await app.anonymous.post(LOGIN, {
      identifier: nurse.username,
      password: nurse.password,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await app.anonymous.post<MeResponse>(LOGIN, {
      identifier: nurse.username,
      password: temporaryPassword,
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.data.user.mustChangePassword).toBe(true);

    const everything = JSON.stringify(auditRows(app));
    expect(everything).not.toContain(temporaryPassword);
    expect(everything).not.toMatch(/pbkdf2/i);
    expect(
      auditRows(app).some((row) => row.action === "user.reset_password")
    ).toBe(true);
  });

  it("does not reset your own password, and answers 404 for an unknown user", async () => {
    const { admin, adminUser } = await setup();
    const self = await admin.post(`${USERS}/${adminUser.id}/reset-password`);
    expect(self.status).toBe(409);
    expect(self.error?.message).toContain("Change password");
    expect(
      (await admin.post(`${USERS}/${ZERO_UUID}/reset-password`)).status
    ).toBe(404);
  });

  it("can reset a disabled account (it stays disabled)", async () => {
    const { admin, app } = await setup();
    const gone = await app.createUser({ disabled: true, role: "nurse" });
    const res = await admin.post<TemporaryPasswordResponse>(
      `${USERS}/${gone.id}/reset-password`
    );
    expect(res.status).toBe(200);
    expect(res.data.user.disabled).toBe(true);
  });
});

describe("accounts are never deleted", () => {
  it("has no DELETE route", async () => {
    const { admin, app } = await setup();
    const nurse = await app.createUser({ role: "nurse" });
    const res = await admin.delete(`${USERS}/${nurse.id}`);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("PATCH");
    expect(
      (
        app.sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as {
          n: number;
        }
      ).n
    ).toBe(2);
  });
});

describe("audit trail of user management", () => {
  it("records every mutation, in order, by the acting administrator", async () => {
    const { admin, adminUser, app } = await setup();
    const { user } = await createViaApi(admin);
    await admin.patch(`${USERS}/${user.id}`, { role: "nurse" });
    await admin.post(`${USERS}/${user.id}/disable`);
    await admin.post(`${USERS}/${user.id}/enable`);
    await admin.post(`${USERS}/${user.id}/reset-password`);
    // Refused or no-op requests add nothing.
    await admin.post(`${USERS}/${adminUser.id}/disable`);
    await admin.post(`${USERS}/${user.id}/enable`);
    await admin.patch(`${USERS}/${user.id}`, { role: "nurse" });

    expect(auditActions(app)).toEqual([
      "user.create",
      "user.update",
      "user.disable",
      "user.enable",
      "user.reset_password",
    ]);
    for (const row of auditRows(app).filter((entry) =>
      entry.action.startsWith("user.")
    )) {
      expect(row.actor_id).toBe(adminUser.id);
      expect(row.entity_id).toBe(user.id);
    }
  });

  it("never returns a password hash from any users route", async () => {
    const { admin } = await setup();
    const created = await admin.post(USERS, VALID_NEW_USER);
    const { id } = (created.data as TemporaryPasswordResponse).user;
    const responses = [
      created,
      await admin.get(USERS),
      await admin.patch(`${USERS}/${id}`, { displayName: "Renamed" }),
      await admin.post(`${USERS}/${id}/disable`),
      await admin.post(`${USERS}/${id}/enable`),
      await admin.post(`${USERS}/${id}/reset-password`),
    ];
    for (const res of responses) {
      expect(JSON.stringify(res.body)).not.toMatch(HASH_LEAK);
    }
  });
});
