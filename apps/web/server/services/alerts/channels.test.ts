import { describe, expect, it } from "vitest";

import type { DailyJobDone } from "../../../shared/schemas/alert-run";
import {
  addStock,
  addSubscription,
  addUser,
  fakeEmail,
  fakePushFetch,
  freshDb,
  NOW,
  vapidEnv,
} from "../../../test/alert-run-helpers";
import { setSetting } from "../../../test/fixtures";
import type { FakeD1 } from "../../../test/harness";
import { type DailyJobEnv, runDailyJob } from "./daily-job";
import { buildPushPayload } from "./push-step";
import type { GenerationResult } from "./types";

const RECIPIENTS = ["a@clinic.test", "b@clinic.test", "c@clinic.test"];

async function runDone(
  env: DailyJobEnv,
  deps: Parameters<typeof runDailyJob>[1] = { now: NOW }
): Promise<DailyJobDone> {
  const report = await runDailyJob(env, deps);
  if (report.status !== "ok") {
    throw new Error(`Expected an ok run, got ${JSON.stringify(report)}`);
  }
  return report;
}

function addUrgentBatches(db: FakeD1, total: number): void {
  for (let index = 0; index < total; index += 1) {
    addStock(db, {
      batchNumber: `LOT-${index}`,
      expiry: "2026-11-15",
      name: `Drug ${index}`,
    });
  }
}

function subscriptionRows(
  db: FakeD1
): { failure_count: number; id: string; last_success_at: string | null }[] {
  return db.sqlite
    .prepare(
      "SELECT id, failure_count, last_success_at FROM push_subscriptions ORDER BY id"
    )
    .all() as unknown as {
    failure_count: number;
    id: string;
    last_success_at: string | null;
  }[];
}

describe("buildPushPayload", () => {
  const base: GenerationResult = {
    counts: { expired: 1, lowStock: 0, nearExpiry: 0, safe: 0, urgent: 2 },
    localDate: "2026-11-12",
    lowStock: [],
    notificationsCreated: 3,
    resolved: 0,
    transitions: [],
  };
  const transition = (
    name: string,
    to: "expired" | "near_expiry" | "urgent"
  ): GenerationResult["transitions"][number] => ({
    batchId: `b-${name}`,
    batchNumber: `L-${name}`,
    daysUntil: to === "expired" ? -2 : 3,
    expiry: "2026-11-15",
    from: "safe",
    itemId: `i-${name}`,
    itemName: name,
    to,
  });

  it("summarises into one message: counts in the title, at most three items in the body", () => {
    const payload = buildPushPayload({
      ...base,
      transitions: [
        transition("A", "urgent"),
        transition("B", "urgent"),
        transition("C", "expired"),
        transition("D", "near_expiry"),
      ],
    });

    expect(payload).toMatchObject({
      count: 4,
      severity: "critical",
      tag: "mt-daily",
      title: "MediTract: 2 urgent, 1 expired, 1 near expiry",
      url: "/inventory/quarantine",
    });
    const lines = payload?.body.split("\n") ?? [];
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("C · L-C: Expired");
    expect(lines[3]).toBe("+1 more");
  });

  it("points at the expiry page when nothing expired, and at low stock when only stock is low", () => {
    expect(
      buildPushPayload({ ...base, transitions: [transition("A", "urgent")] })
    ).toMatchObject({ severity: "warning", url: "/inventory/expiry" });
    expect(
      buildPushPayload({
        ...base,
        lowStock: [
          {
            available: 2,
            itemId: "i1",
            itemName: "Gauze",
            threshold: 9,
            unit: "box",
          },
        ],
      })
    ).toMatchObject({
      body: "Gauze: low stock (2 box left)",
      title: "MediTract: 1 low stock",
      url: "/inventory/low-stock",
    });
    expect(buildPushPayload(base)).toBeNull();
  });
});

