import { describe, expect, it } from "vitest";
import { ROLES } from "../shared/roles";
import type { NotificationDto } from "../shared/schemas/alerts";
import { insertNotification, minutesAfterFixtureNow } from "./alerts-helpers";
import { createTestApp, type TestClient } from "./app";
import { insertItem } from "./fixtures";

interface ListMeta {
  limit: number;
  offset: number;
  total: number;
  unread: number;
}

async function listAlerts(
  client: TestClient,
  query: Record<string, string | number> = {}
): Promise<{ meta: ListMeta; rows: NotificationDto[]; status: number }> {
  const response = await client.get<NotificationDto[]>("/api/alerts", query);
  const body = response.body as { meta?: ListMeta };
  return {
    meta: body.meta as ListMeta,
    rows: response.data,
    status: response.status,
  };
}

describe("GET /api/alerts", () => {
  it("returns newest first with the parsed DTO and meta", async () => {
    const app = await createTestApp();
    const user = await app.loginAs("nurse");
    const itemId = insertItem(app.sqlite, { name: "Amoxicillin" });
    insertNotification(app.sqlite, {
      createdAt: minutesAfterFixtureNow(0),
      id: "old",
      title: "Older",
    });
    insertNotification(app.sqlite, {
      createdAt: minutesAfterFixtureNow(5),
      data: { daysUntil: 3, itemName: "Amoxicillin", unit: "cap" },
      id: "new",
      itemId,
      kind: "low_stock",
      severity: "critical",
      title: "Newer",
    });

    const { meta, rows } = await listAlerts(user);

    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
    expect(rows[0]).toEqual({
      batchId: null,
      body: "Something needs attention.",
      createdAt: minutesAfterFixtureNow(5),
      data: { daysUntil: 3, itemName: "Amoxicillin", unit: "cap" },
      dismissed: false,
      id: "new",
      itemId,
      kind: "low_stock",
      read: false,
      resolvedAt: null,
      severity: "critical",
      title: "Newer",
    });
    expect(meta).toEqual({ limit: 30, offset: 0, total: 2, unread: 2 });
  });

  it("survives corrupt data JSON and refuses off-site urls", async () => {
    const app = await createTestApp();
    const user = await app.loginAs("admin");
    insertNotification(app.sqlite, { data: "{not json", id: "bad" });
    insertNotification(app.sqlite, {
      createdAt: minutesAfterFixtureNow(1),
      data: { itemName: "Gauze", url: "https://evil.example/x" },
      id: "offsite",
    });

    const { rows } = await listAlerts(user);

    expect(rows.find((row) => row.id === "bad")?.data).toEqual({});
    expect(rows.find((row) => row.id === "offsite")?.data).toEqual({
      itemName: "Gauze",
    });
  });

  it("filters by kind, severity and unread, and pages", async () => {
    const app = await createTestApp();
    const user = await app.loginAs("pharmacist");
    insertNotification(app.sqlite, {
      createdAt: minutesAfterFixtureNow(1),
      id: "a",
      kind: "expired",
      severity: "critical",
    });
    insertNotification(app.sqlite, {
      createdAt: minutesAfterFixtureNow(2),
      id: "b",
      kind: "urgent",
      severity: "warning",
    });
    insertNotification(app.sqlite, {
      createdAt: minutesAfterFixtureNow(3),
      id: "c",
      kind: "near_expiry",
      severity: "info",
    });
    await user.post("/api/alerts/b/read");

    expect((await listAlerts(user, { kind: "expired" })).rows).toHaveLength(1);
    expect(
      (await listAlerts(user, { kind: "expired,urgent" })).rows
    ).toHaveLength(2);
    expect(
      (await listAlerts(user, { severity: "info" })).rows.map((row) => row.id)
    ).toEqual(["c"]);
    const unread = await listAlerts(user, { unread: 1 });
    expect(unread.rows.map((row) => row.id)).toEqual(["c", "a"]);
    expect(unread.meta.total).toBe(2);

    const second = await listAlerts(user, { limit: 1, offset: 1 });
    expect(second.rows.map((row) => row.id)).toEqual(["b"]);
    expect(second.meta).toMatchObject({ limit: 1, offset: 1, total: 3 });
  });

  it("rejects an unknown kind", async () => {
    const app = await createTestApp();
    const user = await app.loginAs("admin");
    const response = await user.get("/api/alerts", { kind: "nope" });
    expect(response.status).toBe(400);
    expect(response.error?.code).toBe("validation_error");
  });

  it("hides dismissed and resolved notifications unless asked", async () => {
    const app = await createTestApp();
    const user = await app.loginAs("admin");
    insertNotification(app.sqlite, { id: "live" });
    insertNotification(app.sqlite, { id: "gone" });
    insertNotification(app.sqlite, {
      id: "fixed",
      resolvedAt: minutesAfterFixtureNow(1),
    });
    await user.post("/api/alerts/gone/dismiss");

    const defaults = await listAlerts(user);
    expect(defaults.rows.map((row) => row.id)).toEqual(["live"]);
    expect(defaults.meta.unread).toBe(1);

    const dismissed = await listAlerts(user, { includeDismissed: 1 });
    expect(dismissed.rows.map((row) => row.id).sort()).toEqual([
      "gone",
      "live",
    ]);
    expect(dismissed.rows.find((row) => row.id === "gone")?.dismissed).toBe(
      true
    );

    const resolved = await listAlerts(user, { includeResolved: 1 });
    expect(resolved.rows.map((row) => row.id).sort()).toEqual([
      "fixed",
      "live",
    ]);
    expect(
      resolved.rows.find((row) => row.id === "fixed")?.resolvedAt
    ).not.toBeNull();
  });
});

