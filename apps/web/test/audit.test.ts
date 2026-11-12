import { describe, expect, it } from "vitest";
import { ROLES } from "../shared/roles";
import type { AuditEntryDto } from "../shared/schemas/audit";
import { createTestApp, type TestApp, type TestClient } from "./app";

const AUDIT = "/api/audit";
const NEW_PASSWORD = "A-brand-new-passphrase-1";

interface SeedRow {
  action?: string;
  actorId?: string | null;
  actorName?: string;
  after?: string | null;
  at: string;
  before?: string | null;
  entityId?: string | null;
  entityType?: string;
  summary?: string;
}

function seed(app: TestApp, rows: SeedRow[]): void {
  const insert = app.sqlite.prepare(
    "INSERT INTO audit_log (at, actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, before, after, ip) VALUES (?, ?, ?, 'admin', ?, ?, ?, ?, ?, ?, '203.0.113.1')"
  );
  for (const row of rows) {
    insert.run(
      row.at,
      row.actorId ?? null,
      row.actorName ?? "Seed Actor",
      row.action ?? "seed.event",
      row.entityType ?? "seed",
      row.entityId ?? null,
      row.summary ?? "Seeded",
      row.before ?? null,
      row.after ?? null
    );
  }
}

async function list(
  client: TestClient,
  query: Record<string, string | number> = {}
) {
  return await client.get<AuditEntryDto[]>(AUDIT, query);
}

function summaries(res: { data: AuditEntryDto[] }): string[] {
  return res.data.map((entry) => entry.summary);
}

describe("access", () => {
  it("lets the administrator and the healthcare administrator read the log, nobody else", async () => {
    const app = await createTestApp();
    for (const role of ROLES) {
      const client = await app.loginAs(role);
      const res = await client.get(AUDIT);
      if (role === "admin" || role === "health_admin") {
        expect(res.status, role).toBe(200);
      } else {
        expect(res.status, role).toBe(403);
        expect(res.error?.code).toBe("forbidden");
      }
    }
    expect((await app.anonymous.get(AUDIT)).status).toBe(401);
  });

  it("is read-only over the API: no route can add, change or remove an entry", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await admin.request(method, AUDIT, {
        body: method === "DELETE" ? undefined : {},
      });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
    }
    expect((await admin.delete(`${AUDIT}/1`)).status).toBe(404);
  });

  it("is append-only at the database too", async () => {
    const app = await createTestApp();
    seed(app, [{ at: "2026-11-12T01:00:00.000Z" }]);
    expect(() =>
      app.sqlite.prepare("UPDATE audit_log SET summary = 'x'").run()
    ).toThrow(/append-only/);
    expect(() => app.sqlite.prepare("DELETE FROM audit_log").run()).toThrow(
      /append-only/
    );
  });
});

describe("what gets audited", () => {
  it("writes a row for every mutation the platform exposes, in order", async () => {
    const app = await createTestApp();
    const adminUser = await app.createUser({
      role: "admin",
      username: "root.admin",
    });
    const admin = await app.login(adminUser);

    const created = await admin.post<{
      temporaryPassword: string;
      user: { id: string };
    }>("/api/users", {
      displayName: "Maria Santos",
      role: "nurse",
      username: "maria.santos",
    });
    const { id } = created.data.user;
    await admin.patch(`/api/users/${id}`, { role: "pharmacist" });
    await admin.post(`/api/users/${id}/disable`);
    await admin.post(`/api/users/${id}/enable`);
    await admin.post(`/api/users/${id}/reset-password`);
    await admin.put("/api/settings", { facility: { name: "Clinic Rosa" } });
    await admin.post("/api/auth/change-password", {
      currentPassword: adminUser.password,
      newPassword: NEW_PASSWORD,
    });
    await app.anonymous.post("/api/auth/login", {
      identifier: "ghost",
      password: "whatever-123",
    });
    await admin.post("/api/auth/logout");

    const actions = (
      app.sqlite.prepare("SELECT action FROM audit_log ORDER BY id").all() as {
        action: string;
      }[]
    ).map((row) => row.action);
    expect(actions).toEqual([
      "auth.login",
      "user.create",
      "user.update",
      "user.disable",
      "user.enable",
      "user.reset_password",
      "settings.update",
      "auth.password_changed",
      "auth.login_failed",
      "auth.logout",
    ]);

    const reader = await app.loginAs("health_admin");
    const res = await list(reader, { limit: 200 });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(created.data.temporaryPassword);
    expect(text).not.toContain(NEW_PASSWORD);
    expect(text).not.toMatch(/pbkdf2|password_hash/i);
  });
});

