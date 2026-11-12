import { describe, expect, it, vi } from "vitest";

import {
  addStock,
  addSubscription,
  addUser,
  fakeEmail,
  fakePushFetch,
  freshDb,
  vapidEnv,
} from "../../../apps/web/test/alert-run-helpers";
import { setSetting } from "../../../apps/web/test/fixtures";
import type { FakeD1 } from "../../../apps/web/test/harness";
import type { CronEnv } from "../src/env";
import worker from "../src/index";

const CRON = "*/15 * * * *";
const TICK_MS = 15 * 60_000;

/** 06:00 in Asia/Manila on 2026-11-12. */
const DAILY_TICK = Date.parse("2026-11-11T22:00:00.000Z");

interface FakeContext {
  pending: Promise<unknown>[];
  waitUntil: (promise: Promise<unknown>) => void;
}

function fakeContext(): FakeContext {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil: (promise) => {
      pending.push(promise);
    },
  };
}

/** Delivers one tick exactly as the Workers runtime would, and waits for `waitUntil`. */
async function tick(env: CronEnv, scheduledTime: number): Promise<void> {
  const ctx = fakeContext();
  worker.scheduled({ cron: CRON, scheduledTime }, env, ctx);
  await Promise.all(ctx.pending);
}

function rows<T>(db: FakeD1, sql: string): T[] {
  return db.sqlite.prepare(sql).all() as unknown as T[];
}

describe("cron Worker", () => {
  it("answers 404 to HTTP requests", () => {
    expect(worker.fetch().status).toBe(404);
  });

  it("scheduled() runs the daily job inside waitUntil, judged by the scheduled time", async () => {
    const db = freshDb();
    addStock(db, { batchNumber: "LOT-U", expiry: "2026-11-15" });
    addStock(db, {
      batchNumber: "LOT-E",
      expiry: "2026-11-01",
      name: "Insulin",
    });
    const ctx = fakeContext();

    worker.scheduled(
      { cron: CRON, scheduledTime: DAILY_TICK },
      { DB: db },
      ctx
    );

    expect(ctx.pending).toHaveLength(1);
    await Promise.all(ctx.pending);
    const runs = rows<{ run_date: string; status: string; summary: string }>(
      db,
      "SELECT run_date, status, summary FROM job_runs"
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ run_date: "2026-11-12", status: "ok" });
    expect(JSON.parse(runs[0]?.summary ?? "{}")).toMatchObject({
      counts: { expired: 1, urgent: 1 },
      notificationsCreated: 2,
      status: "ok",
    });
    expect(rows(db, "SELECT kind FROM notifications ORDER BY kind")).toEqual([
      { kind: "expired" },
      { kind: "urgent" },
    ]);
  });

  it("does nothing before the daily time and runs once over a whole day of ticks", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2026-11-15" });
    const env: CronEnv = { DB: db };

    await tick(env, DAILY_TICK - TICK_MS);
    expect(rows(db, "SELECT * FROM job_runs")).toHaveLength(0);

    // Manila 00:00 on the 12th through 00:00 on the 13th.
    const dayStart = Date.parse("2026-11-11T16:00:00.000Z");
    for (let index = 0; index < 96; index += 1) {
      // Sequential on purpose: ticks are ordered in time.
      await tick(env, dayStart + index * TICK_MS);
    }

    expect(rows(db, "SELECT run_date, status FROM job_runs")).toEqual([
      { run_date: "2026-11-12", status: "ok" },
    ]);
    expect(rows(db, "SELECT id FROM notifications")).toHaveLength(1);
  });

  it("delivers push and the email digest end to end", async () => {
    const db = freshDb();
    addStock(db, { batchNumber: "LOT-Z", expiry: "2026-11-15", name: "Zinc" });
    addUser(db, "u1");
    await addSubscription(db, {
      endpoint: "https://push.test/a",
      id: "s-a",
      userId: "u1",
    });
    await addSubscription(db, {
      endpoint: "https://push.test/b",
      id: "s-b",
      userId: "u1",
    });
    setSetting(db.sqlite, "alerts.emailDigest", true);
    setSetting(db.sqlite, "digest.recipients", [
      "a@clinic.test",
      "b@clinic.test",
    ]);
    const email = fakeEmail(["b@clinic.test"]);
    const push = fakePushFetch({ "https://push.test/b": 410 });
    const env: CronEnv = {
      DB: db,
      EMAIL: email.binding,
      EMAIL_FROM: "alerts@meditract.test",
      ...(await vapidEnv()),
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(push.fetch);

    try {
      await tick(env, DAILY_TICK);
    } finally {
      fetchSpy.mockRestore();
    }

    expect(push.calls.map((call) => call.endpoint).sort()).toEqual([
      "https://push.test/a",
      "https://push.test/b",
    ]);
    expect(rows(db, "SELECT id FROM push_subscriptions")).toEqual([
      { id: "s-a" },
    ]);
    expect(email.sent.map((message) => message.to)).toEqual(["a@clinic.test"]);
    const run = db.sqlite
      .prepare("SELECT status, summary FROM job_runs")
      .get() as {
      status: string;
      summary: string;
    };
    expect(run.status).toBe("ok");
    expect(JSON.parse(run.summary)).toMatchObject({
      email: { failed: 1, sent: 1 },
      push: { gone: 1, sent: 1 },
    });
  });

  it("never rejects waitUntil, even when the database is down", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const env: CronEnv = {
      DB: {
        batch: () => Promise.reject(new Error("down")),
        exec: () => Promise.reject(new Error("down")),
        prepare: () => {
          throw new Error("down");
        },
      },
    };

    try {
      await expect(tick(env, DAILY_TICK)).resolves.toBeUndefined();
    } finally {
      error.mockRestore();
    }
  });
});