describe("daily push", () => {
  it("sends one summarised push per device and applies 201 / 410 / 500 to the subscriptions", async () => {
    const db = freshDb();
    addUrgentBatches(db, 3);
    addUser(db, "u1");
    const endpoints = {
      fail: "https://push.test/fail",
      gone: "https://push.test/gone",
      ok: "https://push.test/ok",
    };
    await addSubscription(db, {
      endpoint: endpoints.ok,
      failureCount: 2,
      id: "s-ok",
      userId: "u1",
    });
    await addSubscription(db, {
      endpoint: endpoints.gone,
      id: "s-gone",
      userId: "u1",
    });
    await addSubscription(db, {
      endpoint: endpoints.fail,
      id: "s-fail",
      userId: "u1",
    });
    const push = fakePushFetch({
      [endpoints.fail]: 500,
      [endpoints.gone]: 410,
    });

    const report = await runDone(
      { DB: db, ...(await vapidEnv()) },
      { fetch: push.fetch, now: NOW }
    );

    expect(push.calls.map((call) => call.endpoint).sort()).toEqual(
      Object.values(endpoints).sort()
    );
    expect(push.calls[0]?.headers.Topic).toBe("mt-daily");
    expect(report.transitions).toBe(3);
    expect(report.push).toEqual({
      devices: 3,
      failed: 1,
      gone: 1,
      removed: 0,
      sent: 1,
      skipped: null,
    });
    expect(subscriptionRows(db)).toEqual([
      { failure_count: 1, id: "s-fail", last_success_at: null },
      { failure_count: 0, id: "s-ok", last_success_at: NOW.toISOString() },
    ]);
  });

  it("deletes a subscription after five consecutive failures", async () => {
    const db = freshDb();
    addUrgentBatches(db, 1);
    addUser(db, "u1");
    await addSubscription(db, {
      endpoint: "https://push.test/a",
      failureCount: 4,
      id: "s-a",
      userId: "u1",
    });
    await addSubscription(db, {
      endpoint: "https://push.test/b",
      failureCount: 1,
      id: "s-b",
      userId: "u1",
    });
    const push = fakePushFetch({
      "https://push.test/a": 503,
      "https://push.test/b": 503,
    });

    const report = await runDone(
      { DB: db, ...(await vapidEnv()) },
      { fetch: push.fetch, now: NOW }
    );

    expect(report.push).toMatchObject({ failed: 2, removed: 1 });
    expect(subscriptionRows(db)).toEqual([
      { failure_count: 2, id: "s-b", last_success_at: null },
    ]);
  });

  it("records the push as skipped, and the job as ok, when VAPID keys are missing", async () => {
    const db = freshDb();
    addUrgentBatches(db, 1);
    addUser(db, "u1");
    await addSubscription(db, {
      endpoint: "https://push.test/a",
      id: "s-a",
      userId: "u1",
    });
    const push = fakePushFetch();

    const report = await runDone({ DB: db }, { fetch: push.fetch, now: NOW });

    expect(report.push.skipped).toBe("no_vapid");
    expect(push.calls).toHaveLength(0);
    expect(subscriptionRows(db)).toHaveLength(1);
  });

  it("skips disabled users' devices, the disabled setting and quiet days", async () => {
    const db = freshDb();
    addUrgentBatches(db, 1);
    addUser(db, "active");
    addUser(db, "gone", { disabled: true });
    await addSubscription(db, {
      endpoint: "https://push.test/a",
      id: "s-a",
      userId: "active",
    });
    await addSubscription(db, {
      endpoint: "https://push.test/b",
      id: "s-b",
      userId: "gone",
    });
    const env = { DB: db, ...(await vapidEnv()) };
    const push = fakePushFetch();

    const first = await runDone(env, { fetch: push.fetch, now: NOW });
    const quiet = await runDone(env, {
      fetch: push.fetch,
      force: true,
      now: NOW,
    });
    setSetting(db.sqlite, "alerts.push", false);
    const off = await runDone(env, {
      fetch: push.fetch,
      force: true,
      now: NOW,
    });

    expect(push.calls.map((call) => call.endpoint)).toEqual([
      "https://push.test/a",
    ]);
    expect(first.push.devices).toBe(1);
    expect(quiet.push.skipped).toBe("nothing_new");
    expect(off.push.skipped).toBe("disabled");
  });
});