describe("GET /api/audit", () => {
  it("returns newest first with parsed before/after and paging metadata", async () => {
    const app = await createTestApp();
    seed(app, [
      { at: "2026-11-10T01:00:00.000Z", summary: "first" },
      {
        after: '{"role":"nurse"}',
        at: "2026-11-11T01:00:00.000Z",
        before: '{"role":"admin"}',
        summary: "second",
      },
      { after: "{not json", at: "2026-11-12T01:00:00.000Z", summary: "third" },
    ]);
    const admin = await app.loginAs("admin");
    const res = await list(admin);

    expect(summaries(res)).toEqual(
      expect.arrayContaining(["third", "second", "first"])
    );
    const ours = res.data.filter((entry) => entry.entityType === "seed");
    expect(ours.map((entry) => entry.summary)).toEqual([
      "third",
      "second",
      "first",
    ]);
    expect(ours[1]).toMatchObject({
      action: "seed.event",
      actorName: "Seed Actor",
      actorRole: "admin",
      after: { role: "nurse" },
      before: { role: "admin" },
      ip: "203.0.113.1",
    });
    expect(ours[0].after).toBeNull();
    expect(ours[2].before).toBeNull();
    expect(typeof ours[0].id).toBe("number");
    expect(res.body).toMatchObject({ meta: { limit: 50, offset: 0 } });
    expect((res.body as { meta: { total: number } }).meta.total).toBe(
      res.data.length
    );
  });

  it("pages and caps the page size", async () => {
    const app = await createTestApp();
    seed(
      app,
      Array.from({ length: 7 }, (_, index) => ({
        at: `2026-11-1${index}T01:00:00.000Z`,
        entityType: "paged",
        summary: `row ${index}`,
      }))
    );
    const admin = await app.loginAs("admin");
    const first = await list(admin, { entityType: "paged", limit: 3 });
    expect(summaries(first)).toEqual(["row 6", "row 5", "row 4"]);
    expect(first.body).toMatchObject({
      meta: { limit: 3, offset: 0, total: 7 },
    });
    const last = await list(admin, {
      entityType: "paged",
      limit: 3,
      offset: 6,
    });
    expect(summaries(last)).toEqual(["row 0"]);
    const capped = await list(admin, { limit: 1000 });
    expect(capped.body).toMatchObject({ meta: { limit: 200 } });
  });

  it("filters by action prefix, entity type, actor and text", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    seed(app, [
      {
        action: "auth.login",
        actorId: "u-1",
        actorName: "Maria Santos",
        at: "2026-11-12T01:00:00.000Z",
        entityType: "user",
        summary: "Signed in",
      },
      {
        action: "auth.login_failed",
        actorName: "ghost",
        at: "2026-11-12T01:01:00.000Z",
        entityType: "user",
        summary: 'Failed sign-in for "ghost"',
      },
      {
        action: "user.create",
        actorId: "u-2",
        actorName: "Root Admin",
        at: "2026-11-12T01:02:00.000Z",
        entityType: "user",
        summary: 'Created user "nina" (nurse)',
      },
      {
        action: "settings.update",
        actorId: "u-2",
        actorName: "Root Admin",
        at: "2026-11-12T01:03:00.000Z",
        entityType: "settings",
        summary: "Updated settings: 100% done",
      },
      {
        action: "settings.update",
        actorId: "u-2",
        actorName: "Root Admin",
        at: "2026-11-12T01:04:00.000Z",
        entityType: "settings",
        summary: "Updated settings: 100x done",
      },
    ]);

    // The admin's own sign-in is audited too, so three "auth." rows exist.
    const auth = await list(admin, { action: "auth." });
    expect(auth.data.every((entry) => entry.action.startsWith("auth."))).toBe(
      true
    );
    expect(auth.data.map((entry) => entry.action).sort()).toEqual([
      "auth.login",
      "auth.login",
      "auth.login_failed",
    ]);

    expect(summaries(await list(admin, { action: "user.cre" }))).toEqual([
      'Created user "nina" (nurse)',
    ]);
    expect(summaries(await list(admin, { entityType: "settings" }))).toEqual([
      "Updated settings: 100x done",
      "Updated settings: 100% done",
    ]);
    expect(summaries(await list(admin, { actorId: "u-2" }))).toEqual([
      "Updated settings: 100x done",
      "Updated settings: 100% done",
      'Created user "nina" (nurse)',
    ]);
    expect(summaries(await list(admin, { q: "ghost" }))).toEqual([
      'Failed sign-in for "ghost"',
    ]);
    expect(summaries(await list(admin, { q: "maria" }))).toEqual(["Signed in"]);
    expect(summaries(await list(admin, { q: "root admin" }))).toHaveLength(3);
    // LIKE wildcards in the search are literal characters.
    expect(summaries(await list(admin, { q: "100%" }))).toEqual([
      "Updated settings: 100% done",
    ]);
    expect(summaries(await list(admin, { action: "user._reate" }))).toEqual([]);
    expect(
      summaries(await list(admin, { entityType: "settings", q: "100x" }))
    ).toEqual(["Updated settings: 100x done"]);
  });

  it("applies from/to as inclusive FACILITY-LOCAL dates (Asia/Manila by default)", async () => {
    const app = await createTestApp();
    // Manila is UTC+8: its 12 November runs 2026-11-11T16:00Z .. 2026-11-12T15:59:59.999Z.
    seed(app, [
      {
        at: "2026-11-11T15:59:59.999Z",
        entityType: "tz",
        summary: "11 Nov 23:59 Manila",
      },
      {
        at: "2026-11-11T16:00:00.000Z",
        entityType: "tz",
        summary: "12 Nov 00:00 Manila",
      },
      {
        at: "2026-11-12T15:59:59.999Z",
        entityType: "tz",
        summary: "12 Nov 23:59 Manila",
      },
      {
        at: "2026-11-12T16:00:00.000Z",
        entityType: "tz",
        summary: "13 Nov 00:00 Manila",
      },
    ]);
    const admin = await app.loginAs("admin");
    const tz = (query: Record<string, string>) =>
      list(admin, { entityType: "tz", ...query });

    expect(
      summaries(await tz({ from: "2026-11-12", to: "2026-11-12" }))
    ).toEqual(["12 Nov 23:59 Manila", "12 Nov 00:00 Manila"]);
    expect(summaries(await tz({ from: "2026-11-12" }))).toEqual([
      "13 Nov 00:00 Manila",
      "12 Nov 23:59 Manila",
      "12 Nov 00:00 Manila",
    ]);
    expect(summaries(await tz({ to: "2026-11-11" }))).toEqual([
      "11 Nov 23:59 Manila",
    ]);
    expect(summaries(await tz({ to: "2026-11-13" }))).toHaveLength(4);
    expect(summaries(await tz({ from: "2026-11-14" }))).toEqual([]);

    // The same instants fall on different local dates once the facility moves to UTC:
    // 11-11T16:00Z is still the 11th there, and 11-12T16:00Z is still the 12th.
    await app.setSettings({ facility: { timezone: "UTC" } });
    expect(
      summaries(await tz({ from: "2026-11-12", to: "2026-11-12" }))
    ).toEqual(["13 Nov 00:00 Manila", "12 Nov 23:59 Manila"]);
    expect(summaries(await tz({ to: "2026-11-11" }))).toEqual([
      "12 Nov 00:00 Manila",
      "11 Nov 23:59 Manila",
    ]);
  });

  it("rejects bad dates and an inverted range", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    for (const query of [
      { from: "2026-13-45" },
      { to: "yesterday" },
      { from: "2026-11-12", to: "2026-11-11" },
    ]) {
      const res = await admin.get(AUDIT, query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.error?.code).toBe("validation_error");
    }
    expect(
      (await admin.get(AUDIT, { action: "", from: "", q: "", to: "" })).status
    ).toBe(200);
  });
});
