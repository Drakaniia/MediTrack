import { describe, expect, it } from "vitest";

import { hashPassword } from "../server/auth/password";
import { ALL_ROUTES } from "../server/routes/registry";
import { permissionsFor } from "../shared/permissions";
import { ROLES } from "../shared/roles";
import type { MeResponse } from "../shared/session";
import { DEFAULT_SETTINGS, toPublicSettings } from "../shared/settings";
import { createTestApp, TEST_BASE_URL, type TestApp } from "./app";

const LOGIN = "/api/auth/login";
const LOGOUT = "/api/auth/logout";
const LOGOUT_ALL = "/api/auth/logout-all";
const ME = "/api/auth/me";
const CHANGE_PASSWORD = "/api/auth/change-password";
const HOUR_MS = 3_600_000;
const ZERO_UUID = "00000000-0000-4000-8000-000000000000";
const NEW_PASSWORD = "A-brand-new-passphrase-1";

function auditRows(app: TestApp) {
  return app.sqlite
    .prepare("SELECT * FROM audit_log ORDER BY id")
    .all() as unknown as {
    action: string;
    actor_id: string | null;
    actor_name: string;
    after: string | null;
    entity_id: string | null;
    ip: string | null;
  }[];
}

function rawGet(
  app: TestApp,
  path: string,
  cookie?: string
): Promise<Response> {
  return app.handle(
    new Request(`${TEST_BASE_URL}${path}`, {
      headers: cookie ? { cookie } : {},
    })
  );
}

function concretePath(path: string): string {
  return path.replace(":type", "item").replaceAll(/:\w+/g, ZERO_UUID);
}