describe("notification state", () => {
  it("keeps read and dismissed state per user", async () => {
    const app = await createTestApp();
    const alice = await app.loginAs("nurse");
    const bob = await app.loginAs("nurse");
    insertNotification(app.sqlite, { id: "n1" });
    insertNotification(app.sqlite, { id: "n2" });

    const read = await alice.post<NotificationDto>("/api/alerts/n1/read");
    expect(read.status).toBe(200);
    expect(read.data.read).toBe(true);
    await alice.post("/api/alerts/n2/dismiss");

    const aliceView = await listAlerts(alice, { includeDismissed: 1 });
    expect(aliceView.meta.unread).toBe(0);
    expect(aliceView.rows.find((row) => row.id === "n1")?.read).toBe(true);

    const bobView = await listAlerts(bob);
    expect(bobView.rows.map((row) => row.read)).toEqual([false, false]);
    expect(bobView.meta.unread).toBe(2);
  });

  it("is idempotent and keeps the first timestamp", async () => {
    const app = await createTestApp();
    const user = await app.loginAs("admin");
    insertNotification(app.sqlite, { id: "n1" });

    await user.post("/api/alerts/n1/read");
    const first = app.sqlite
      .prepare("SELECT read_at FROM notification_state")
      .get() as { read_at: string };
    app.clock.advance(60_000);
    const again = await user.post<NotificationDto>("/api/alerts/n1/read");
    await user.post("/api/alerts/n1/dismiss");
    await user.post("/api/alerts/n1/dismiss");

    expect(again.status).toBe(200);
    const rows = app.sqlite
      .prepare("SELECT read_at, dismissed_at FROM notification_state")
      .all() as { dismissed_at: string; read_at: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].read_at).toBe(first.read_at);
    expect(rows[0].dismissed_at).toBe(app.clock.now().toISOString());
  });

  it("answers 404 for an unknown notification", async () => {
    const app = await createTestApp();
    const user = await app.loginAs("admin");
    for (const action of ["read", "dismiss"]) {
      const response = await user.post(`/api/alerts/missing/${action}`);
      expect(response.status).toBe(404);
      expect(response.error?.code).toBe("not_found");
    }
  });

  it("marks everything read for the caller only (read-all is not shadowed by :id)", async () => {
    const app = await createTestApp();
    const alice = await app.loginAs("inventory");
    const bob = await app.loginAs("health_admin");
    insertNotification(app.sqlite, { id: "n1" });
    insertNotification(app.sqlite, { id: "n2" });
    insertNotification(app.sqlite, { id: "n3" });
    await alice.post("/api/alerts/n1/read");

    const response = await alice.post<{ marked: number }>(
      "/api/alerts/read-all"
    );

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ marked: 2 });
    expect((await listAlerts(alice)).meta.unread).toBe(0);
    expect((await listAlerts(bob)).meta.unread).toBe(3);

    const second = await alice.post<{ marked: number }>("/api/alerts/read-all");
    expect(second.data.marked).toBe(0);
  });

  it("does not count resolved notifications as unread", async () => {
    const app = await createTestApp();
    const user = await app.loginAs("admin");
    insertNotification(app.sqlite, { id: "a" });
    insertNotification(app.sqlite, {
      id: "b",
      resolvedAt: minutesAfterFixtureNow(1),
    });
    expect((await listAlerts(user)).meta.unread).toBe(1);
  });
});

describe("access", () => {
  it("lets every role read and manage its own state", async () => {
    const app = await createTestApp();
    insertNotification(app.sqlite, { id: "n1" });
    for (const role of ROLES) {
      const client = await app.loginAs(role);
      expect((await client.get("/api/alerts")).status, role).toBe(200);
      expect((await client.get("/api/alerts/banner")).status, role).toBe(200);
      expect((await client.post("/api/alerts/n1/read")).status, role).toBe(200);
      expect((await client.post("/api/alerts/read-all")).status, role).toBe(
        200
      );
    }
  });

  it("answers 401 to anonymous callers", async () => {
    const app = await createTestApp();
    insertNotification(app.sqlite, { id: "n1" });
    for (const [method, path] of [
      ["GET", "/api/alerts"],
      ["GET", "/api/alerts/banner"],
      ["POST", "/api/alerts/read-all"],
      ["POST", "/api/alerts/n1/read"],
      ["POST", "/api/alerts/n1/dismiss"],
    ] as const) {
      const response = await app.anonymous.request(method, path);
      expect(response.status, path).toBe(401);
      expect(response.error?.code).toBe("unauthenticated");
    }
  });
});
