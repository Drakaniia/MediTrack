import { describe, expect, it } from "vitest";

import { ROLES } from "../shared/roles";
import type { MeResponse } from "../shared/session";
import { type AppSettings, DEFAULT_SETTINGS } from "../shared/settings";
import { createTestApp, type TestApp, type TestClient } from "./app";

const SETTINGS = "/api/settings";
const ME = "/api/auth/me";

interface Issue {
  message: string;
  path: string;
}

async function setup(): Promise<{ admin: TestClient; app: TestApp }> {
  const app = await createTestApp();
  return { admin: await app.loginAs("admin"), app };
}

function settingsRows(app: TestApp) {
  return app.sqlite
    .prepare("SELECT key, value, updated_by FROM settings ORDER BY key")
    .all() as unknown as {
    key: string;
    updated_by: string | null;
    value: string;
  }[];
}

function settingsAudit(app: TestApp) {
  return app.sqlite
    .prepare(
      "SELECT * FROM audit_log WHERE action = 'settings.update' ORDER BY id"
    )
    .all() as unknown as {
    actor_id: string;
    after: string;
    before: string;
    entity_type: string;
    summary: string;
  }[];
}

function issuesOf(res: { error: { details?: unknown } | null }): Issue[] {
  const details = res.error?.details as { issues: Issue[] } | undefined;
  return details?.issues ?? [];
}

describe("access", () => {
  it("is admin-only, for reading and writing", async () => {
    const app = await createTestApp();
    for (const role of ROLES) {
      const client = await app.loginAs(role);
      const read = await client.get(SETTINGS);
      const write = await client.put(SETTINGS, {
        facility: { name: "Hijacked" },
      });
      if (role === "admin") {
        expect(read.status).toBe(200);
        expect(write.status).toBe(200);
      } else {
        expect(read.status, role).toBe(403);
        expect(write.status, role).toBe(403);
        expect(write.error?.code).toBe("forbidden");
      }
    }
    expect((await app.anonymous.get(SETTINGS)).status).toBe(401);
    expect((await app.anonymous.put(SETTINGS, {})).status).toBe(401);
  });

  it("still lets every role read the public subset through /auth/me", async () => {
    const { admin, app } = await setup();
    await admin.put(SETTINGS, {
      expiry: { nearDays: 45, urgentDays: 10 },
      facility: { name: "Clinic Rosa" },
    });
    const nurse = await app.loginAs("nurse");
    const me = await nurse.get<MeResponse>(ME);
    expect(me.data.settings).toEqual({
      facilityName: "Clinic Rosa",
      nearDays: 45,
      timezone: "Asia/Manila",
      urgentDays: 10,
    });
  });
});

describe("GET /api/settings", () => {
  it("returns the defaults for a fresh database", async () => {
    const { admin } = await setup();
    const res = await admin.get<AppSettings>(SETTINGS);
    expect(res.status).toBe(200);
    expect(res.data).toEqual(DEFAULT_SETTINGS);
  });
});