describe("daily email digest", () => {
  function emailEnv(
    db: FakeD1,
    rejected: string[] = []
  ): {
    email: ReturnType<typeof fakeEmail>;
    env: DailyJobEnv;
  } {
    const email = fakeEmail(rejected);
    return {
      email,
      env: {
        APP_URL: "https://meditract.test",
        DB: db,
        EMAIL: email.binding,
        EMAIL_FROM: "alerts@meditract.test",
      },
    };
  }

  function enableDigest(db: FakeD1, skipWhenQuiet = true): void {
    setSetting(db.sqlite, "alerts.emailDigest", true);
    setSetting(db.sqlite, "digest.recipients", RECIPIENTS);
    setSetting(db.sqlite, "digest.skipWhenQuiet", skipWhenQuiet);
  }

  it("sends one message per recipient with the new transitions in it", async () => {
    const db = freshDb();
    addStock(db, { batchNumber: "LOT-Z", expiry: "2026-11-15", name: "Zinc" });
    enableDigest(db);
    const { env, email } = emailEnv(db);

    const report = await runDone(env);

    expect(report.email).toMatchObject({
      failed: 0,
      sent: 3,
      skippedReason: null,
    });
    expect(email.sent.map((message) => message.to)).toEqual(RECIPIENTS);
    expect(email.sent[0]?.subject).toContain("1 urgent");
    expect(email.sent[0]?.text).toContain("Zinc 500 mg (batch LOT-Z)");
    expect(email.sent[0]?.html).toContain("Zinc 500 mg");
  });

  it("does not let one refused recipient block the others or fail the job", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2026-11-15" });
    enableDigest(db);
    const { env, email } = emailEnv(db, ["b@clinic.test"]);

    const report = await runDone(env);

    expect(report.email).toMatchObject({
      failed: 1,
      failures: [{ code: "E_RECIPIENT_NOT_ALLOWED", to: "b@clinic.test" }],
      sent: 2,
    });
    expect(email.sent.map((message) => message.to)).toEqual([
      "a@clinic.test",
      "c@clinic.test",
    ]);
    const row = db.sqlite.prepare("SELECT status FROM job_runs").get() as {
      status: string;
    };
    expect(row.status).toBe("ok");
  });

  it("is skipped, not failed, when the binding or sender address is missing", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2026-11-15" });
    enableDigest(db);

    const noBinding = await runDone({ DB: db });
    const noSender = await runDone(
      { DB: db, EMAIL: fakeEmail().binding },
      { force: true, now: NOW }
    );

    expect(noBinding.email.skippedReason).toBe("no_binding");
    expect(noSender.email.skippedReason).toBe("no_sender");
  });

  it("sends nothing on a quiet day when skipWhenQuiet is on, and sends when it is off", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2027-09-01" });
    enableDigest(db);
    const { env, email } = emailEnv(db);

    const quiet = await runDone(env);
    expect(quiet.email.skippedReason).toBe("quiet");
    expect(email.sent).toHaveLength(0);

    setSetting(db.sqlite, "digest.skipWhenQuiet", false);
    const loud = await runDone(env, { force: true, now: NOW });
    expect(loud.email.sent).toBe(3);
    expect(email.sent[0]?.text).toContain("No changes since the last summary.");
  });

  it("honours sendEmail=false and the disabled setting", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2026-11-15" });
    const { env, email } = emailEnv(db);

    const disabled = await runDone(env);
    enableDigest(db);
    const notRequested = await runDone(env, {
      force: true,
      now: NOW,
      sendEmail: false,
    });

    expect(disabled.email.skippedReason).toBe("disabled");
    expect(notRequested.email.skippedReason).toBe("not_requested");
    expect(email.sent).toHaveLength(0);
  });
});