describe("sign-in", () => {
  it("returns the signed-in user and sets a hardened session cookie", async () => {
    const app = await createTestApp();
    const user = await app.createUser({
      displayName: "Maria Santos",
      role: "pharmacist",
      username: "maria",
    });

    const res = await app.anonymous.post<MeResponse>(LOGIN, {
      identifier: "maria",
      password: user.password,
    });
    expect(res.status).toBe(200);
    expect(res.data.user).toEqual({
      displayName: "Maria Santos",
      email: null,
      id: user.id,
      mustChangePassword: false,
      role: "pharmacist",
      username: "maria",
    });
    expect(res.data.permissions).toEqual(permissionsFor("pharmacist"));
    expect(res.setCookie).toMatch(
      /^mt_session=[A-Za-z0-9_-]{43}; Max-Age=28800; Path=\/; HttpOnly; SameSite=Lax; Secure$/
    );
  });

  it("omits Secure on plain http and never stores the raw token", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ username: "maria" });
    const response = await app.handle(
      new Request("http://localhost:8788/api/auth/login", {
        body: JSON.stringify({ identifier: "maria", password: user.password }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:8788",
          "x-meditract-csrf": "1",
        },
        method: "POST",
      })
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");

    const token = /mt_session=([^;]+)/.exec(cookie)?.[1] ?? "";
    const rows = app.sqlite.prepare("SELECT id FROM sessions").all() as {
      id: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].id).not.toBe(token);
  });

  it("accepts the username or the email, in any case", async () => {
    const app = await createTestApp();
    const user = await app.createUser({
      email: "Maria@Example.com",
      username: "maria",
    });
    for (const identifier of [
      "maria",
      "MARIA",
      "maria@example.com",
      "  MARIA@EXAMPLE.COM ",
    ]) {
      const res = await app.anonymous.post(LOGIN, {
        identifier,
        password: user.password,
      });
      expect(res.status).toBe(200);
    }
  });

  it("records last_login_at and audits the sign-in", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ username: "maria" });
    await app.anonymous.request("POST", LOGIN, {
      body: { identifier: "maria", password: user.password },
      headers: { "cf-connecting-ip": "203.0.113.9" },
    });
    const row = app.sqlite
      .prepare("SELECT last_login_at FROM users WHERE id = ?")
      .get(user.id) as { last_login_at: string };
    expect(row.last_login_at).toBe(app.clock.now().toISOString());
    expect(auditRows(app)).toMatchObject([
      { action: "auth.login", actor_id: user.id, ip: "203.0.113.9" },
    ]);
  });

  it("gives wrong passwords, unknown users and disabled users the IDENTICAL answer", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ username: "maria" });
    const disabled = await app.createUser({ disabled: true, username: "gone" });

    const wrong = await app.anonymous.post(LOGIN, {
      identifier: "maria",
      password: "not-the-password",
    });
    const unknown = await app.anonymous.post(LOGIN, {
      identifier: "nobody",
      password: "not-the-password",
    });
    const gone = await app.anonymous.post(LOGIN, {
      identifier: "gone",
      password: disabled.password,
    });

    for (const res of [wrong, unknown, gone]) {
      expect(res.status).toBe(401);
      expect(res.error?.code).toBe("invalid_credentials");
      expect(res.setCookie).toBeNull();
    }
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).toEqual(gone.body);
    expect(user.password).not.toBe("not-the-password");
  });

  it("audits failures with the attempted identifier and the reason, never the password", async () => {
    const app = await createTestApp();
    await app.createUser({ username: "maria" });
    await app.anonymous.post(LOGIN, {
      identifier: "maria",
      password: "secret-guess-12345",
    });
    await app.anonymous.post(LOGIN, {
      identifier: "n".repeat(120),
      password: "secret-guess-12345",
    });

    const rows = auditRows(app);
    expect(rows.map((row) => row.action)).toEqual([
      "auth.login_failed",
      "auth.login_failed",
    ]);
    expect(rows[0].actor_name).toBe("maria");
    expect(rows[0].actor_id).toBeNull();
    expect(JSON.parse(rows[0].after ?? "null")).toEqual({
      reason: "wrong_password",
    });
    expect(rows[1].actor_name).toHaveLength(80);
    expect(JSON.parse(rows[1].after ?? "null")).toEqual({
      reason: "unknown_account",
    });
    expect(JSON.stringify(rows)).not.toContain("secret-guess");
  });

  it("rejects malformed bodies with a validation error", async () => {
    const app = await createTestApp();
    const missing = await app.anonymous.post(LOGIN, { identifier: "maria" });
    expect(missing.status).toBe(400);
    expect(missing.error?.code).toBe("validation_error");
    const extra = await app.anonymous.post(LOGIN, {
      extra: 1,
      identifier: "maria",
      password: "x",
    });
    expect(extra.error?.code).toBe("validation_error");
    const notJson = await app.handle(
      new Request(`${TEST_BASE_URL}${LOGIN}`, {
        body: "{nope",
        headers: { "x-meditract-csrf": "1" },
        method: "POST",
      })
    );
    expect(notJson.status).toBe(400);
  });

  it("upgrades a weaker password hash on a successful sign-in, and only then", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ username: "maria" });
    const weak = await hashPassword(user.password, { iterations: 1000 });
    const stored = () =>
      (
        app.sqlite
          .prepare("SELECT password_hash FROM users WHERE id = ?")
          .get(user.id) as { password_hash: string }
      ).password_hash;
    app.sqlite
      .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(weak, user.id);

    const wrong = await app.anonymous.post(LOGIN, {
      identifier: "maria",
      password: "not-the-password",
    });
    expect(wrong.status).toBe(401);
    expect(stored()).toBe(weak);

    const ok = await app.anonymous.post(LOGIN, {
      identifier: "maria",
      password: user.password,
    });
    expect(ok.status).toBe(200);
    expect(stored()).toMatch(/^pbkdf2-sha256\$10000\$/);
    expect(stored()).not.toBe(weak);

    const again = await app.anonymous.post(LOGIN, {
      identifier: "maria",
      password: user.password,
    });
    expect(again.status).toBe(200);
  });

  it("is not confused by a stale or garbage session cookie", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ username: "maria" });
    const res = await app.anonymous.request("POST", LOGIN, {
      body: { identifier: "maria", password: user.password },
      headers: { cookie: `mt_session=${"z".repeat(43)}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("login throttling", () => {
  it("blocks after 5 failures with Retry-After, per address, and recovers after the window", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ username: "maria" });
    const attempt = (password: string, ip = "198.51.100.7") =>
      app.anonymous.request("POST", LOGIN, {
        body: { identifier: "maria", password },
        headers: { "cf-connecting-ip": ip },
      });

    for (let count = 0; count < 5; count += 1) {
      const res = await attempt("wrong-password-1");
      expect(res.status).toBe(401);
    }

    const blocked = await attempt(user.password);
    expect(blocked.status).toBe(429);
    expect(blocked.error?.code).toBe("rate_limited");
    expect(blocked.error?.details).toEqual({ retryAfterSeconds: 900 });
    expect(blocked.headers.get("retry-after")).toBe("900");

    expect((await attempt(user.password, "198.51.100.8")).status).toBe(200);

    app.clock.advance(14 * 60 * 1000);
    const stillBlocked = await attempt(user.password);
    expect(stillBlocked.status).toBe(429);
    expect(stillBlocked.headers.get("retry-after")).toBe("60");

    app.clock.advance(61 * 1000);
    expect((await attempt(user.password)).status).toBe(200);
  });

  it("forgives earlier typos once the right password is entered", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ username: "maria" });
    const attempt = (password: string) =>
      app.anonymous.post(LOGIN, { identifier: "maria", password });

    for (let count = 0; count < 4; count += 1) {
      await attempt("wrong-password-1");
    }
    expect((await attempt(user.password)).status).toBe(200);
    for (let count = 0; count < 4; count += 1) {
      expect((await attempt("wrong-password-1")).status).toBe(401);
    }
    expect((await attempt(user.password)).status).toBe(200);
  });

  it("does not audit blocked attempts", async () => {
    const app = await createTestApp();
    await app.createUser({ username: "maria" });
    for (let count = 0; count < 8; count += 1) {
      await app.anonymous.post(LOGIN, {
        identifier: "maria",
        password: "wrong-password-1",
      });
    }
    expect(auditRows(app)).toHaveLength(5);
  });
});

describe("sessions", () => {
  it("rejects a session whose user was disabled, and clears the cookie", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");
    app.sqlite
      .prepare("UPDATE users SET disabled_at = ?")
      .run(app.clock.now().toISOString());
    const res = await client.get(ME);
    expect(res.status).toBe(401);
    expect(res.error?.code).toBe("unauthenticated");
    expect(res.setCookie).toMatch(/^mt_session=;.*Max-Age=0/);
    expect(client.cookie()).toBeNull();
  });

  it("answers 401 without a cookie, and 401 plus a cleared cookie for a dead token", async () => {
    const app = await createTestApp();
    const none = await app.anonymous.get(ME);
    expect(none.status).toBe(401);
    expect(none.error?.code).toBe("unauthenticated");
    expect(none.setCookie).toBeNull();

    const dead = await rawGet(app, ME, `mt_session=${"q".repeat(43)}`);
    expect(dead.status).toBe(401);
    expect(dead.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("slides while the user is active and re-issues the cookie at most every 5 minutes", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");

    for (let step = 0; step < 6; step += 1) {
      app.clock.advance(7 * HOUR_MS);
      const res = await client.get(ME);
      expect(res.status).toBe(200);
      expect(res.setCookie).toContain("Max-Age=28800");
    }
    const immediate = await client.get(ME);
    expect(immediate.status).toBe(200);
    expect(immediate.setCookie).toBeNull();
  });

  it("expires an idle session after 8 hours and clears the cookie", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");
    app.clock.advance(8 * HOUR_MS - 1000);
    expect((await client.get(ME)).status).toBe(200);

    app.clock.advance(8 * HOUR_MS + 1000);
    const expired = await client.get(ME);
    expect(expired.status).toBe(401);
    expect(expired.setCookie).toMatch(/Max-Age=0/);
    expect(client.cookie()).toBeNull();
  });

  it("ends an always-active session at the 7-day absolute limit", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");

    let last: Awaited<ReturnType<typeof client.get>> | null = null;
    for (let hours = 7; hours < 168; hours += 7) {
      app.clock.advance(7 * HOUR_MS);
      last = await client.get(ME);
      expect(last.status).toBe(200);
    }
    // The re-issued cookie never promises more than the absolute limit allows.
    expect(last?.setCookie).toContain("Max-Age=25200");

    app.clock.advance(7 * HOUR_MS);
    expect((await client.get(ME)).status).toBe(401);
  });
});

describe("sign-out", () => {
  it("logout deletes the session server-side, clears the cookie and audits", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");
    const token = client.cookie();

    const res = await client.post(LOGOUT);
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(res.setCookie).toMatch(/^mt_session=;.*Max-Age=0.*Secure$/);
    expect(client.cookie()).toBeNull();

    // Replaying the old cookie fails: the row is gone, not just the browser's copy.
    const replay = await rawGet(app, ME, `mt_session=${token}`);
    expect(replay.status).toBe(401);
    expect(auditRows(app).map((row) => row.action)).toEqual([
      "auth.login",
      "auth.logout",
    ]);
  });

  it("logout-all ends every session of that user and nobody else's", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ role: "nurse" });
    const phone = await app.login(user);
    const laptop = await app.login(user);
    const colleague = await app.loginAs("nurse");

    const res = await phone.post(LOGOUT_ALL);
    expect(res.status).toBe(204);
    expect((await phone.get(ME)).status).toBe(401);
    expect((await laptop.get(ME)).status).toBe(401);
    expect((await colleague.get(ME)).status).toBe(200);
    expect(auditRows(app).map((row) => row.action)).toContain(
      "auth.logout_all"
    );
  });
});

describe("forced password change", () => {
  it("gates every other authenticated route with 403 password_change_required", async () => {
    const app = await createTestApp();
    const user = await app.createUser({
      mustChangePassword: true,
      username: "new.admin.user",
    });
    const client = await app.login(user);
    const gated = ALL_ROUTES.filter(
      (route) =>
        route.access !== "public" && !route.path.startsWith("/api/auth/")
    );
    expect(gated.length).toBeGreaterThan(5);

    const answers = await Promise.all(
      gated.map((route) =>
        client.request(route.method, concretePath(route.path), {
          body: route.method === "GET" ? undefined : {},
        })
      )
    );
    for (const [index, res] of answers.entries()) {
      expect(res.status, `${gated[index].method} ${gated[index].path}`).toBe(
        403
      );
      expect(res.error?.code).toBe("password_change_required");
    }
  });

  it("still lets the person reach /auth/me, change-password and logout", async () => {
    const app = await createTestApp();
    const user = await app.createUser({
      mustChangePassword: true,
      username: "new.admin.user",
    });
    const client = await app.login(user);

    const me = await client.get<MeResponse>(ME);
    expect(me.status).toBe(200);
    expect(me.data.user.mustChangePassword).toBe(true);

    const other = await app.login(user);
    expect((await other.post(LOGOUT)).status).toBe(204);
  });

  it("opens everything up once the password is changed", async () => {
    const app = await createTestApp();
    const user = await app.createUser({
      mustChangePassword: true,
      role: "admin",
      username: "new.admin.user",
    });
    const client = await app.login(user);
    expect((await client.get("/api/users")).error?.code).toBe(
      "password_change_required"
    );

    const changed = await client.post<MeResponse>(CHANGE_PASSWORD, {
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
    });
    expect(changed.status).toBe(200);
    expect(changed.data.user.mustChangePassword).toBe(false);

    for (const path of ["/api/users", "/api/settings", "/api/audit"]) {
      expect((await client.get(path)).status, path).toBe(200);
    }
    const row = app.sqlite
      .prepare(
        "SELECT must_change_password, password_changed_at FROM users WHERE id = ?"
      )
      .get(user.id) as {
      must_change_password: number;
      password_changed_at: string;
    };
    expect(row.must_change_password).toBe(0);
    expect(row.password_changed_at).toBe(app.clock.now().toISOString());
  });
});

describe("change password", () => {
  it("rotates every other session but keeps the current one, and swaps the credentials", async () => {
    const app = await createTestApp();
    const user = await app.createUser({
      role: "pharmacist",
      username: "maria.santos",
    });
    const deviceA = await app.login(user);
    const deviceB = await app.login(user);

    const res = await deviceA.post(CHANGE_PASSWORD, {
      currentPassword: user.password,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect((await deviceA.get(ME)).status).toBe(200);
    expect((await deviceB.get(ME)).status).toBe(401);

    const oldLogin = await app.anonymous.post(LOGIN, {
      identifier: "maria.santos",
      password: user.password,
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await app.anonymous.post(LOGIN, {
      identifier: "maria.santos",
      password: NEW_PASSWORD,
    });
    expect(newLogin.status).toBe(200);
    expect(auditRows(app).map((row) => row.action)).toContain(
      "auth.password_changed"
    );
  });

  it("explains what is wrong, by field", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ username: "maria.santos" });
    const client = await app.login(user);

    const wrongCurrent = await client.post(CHANGE_PASSWORD, {
      currentPassword: "not-my-password",
      newPassword: NEW_PASSWORD,
    });
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.error?.code).toBe("validation_error");
    expect(wrongCurrent.error?.details).toEqual({
      issues: [
        {
          message: "Your current password is incorrect.",
          path: "currentPassword",
        },
      ],
    });

    const same = await client.post(CHANGE_PASSWORD, {
      currentPassword: user.password,
      newPassword: user.password,
    });
    expect(same.error?.details).toMatchObject({
      issues: [{ path: "newPassword" }],
    });

    const asUsername = await client.post(CHANGE_PASSWORD, {
      currentPassword: user.password,
      newPassword: "MARIA.SANTOS",
    });
    expect(asUsername.error?.details).toMatchObject({
      issues: [{ path: "newPassword" }],
    });

    const short = await client.post(CHANGE_PASSWORD, {
      currentPassword: user.password,
      newPassword: "short",
    });
    expect(short.status).toBe(400);
    expect(short.error?.details).toMatchObject({
      issues: [{ path: "newPassword" }],
    });

    // Nothing changed: the old password still works.
    expect(
      (
        await app.anonymous.post(LOGIN, {
          identifier: "maria.santos",
          password: user.password,
        })
      ).status
    ).toBe(200);
    expect(auditRows(app).map((row) => row.action)).not.toContain(
      "auth.password_changed"
    );
  });
});

describe("GET /api/auth/me", () => {
  it("returns each role's permissions, the public settings and the clock", async () => {
    const app = await createTestApp();
    const answers = await Promise.all(
      ROLES.map(async (role) => {
        const client = await app.loginAs(role);
        return { res: await client.get<MeResponse>(ME), role };
      })
    );
    for (const { res, role } of answers) {
      expect(res.status).toBe(200);
      expect(res.data.permissions).toEqual(permissionsFor(role));
      expect(res.data.user.role).toBe(role);
      expect(res.data.settings).toEqual(toPublicSettings(DEFAULT_SETTINGS));
      expect(res.data.serverTime).toBe("2026-11-12T02:00:00.000Z");
      expect(res.data.today).toBe("2026-11-12");
    }
  });

  it("reports 'today' in the facility timezone, not UTC", async () => {
    const app = await createTestApp();
    app.clock.set("2026-11-12T20:30:00.000Z");
    const client = await app.loginAs("admin");

    const manila = await client.get<MeResponse>(ME);
    expect(manila.data.today).toBe("2026-11-13");
    expect(manila.data.serverTime).toBe("2026-11-12T20:30:00.000Z");

    await app.setSettings({ facility: { timezone: "UTC" } });
    expect((await client.get<MeResponse>(ME)).data.today).toBe("2026-11-12");

    app.clock.set("2026-11-12T03:00:00.000Z");
    await app.setSettings({ facility: { timezone: "America/Los_Angeles" } });
    const la = await client.get<MeResponse>(ME);
    expect(la.data.today).toBe("2026-11-11");
    expect(la.data.settings.timezone).toBe("America/Los_Angeles");
  });

  it("never carries a password hash", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("admin");
    const res = await client.get(ME);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/pbkdf2|password_hash|passwordHash/i);
  });
});

describe("CSRF", () => {
  it("rejects a write without the custom header, even before authentication", async () => {
    const app = await createTestApp();
    const res = await app.handle(
      new Request(`${TEST_BASE_URL}${LOGIN}`, {
        body: JSON.stringify({ identifier: "a", password: "b" }),
        headers: { "content-type": "application/json", origin: TEST_BASE_URL },
        method: "POST",
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("csrf_failed");
  });

  it("rejects a foreign Origin and leaves the session untouched", async () => {
    const app = await createTestApp();
    const client = await app.loginAs("nurse");

    const res = await client.request("POST", LOGOUT, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(res.error?.code).toBe("csrf_failed");
    expect((await client.get(ME)).status).toBe(200);

    const crossSite = await client.request("POST", LOGOUT, {
      headers: { origin: "", "sec-fetch-site": "cross-site" },
    });
    expect(crossSite.status).toBe(403);
  });

  it("does not require the header for safe methods", async () => {
    const app = await createTestApp();
    const res = await rawGet(app, "/api/health");
    expect(res.status).toBe(200);
  });
});

describe("responses never leak secrets", () => {
  it("contains no password hash in anything the auth routes return", async () => {
    const app = await createTestApp();
    const user = await app.createUser({ username: "maria.santos" });
    const client = await app.login(user);

    const responses = [
      await app.anonymous.post(LOGIN, {
        identifier: "maria.santos",
        password: "wrong-one-123",
      }),
      await client.get(ME),
      await client.post(CHANGE_PASSWORD, {
        currentPassword: user.password,
        newPassword: NEW_PASSWORD,
      }),
      await client.post(LOGOUT_ALL),
    ];
    for (const res of responses) {
      expect(JSON.stringify(res.body ?? "")).not.toMatch(
        /pbkdf2|password_hash|passwordHash/i
      );
    }
    const audit = JSON.stringify(auditRows(app));
    expect(audit).not.toMatch(/pbkdf2/i);
    expect(audit).not.toContain(NEW_PASSWORD);
    expect(audit).not.toContain(user.password);
  });
});
