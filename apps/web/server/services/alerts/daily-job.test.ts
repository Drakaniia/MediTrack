import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyJobReport } from "../../../shared/schemas/alert-run";
import { addStock, count, freshDb, NOW } from "../../../test/alert-run-helpers";
import { setSetting } from "../../../test/fixtures";
import type { FakeD1 } from "../../../test/harness";
import { type DailyJobEnv, runDailyJob } from "./daily-job";

interface JobRunRow {
  finished_at: string | null;
  run_date: string;
  started_at: string;
  status: string;
  summary: string | null;
}

function envOf(db: FakeD1): DailyJobEnv {
  return { DB: db };
}

function jobRuns(db: FakeD1): JobRunRow[] {
  return db.sqlite
    .prepare("SELECT * FROM job_runs ORDER BY run_date, started_at")
    .all() as unknown as JobRunRow[];
}

function at(iso: string): Date {
  return new Date(iso);
}

const MINUTE_MS = 60_000;
const TICK_MS = 15 * MINUTE_MS;

/** Every 15-minute cron tick in [from, to), as the Worker would see them. */
async function runTicks(
  db: FakeD1,
  from: string,
  to: string
): Promise<DailyJobReport[]> {
  const reports: DailyJobReport[] = [];
  for (let time = Date.parse(from); time < Date.parse(to); time += TICK_MS) {
    // Sequential on purpose: ticks are ordered in time.
    reports.push(await runDailyJob(envOf(db), { now: new Date(time) }));
  }
  return reports;
}

function okByDate(reports: DailyJobReport[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const report of reports) {
    if (report.status === "ok") {
      totals[report.localDate] = (totals[report.localDate] ?? 0) + 1;
    }
  }
  return totals;
}

describe("runDailyJob schedule", () => {
  it("is not due before the facility's daily time and runs once at it (Asia/Manila)", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2026-11-15" });

    // 06:00 in Manila is 22:00Z the day before.
    const early = await runDailyJob(envOf(db), {
      now: at("2026-11-11T21:45:00.000Z"),
    });
    const due = await runDailyJob(envOf(db), {
      now: at("2026-11-11T22:00:00.000Z"),
    });
    const again = await runDailyJob(envOf(db), {
      now: at("2026-11-11T22:15:00.000Z"),
    });

    expect(early).toMatchObject({
      dueTime: "06:00",
      localDate: "2026-11-12",
      localTime: "05:45",
      reason: "not_due",
      status: "skipped",
    });
    expect(due).toMatchObject({
      localDate: "2026-11-12",
      status: "ok",
      transitions: 1,
    });
    expect(again).toMatchObject({ reason: "already_ran", status: "skipped" });
    expect(jobRuns(db)).toHaveLength(1);

    const nextDay = await runDailyJob(envOf(db), {
      now: at("2026-11-12T22:00:00.000Z"),
    });
    expect(nextDay).toMatchObject({ localDate: "2026-11-13", status: "ok" });
    expect(jobRuns(db).map((row) => row.run_date)).toEqual([
      "2026-11-12",
      "2026-11-13",
    ]);
  });

  it("catches up on a later tick of the same local day", async () => {
    const db = freshDb();

    const late = await runDailyJob(envOf(db), {
      now: at("2026-11-12T09:15:00.000Z"),
    });

    expect(late).toMatchObject({ localDate: "2026-11-12", status: "ok" });
  });

  it("runs exactly once per local day across the fall-back DST change (America/New_York)", async () => {
    const db = freshDb();
    setSetting(db.sqlite, "facility.timezone", "America/New_York");
    // 01:30 happens twice on 2026-11-01 (05:30Z in EDT and 06:30Z in EST).
    setSetting(db.sqlite, "schedule.dailyTime", "01:30");

    const reports = await runTicks(
      db,
      "2026-10-31T04:00:00.000Z",
      "2026-11-03T05:00:00.000Z"
    );

    expect(okByDate(reports)).toEqual({
      "2026-10-31": 1,
      "2026-11-01": 1,
      "2026-11-02": 1,
    });
  });

  it("runs exactly once on the spring-forward day, even if the daily time does not exist", async () => {
    const db = freshDb();
    setSetting(db.sqlite, "facility.timezone", "America/New_York");
    // 02:30 does not exist on 2026-03-08.
    setSetting(db.sqlite, "schedule.dailyTime", "02:30");

    const reports = await runTicks(
      db,
      "2026-03-07T05:00:00.000Z",
      "2026-03-10T04:00:00.000Z"
    );

    expect(okByDate(reports)).toEqual({
      "2026-03-07": 1,
      "2026-03-08": 1,
      "2026-03-09": 1,
    });
  });

  it("clamps a daily time after the last 15-minute tick instead of never running", async () => {
    const db = freshDb();
    setSetting(db.sqlite, "schedule.dailyTime", "23:55");

    const reports = await runTicks(
      db,
      "2026-11-11T16:00:00.000Z",
      "2026-11-12T16:00:00.000Z"
    );

    expect(okByDate(reports)).toEqual({ "2026-11-12": 1 });
  });
});

