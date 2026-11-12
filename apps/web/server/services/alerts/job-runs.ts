/**
 * Once-per-day idempotence for scheduled work, on top of `job_runs`
 * (`UNIQUE (job, run_date)`, run_date = the facility-local date).
 *
 * A run is CLAIMED by inserting a `running` row. Whoever fails to insert lost the race
 * (or the job already ran today). A `running` row older than {@link STALE_RUN_MS} belongs
 * to a Worker that died mid-run and may be re-claimed; an `error` row is retried on the
 * next tick; an `ok` row is only re-claimed by an explicit `force`.
 */

import type { D1DatabaseLike } from "../../env";
import { newId } from "../../ids";

export const DAILY_JOB = "daily";

/** A `running` row older than this is presumed dead. A real run takes seconds. */
export const STALE_RUN_MINUTES = 30;
const MS_PER_MINUTE = 60_000;
export const STALE_RUN_MS = STALE_RUN_MINUTES * MS_PER_MINUTE;

export type ClaimResult = "already_ran" | "claimed" | "running";

export interface ClaimOptions {
  /** Re-run even if today's run already finished `ok`. */
  force: boolean;
  job: string;
  now: Date;
  runDate: string;
}

export async function claimRun(
  db: D1DatabaseLike,
  options: ClaimOptions
): Promise<ClaimResult> {
  const { job, runDate, now, force } = options;
  const startedAt = now.toISOString();
  const inserted = await db
    .prepare(
      "INSERT OR IGNORE INTO job_runs (id, job, run_date, started_at, status) VALUES (?, ?, ?, ?, 'running')"
    )
    .bind(newId(), job, runDate, startedAt)
    .run();
  if (inserted.meta.changes > 0) {
    return "claimed";
  }
  const staleBefore = new Date(now.getTime() - STALE_RUN_MS).toISOString();
  const reclaimed = await db
    .prepare(
      `UPDATE job_runs SET status = 'running', started_at = ?, finished_at = NULL, summary = NULL
       WHERE job = ? AND run_date = ?
         AND (status = 'error' OR (? = 1 AND status = 'ok') OR (status = 'running' AND started_at < ?))`
    )
    .bind(startedAt, job, runDate, force ? 1 : 0, staleBefore)
    .run();
  if (reclaimed.meta.changes > 0) {
    return "claimed";
  }
  const existing = await db
    .prepare("SELECT status FROM job_runs WHERE job = ? AND run_date = ?")
    .bind(job, runDate)
    .first<{ status: string }>();
  return existing?.status === "running" ? "running" : "already_ran";
}

export async function finishRun(
  db: D1DatabaseLike,
  options: {
    finishedAt: Date;
    job: string;
    runDate: string;
    status: "error" | "ok";
    summary: unknown;
  }
): Promise<void> {
  await db
    .prepare(
      "UPDATE job_runs SET status = ?, finished_at = ?, summary = ? WHERE job = ? AND run_date = ?"
    )
    .bind(
      options.status,
      options.finishedAt.toISOString(),
      JSON.stringify(options.summary),
      options.job,
      options.runDate
    )
    .run();
}