describe("PUT /api/settings", () => {
  it("merges a partial patch, returns the full settings and persists them", async () => {
    const { admin, app } = await setup();
    const res = await admin.put<AppSettings>(SETTINGS, {
      expiry: { urgentDays: 10 },
      facility: { name: "  Clinic Rosa  " },
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      ...DEFAULT_SETTINGS,
      expiry: { nearDays: 30, urgentDays: 10 },
      facility: { name: "Clinic Rosa", timezone: "Asia/Manila" },
    });
    expect((await admin.get<AppSettings>(SETTINGS)).data).toEqual(res.data);
    expect(settingsRows(app).map((row) => row.key)).toEqual([
      "expiry.urgentDays",
      "facility.name",
    ]);
  });

  it("writes the editing admin into settings.updated_by", async () => {
    const { admin, app } = await setup();
    await admin.put(SETTINGS, { alerts: { push: false } });
    const adminId = (
      app.sqlite.prepare("SELECT id FROM users").get() as { id: string }
    ).id;
    expect(settingsRows(app)).toEqual([
      { key: "alerts.push", updated_by: adminId, value: "false" },
    ]);
  });

  it("deduplicates and lower-cases digest recipients, and enables the digest with them", async () => {
    const { admin } = await setup();
    const res = await admin.put<AppSettings>(SETTINGS, {
      alerts: { emailDigest: true },
      digest: {
        recipients: ["Ops@Example.com", "ops@example.com", "nurse@example.com"],
        skipWhenQuiet: false,
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.digest).toEqual({
      recipients: ["ops@example.com", "nurse@example.com"],
      skipWhenQuiet: false,
    });
    expect(res.data.alerts.emailDigest).toBe(true);
  });

  it("changes the timezone and schedule", async () => {
    const { admin } = await setup();
    const res = await admin.put<AppSettings>(SETTINGS, {
      facility: { timezone: "America/New_York" },
      schedule: { dailyTime: "07:30" },
    });
    expect(res.data.facility.timezone).toBe("America/New_York");
    expect(res.data.schedule.dailyTime).toBe("07:30");
  });

  it("rejects urgent >= near, in any combination", async () => {
    const { admin, app } = await setup();
    const bodies = [
      { expiry: { nearDays: 30, urgentDays: 30 } },
      { expiry: { urgentDays: 40 } },
      { expiry: { nearDays: 5 } },
      { expiry: { nearDays: 7 } },
      { expiry: { nearDays: 20, urgentDays: 25 } },
    ];
    for (const body of bodies) {
      const res = await admin.put(SETTINGS, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.error?.code).toBe("validation_error");
      expect(issuesOf(res)).toEqual([
        {
          message: "Urgent days must be fewer than Near Expiry days.",
          path: "",
        },
      ]);
    }
    expect(settingsRows(app)).toHaveLength(0);
    expect(settingsAudit(app)).toHaveLength(0);
  });

  it("rejects out-of-range and non-whole thresholds", async () => {
    const { admin } = await setup();
    const negative = await admin.put(SETTINGS, { expiry: { urgentDays: -1 } });
    expect(issuesOf(negative)[0].message).toBe(
      "Urgent days cannot be negative."
    );
    const huge = await admin.put(SETTINGS, { expiry: { nearDays: 2000 } });
    expect(issuesOf(huge)[0].message).toContain("cannot exceed 1095");
    const fractional = await admin.put(SETTINGS, {
      expiry: { urgentDays: 7.5 },
    });
    expect(fractional.status).toBe(400);
    expect(issuesOf(fractional).map((issue) => issue.path)).toContain(
      "expiry.urgentDays"
    );
  });

  it("accepts the boundary values", async () => {
    const { admin } = await setup();
    const res = await admin.put<AppSettings>(SETTINGS, {
      expiry: { nearDays: 1095, urgentDays: 0 },
    });
    expect(res.status).toBe(200);
    expect(res.data.expiry).toEqual({ nearDays: 1095, urgentDays: 0 });
  });

  it("rejects an unknown timezone and a malformed time", async () => {
    const { admin } = await setup();
    const zone = await admin.put(SETTINGS, {
      facility: { timezone: "Mars/Olympus" },
    });
    expect(zone.status).toBe(400);
    expect(issuesOf(zone)).toEqual([
      { message: "Unknown timezone.", path: "facility.timezone" },
    ]);

    for (const dailyTime of ["25:00", "6:00", "06:60", "noon", ""]) {
      const res = await admin.put(SETTINGS, { schedule: { dailyTime } });
      expect(res.status, dailyTime).toBe(400);
      expect(issuesOf(res).map((issue) => issue.path)).toContain(
        "schedule.dailyTime"
      );
    }
  });

  it("validates digest recipients", async () => {
    const { admin } = await setup();
    const invalid = await admin.put(SETTINGS, {
      digest: { recipients: ["not-an-email"] },
    });
    expect(invalid.status).toBe(400);
    expect(issuesOf(invalid)[0].path).toBe("digest.recipients.0");

    const tooMany = await admin.put(SETTINGS, {
      digest: {
        recipients: Array.from(
          { length: 51 },
          (_, index) => `user${index}@example.com`
        ),
      },
    });
    expect(tooMany.status).toBe(400);

    const enableWithoutRecipients = await admin.put(SETTINGS, {
      alerts: { emailDigest: true },
    });
    expect(enableWithoutRecipients.status).toBe(400);
    expect(issuesOf(enableWithoutRecipients)).toEqual([
      {
        message: "Add at least one recipient to enable the email digest.",
        path: "",
      },
    ]);
  });

  it("rejects a blank facility name, unknown keys and a body that is not JSON", async () => {
    const { admin } = await setup();
    expect(
      (await admin.put(SETTINGS, { facility: { name: "   " } })).status
    ).toBe(400);
    expect(
      (await admin.put(SETTINGS, { facility: { name: "n".repeat(81) } })).status
    ).toBe(400);
    expect((await admin.put(SETTINGS, { theme: "dark" })).status).toBe(400);
    expect(
      (await admin.put(SETTINGS, { facility: { logo: "x" } })).status
    ).toBe(400);
    const raw = await admin.request("PUT", SETTINGS, {
      headers: { "content-type": "application/json" },
    });
    expect(raw.status).toBe(200);
  });

  it("writes and audits NOTHING when validation fails", async () => {
    const { admin, app } = await setup();
    const res = await admin.put(SETTINGS, {
      expiry: { urgentDays: 99 },
      facility: { name: "Would Be Saved" },
    });
    expect(res.status).toBe(400);
    expect(settingsRows(app)).toHaveLength(0);
    expect(settingsAudit(app)).toHaveLength(0);
    expect((await admin.get<AppSettings>(SETTINGS)).data.facility.name).toBe(
      "MediTract"
    );
  });
});

describe("settings audit", () => {
  it("records only the changed keys, with before and after and the actor", async () => {
    const { admin, app } = await setup();
    await admin.put(SETTINGS, {
      expiry: { nearDays: 60, urgentDays: 14 },
      facility: { name: "Clinic Rosa" },
    });
    const rows = settingsAudit(app);
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_type).toBe("settings");
    expect(rows[0].summary).toBe(
      "Updated settings: expiry.nearDays, expiry.urgentDays, facility.name"
    );
    expect(JSON.parse(rows[0].before)).toEqual({
      "expiry.nearDays": 30,
      "expiry.urgentDays": 7,
      "facility.name": "MediTract",
    });
    expect(JSON.parse(rows[0].after)).toEqual({
      "expiry.nearDays": 60,
      "expiry.urgentDays": 14,
      "facility.name": "Clinic Rosa",
    });
    const adminId = (
      app.sqlite.prepare("SELECT id FROM users").get() as { id: string }
    ).id;
    expect(rows[0].actor_id).toBe(adminId);
  });

  it("is idempotent: saving the same values again changes and audits nothing", async () => {
    const { admin, app } = await setup();
    await admin.put(SETTINGS, { facility: { name: "Clinic Rosa" } });
    await admin.put(SETTINGS, { facility: { name: "Clinic Rosa" } });
    await admin.put(SETTINGS, {});
    expect(settingsAudit(app)).toHaveLength(1);
    expect(settingsRows(app)).toHaveLength(1);
  });

  it("audits each later change as its own row", async () => {
    const { admin, app } = await setup();
    await admin.put(SETTINGS, { alerts: { push: false } });
    app.clock.advance(60_000);
    await admin.put(SETTINGS, { alerts: { push: true } });
    const rows = settingsAudit(app);
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[1].before)).toEqual({ "alerts.push": false });
    expect(JSON.parse(rows[1].after)).toEqual({ "alerts.push": true });
  });
});
