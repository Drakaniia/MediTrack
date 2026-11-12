/**
 * The daily job (spec §8.6): generate alerts, push, email the digest, housekeeping.
 *
 * The cron Worker wakes every 15 minutes in UTC; THIS function decides in FACILITY time
 * whether the day's run is due, so a DST change or a new `schedule.dailyTime` needs no
 * redeploy. Due = facility-local time ≥ `dailyTime` and no `job_runs` row for
 * (`daily`, local date) that is `ok` or a fresh `running` (see `job-runs.ts`). Missed ticks
 * catch up on the next one the same local day.
 *
 * Never throws: every failure becomes `{ status: "error" }` (and an `error` job_runs row,
 * retried on the next tick). Push and email problems are data in the report, never a failure.
 */

import { timeInZone, todayInZone } from "../../../shared/dates";
import type {
  DailyJobDone,
  DailyJobReport,
  EmailRunReport,
  PushRunReport,
} from "../../../shared/schemas/alert-run";
import type { AppSettings } from "../../../shared/settings";
import type { D1DatabaseLike } from "../../env";
import { logError, logWarn } from "../../log";
import { loadSettings } from "../../settings-store";
import { type EmailEnv, sendDailyDigest } from "./email-step";
import { runAlertGeneration } from "./generate";
import { claimRun, DAILY_JOB, finishRun } from "./job-runs";
import { purgeOldRows } from "./purge";
import { type PushEnv, sendDailyPush } from "./push-step";
import type { GenerationResult } from "./types";

export interface DailyJobEnv extends EmailEnv, PushEnv {
  DB: D1DatabaseLike;
}

export interface DailyJobDeps {
  /** Test seam; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Skip the "is it time yet" check (and re-run a day that already finished). */
  force?: boolean;
  /** The injected clock: the cron's scheduled time, or the request time. */
  now: Date;
  /** Send the email digest when it is enabled and possible. Default true. */
  sendEmail?: boolean;
}

/**
 * The cron fires at :00/:15/:30/:45, so a run time after the day's last tick would never
 * be reached before midnight. It is clamped to that last tick instead of being skipped.
 */
export const LAST_TICK_OF_DAY = "23:45";

function dueTimeOf(settings: AppSettings): string {
  const configured = settings.schedule.dailyTime;
  return configured > LAST_TICK_OF_DAY ? LAST_TICK_OF_DAY : configured;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pushStep(
  env: DailyJobEnv,
  settings: AppSettings,
  generation: GenerationResult,
  deps: DailyJobDeps
): Promise<PushRunReport> {
  try {
    return await sendDailyPush(env.DB, env, settings, generation, deps);
  } catch (error) {
    logWarn("daily job: push step failed", error);
    return {
      devices: 0,
      failed: 0,
      gone: 0,
      removed: 0,
      sent: 0,
      skipped: "error",
    };
  }
}

async function emailStep(
  env: DailyJobEnv,
  settings: AppSettings,
  generation: GenerationResult,
  deps: DailyJobDeps
): Promise<EmailRunReport> {
  try {
    return await sendDailyDigest(
      env,
      settings,
      generation,
      deps.sendEmail ?? true
    );
  } catch (error) {
    logWarn("daily job: email step failed", error);
    return {
      failed: 0,
      failures: [],
      recipients: settings.digest.recipients.length,
      sent: 0,
      skipped: 0,
      skippedReason: "error",
    };
  }
}

async function doWork(
  env: DailyJobEnv,
  settings: AppSettings,
  deps: DailyJobDeps
): Promise<DailyJobDone> {
  const generation = await runAlertGeneration(env.DB, {
    now: deps.now,
    settings,
  });
  const push = await pushStep(env, settings, generation, deps);
  const email = await emailStep(env, settings, generation, deps);
  const purged = await purgeOldRows(env.DB, deps.now);
  return {
    counts: generation.counts,
    email,
    force: deps.force ?? false,
    localDate: generation.localDate,
    lowStockAlerts: generation.lowStock.length,
    notificationsCreated: generation.notificationsCreated,
    purged,
    push,
    resolved: generation.resolved,
    status: "ok",
    transitions: generation.transitions.length,
  };
}

async function failRun(
  db: D1DatabaseLike,
  localDate: string,
  now: Date,
  message: string
): Promise<void> {
  try {
    await finishRun(db, {
      finishedAt: now,
      job: DAILY_JOB,
      runDate: localDate,
      status: "error",
      summary: { message },
    });
  } catch (error) {
    logError("daily job: could not record the failure", error);
  }
}

async function execute(
  env: DailyJobEnv,
  deps: DailyJobDeps
): Promise<DailyJobReport> {
  const settings = await loadSettings(env.DB);
  const zone = settings.facility.timezone;
  const localDate = todayInZone(deps.now, zone);
  const force = deps.force ?? false;

  if (!force) {
    const localTime = timeInZone(deps.now, zone);
    const dueTime = dueTimeOf(settings);
    if (localTime < dueTime) {
      return {
        dueTime,
        localDate,
        localTime,
        reason: "not_due",
        status: "skipped",
      };
    }
  }

  const claim = await claimRun(env.DB, {
    force,
    job: DAILY_JOB,
    now: deps.now,
    runDate: localDate,
  });
  if (claim !== "claimed") {
    return {
      dueTime: dueTimeOf(settings),
      localDate,
      localTime: timeInZone(deps.now, zone),
      reason: claim,
      status: "skipped",
    };
  }

  try {
    const report = await doWork(env, settings, deps);
    await finishRun(env.DB, {
      finishedAt: deps.now,
      job: DAILY_JOB,
      runDate: localDate,
      status: "ok",
      summary: report,
    });
    return report;
  } catch (error) {
    const message = describeError(error);
    logError("daily job failed", error, { localDate });
    await failRun(env.DB, localDate, deps.now, message);
    return { localDate, message, status: "error" };
  }
}

/** Runs the day's alert job if it is due. Never throws. */
export async function runDailyJob(
  env: DailyJobEnv,
  deps: DailyJobDeps
): Promise<DailyJobReport> {
  try {
    return await execute(env, deps);
  } catch (error) {
    logError("daily job could not start", error);
    return { localDate: null, message: describeError(error), status: "error" };
  }
}