describe("runDailyJob claiming", () => {
  // The job logs failures as JSON on console.error; keep the test output clean.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records ok with a JSON summary", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2026-11-15" });

    await runDailyJob(envOf(db), { now: NOW });

    const [row] = jobRuns(db);
    expect(row).toMatchObject({ run_date: "2026-11-12", status: "ok" });
    expect(row?.finished_at).toBe(NOW.toISOString());
    expect(JSON.parse(row?.summary ?? "{}")).toMatchObject({
      status: "ok",
      transitions: 1,
    });
  });

  it("does not start while a fresh run is in progress but re-claims one older than 30 minutes", async () => {
    const db = freshDb();
    const insertRunning = (startedAt: string): void => {
      db.sqlite.exec("DELETE FROM job_runs");
      db.sqlite
        .prepare(
          "INSERT INTO job_runs (id, job, run_date, started_at, status) VALUES ('r1', 'daily', '2026-11-12', ?, 'running')"
        )
        .run(startedAt);
    };

    insertRunning("2026-11-12T01:50:00.000Z");
    const fresh = await runDailyJob(envOf(db), { now: NOW });
    expect(fresh).toMatchObject({ reason: "running", status: "skipped" });

    insertRunning("2026-11-12T01:29:00.000Z");
    const stale = await runDailyJob(envOf(db), { now: NOW });
    expect(stale).toMatchObject({ status: "ok" });
    expect(jobRuns(db)).toHaveLength(1);
    expect(jobRuns(db)[0]?.status).toBe("ok");
  });

  it("retries a day whose previous run ended in error", async () => {
    const db = freshDb();
    db.sqlite
      .prepare(
        "INSERT INTO job_runs (id, job, run_date, started_at, finished_at, status, summary) VALUES ('r1', 'daily', '2026-11-12', '2026-11-12T01:00:00.000Z', '2026-11-12T01:00:01.000Z', 'error', '{}')"
      )
      .run();

    const report = await runDailyJob(envOf(db), { now: NOW });

    expect(report.status).toBe("ok");
  });

  it("force skips the time check and re-runs a finished day, still recording it", async () => {
    const db = freshDb();
    const beforeDue = at("2026-11-11T20:00:00.000Z");

    const forced = await runDailyJob(envOf(db), {
      force: true,
      now: beforeDue,
    });
    const plain = await runDailyJob(envOf(db), {
      now: at("2026-11-11T22:00:00.000Z"),
    });
    const forcedAgain = await runDailyJob(envOf(db), {
      force: true,
      now: at("2026-11-11T23:00:00.000Z"),
    });

    expect(forced).toMatchObject({ force: true, status: "ok" });
    expect(plain).toMatchObject({ reason: "already_ran", status: "skipped" });
    expect(forcedAgain).toMatchObject({ status: "ok" });
    expect(jobRuns(db)).toHaveLength(1);
  });

  it("never throws: a failing run becomes an error report and an error row", async () => {
    const db = freshDb();
    const broken: DailyJobEnv = {
      DB: {
        batch: (statements) => db.batch(statements),
        exec: db.exec,
        prepare: (sql) => {
          if (sql.includes("FROM alert_state")) {
            throw new Error("boom");
          }
          return db.prepare(sql);
        },
      },
    };

    const report = await runDailyJob(broken, { now: NOW });

    expect(report).toEqual({
      localDate: "2026-11-12",
      message: "boom",
      status: "error",
    });
    expect(jobRuns(db)[0]).toMatchObject({ status: "error" });
    expect(JSON.parse(jobRuns(db)[0]?.summary ?? "{}")).toEqual({
      message: "boom",
    });
  });

  it("never throws even when the database is unusable", async () => {
    const dead: DailyJobEnv = {
      DB: {
        batch: () => Promise.reject(new Error("down")),
        exec: () => Promise.reject(new Error("down")),
        prepare: () => {
          throw new Error("down");
        },
      },
    };

    const report = await runDailyJob(dead, { now: NOW });

    expect(report).toEqual({
      localDate: null,
      message: "down",
      status: "error",
    });
  });
});

describe("runDailyJob housekeeping", () => {
  it("purges expired sessions, old login attempts and notifications older than 90 days", async () => {
    const db = freshDb();
    db.sqlite
      .prepare(
        "INSERT INTO users (id, username, username_lower, display_name, role, password_hash) VALUES ('u1', 'u', 'u', 'U', 'admin', 'x')"
      )
      .run();
    const session = db.sqlite.prepare(
      "INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES (?, 'u1', ?, ?, ?, ?)"
    );
    session.run(
      "old",
      NOW.toISOString(),
      NOW.toISOString(),
      "2026-11-11T00:00:00.000Z",
      "2026-12-30T00:00:00.000Z"
    );
    session.run(
      "absolute",
      NOW.toISOString(),
      NOW.toISOString(),
      "2026-11-30T00:00:00.000Z",
      "2026-11-10T00:00:00.000Z"
    );
    session.run(
      "live",
      NOW.toISOString(),
      NOW.toISOString(),
      "2026-11-30T00:00:00.000Z",
      "2026-12-30T00:00:00.000Z"
    );
    const attempt = db.sqlite.prepare(
      "INSERT INTO login_attempts (bucket, attempted_at, success) VALUES ('b', ?, 0)"
    );
    attempt.run("2026-11-10T00:00:00.000Z");
    attempt.run("2026-11-12T01:00:00.000Z");
    const notification = db.sqlite.prepare(
      "INSERT INTO notifications (id, kind, severity, title, body, dedupe_key, created_at) VALUES (?, 'urgent', 'warning', 't', 'b', ?, ?)"
    );
    notification.run("n-old", "k1", "2026-08-01T00:00:00.000Z");
    notification.run("n-new", "k2", "2026-09-01T00:00:00.000Z");

    const report = await runDailyJob(envOf(db), { now: NOW });

    expect(report).toMatchObject({
      purged: { loginAttempts: 1, notifications: 1, sessions: 2 },
      status: "ok",
    });
    expect(count(db, "sessions")).toBe(1);
    expect(count(db, "login_attempts")).toBe(1);
    expect(count(db, "notifications")).toBe(1);
  });
});
