import { describe, expect, it } from "vitest";

import type { Env } from "../server/env";
import { readRunEnv } from "../server/routes/alert-run";
import type { Role } from "../shared/roles";
import type { DailyJobReport, JobRunDto } from "../shared/schemas/alert-run";
import {
  addStock,
  addSubscription,
  fakeEmail,
  fakePushFetch,
  vapidEnv,
} from "./alert-run-helpers";
import { createTestApp } from "./app";
import { auditActions, setSetting } from "./fixtures";

const NON_ADMIN_ROLES: Role[] = [
  "inventory",
  "pharmacist",
  "nurse",
  "health_admin",
];

describe("POST /api/alerts/run", () => {
  it("is admin-only (settings.manage)", async () => {
    const app = await createTestApp();

    expect((await app.anonymous.post("/api/alerts/run", {})).status).toBe(401);
    for (const role of NON_ADMIN_ROLES) {
      const client = await app.loginAs(role);
      const response = await client.post("/api/alerts/run", {});
      expect([role, response.status, response.error?.code]).toEqual([
        role,
        403,
        "forbidden",
      ]);
      const status = await client.get("/api/alerts/run/status");
      expect([role, status.status]).toEqual([role, 403]);
    }
    expect(
      app.sqlite.prepare("SELECT COUNT(*) AS n FROM job_runs").get()
    ).toEqual({ n: 0 });
  });

  it("runs the job in force mode, returns the report and writes one audit row", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    addStock(app.db, { batchNumber: "LOT-U", expiry: "2026-11-15" });
    addStock(app.db, {
      batchNumber: "LOT-E",
      expiry: "2026-11-01",
      name: "Insulin",
    });

    // 02:00Z is 10:00 in Manila, after 06:00; move before the schedule to prove `force`.
    app.clock.set("2026-11-11T20:00:00.000Z");
    const response = await admin.post<DailyJobReport>("/api/alerts/run", {});

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      counts: { expired: 1, urgent: 1 },
      force: true,
      localDate: "2026-11-12",
      notificationsCreated: 2,
      push: { skipped: "no_vapid" },
      status: "ok",
      transitions: 2,
    });
    expect(
      auditActions(app.sqlite).filter((action) => action === "alerts.run")
    ).toHaveLength(1);
    const audit = app.sqlite
      .prepare(
        "SELECT actor_role, entity_type, entity_id, summary FROM audit_log WHERE action = 'alerts.run'"
      )
      .get() as Record<string, string>;
    expect(audit).toMatchObject({
      actor_role: "admin",
      entity_id: "2026-11-12",
      entity_type: "alerts",
    });
    expect(audit.summary).toContain("2 new expiry alerts");

    const again = await admin.post<DailyJobReport>("/api/alerts/run", {});
    expect(again.data).toMatchObject({
      notificationsCreated: 0,
      status: "ok",
      transitions: 0,
    });
  });

  it("honours force=false (respects the schedule) and validates the body", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    app.clock.set("2026-11-11T20:00:00.000Z");

    const early = await admin.post<DailyJobReport>("/api/alerts/run", {
      force: false,
    });
    const invalid = await admin.post("/api/alerts/run", { force: "yes" });
    const extra = await admin.post("/api/alerts/run", { sendMail: true });

    expect(early.data).toMatchObject({ reason: "not_due", status: "skipped" });
    expect(invalid.error?.code).toBe("validation_error");
    expect(extra.error?.code).toBe("validation_error");
  });

  it("pushes and (only when asked) emails using the bindings it can read from the environment", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    addStock(app.db, { expiry: "2026-11-15" });
    const email = fakeEmail();
    Object.assign(app.env, await vapidEnv(), {
      EMAIL: email.binding,
      EMAIL_FROM: "alerts@meditract.test",
    });
    setSetting(app.sqlite, "alerts.emailDigest", true);
    setSetting(app.sqlite, "digest.recipients", ["a@clinic.test"]);
    const user = await app.createUser({ role: "nurse" });
    await addSubscription(app.db, {
      endpoint: "https://push.test/a",
      id: "s1",
      userId: user.id,
    });
    // The route uses the global fetch for pushes; stub it for this test only.
    const push = fakePushFetch();
    const realFetch = globalThis.fetch;
    globalThis.fetch = push.fetch;
    try {
      const withoutEmail = await admin.post<DailyJobReport>(
        "/api/alerts/run",
        {}
      );
      expect(email.sent).toHaveLength(0);
      const quiet = await admin.post<DailyJobReport>("/api/alerts/run", {
        sendEmail: true,
      });
      setSetting(app.sqlite, "digest.skipWhenQuiet", false);
      const withEmail = await admin.post<DailyJobReport>("/api/alerts/run", {
        sendEmail: true,
      });

      expect(withoutEmail.data).toMatchObject({
        email: { skippedReason: "not_requested" },
        push: { devices: 1, sent: 1 },
      });
      expect(quiet.data).toMatchObject({ email: { skippedReason: "quiet" } });
      expect(withEmail.data).toMatchObject({
        email: { sent: 1, skippedReason: null },
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(push.calls).toHaveLength(1);
    expect(email.sent.map((message) => message.to)).toEqual(["a@clinic.test"]);
  });
});

describe("GET /api/alerts/run/status", () => {
  it("lists the last 10 job runs, newest first, with parsed summaries", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const insert = app.sqlite.prepare(
      "INSERT INTO job_runs (id, job, run_date, started_at, finished_at, status, summary) VALUES (?, 'daily', ?, ?, ?, ?, ?)"
    );
    for (let day = 1; day <= 12; day += 1) {
      const date = `2026-10-${String(day).padStart(2, "0")}`;
      insert.run(
        `r${day}`,
        date,
        `${date}T00:00:00.000Z`,
        `${date}T00:00:01.000Z`,
        "ok",
        JSON.stringify({ day })
      );
    }
    insert.run(
      "r-run",
      "2026-10-13",
      "2026-10-13T00:00:00.000Z",
      null,
      "running",
      null
    );

    const response = await admin.get<JobRunDto[]>("/api/alerts/run/status");

    expect(response.status).toBe(200);
    expect(response.data).toHaveLength(10);
    expect(response.data[0]).toEqual({
      finishedAt: null,
      id: "r-run",
      job: "daily",
      runDate: "2026-10-13",
      startedAt: "2026-10-13T00:00:00.000Z",
      status: "running",
      summary: null,
    });
    expect(response.data[1]).toMatchObject({ id: "r12", summary: { day: 12 } });
  });
});

describe("readRunEnv", () => {
  it("passes through what is configured and ignores what is missing or mistyped", async () => {
    const app = await createTestApp();
    const email = fakeEmail();
    Object.assign(app.env, {
      APP_URL: "  ",
      EMAIL: email.binding,
      EMAIL_FROM: "alerts@meditract.test",
      VAPID_PRIVATE_KEY: 42,
      VAPID_PUBLIC_KEY: "pub",
    });

    const env = readRunEnv(app.env);

    expect(env.DB).toBe(app.env.DB);
    expect(env.EMAIL).toBe(email.binding);
    expect(env.EMAIL_FROM).toBe("alerts@meditract.test");
    expect(env.VAPID_PUBLIC_KEY).toBe("pub");
    expect(env.VAPID_PRIVATE_KEY).toBeUndefined();
    expect(env.APP_URL).toBeUndefined();
    const mistyped = { ...app.env, EMAIL: "nope" } as unknown as Env;
    expect(readRunEnv(mistyped).EMAIL).toBeUndefined();
  });
});
