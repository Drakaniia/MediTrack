/**
 * What one cron tick does.
 *
 * The trigger fires every 15 minutes (UTC), on purpose: the facility decides WHEN the daily run
 * happens (`settings.schedule.dailyTime`) and in WHICH timezone, with daylight saving.
 * Each tick therefore only converts its scheduled time to facility time and lets
 * `runDailyJob` decide whether the day's run is due; `job_runs` keeps it to once per local
 * day. Time comes from the tick (`controller.scheduledTime`), never from the wall clock, so
 * a delayed or replayed tick is judged by when it was MEANT to run.
 */

import { runDailyJob } from "../../../apps/web/server/services/alerts/daily-job";
import type { DailyJobReport } from "../../../apps/web/shared/schemas/alert-run";
import type { CronEnv, ScheduledControllerLike } from "./env";

export interface SchedulerDeps {
  /** Test seam for the push service; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Runs the tick. Resolves with the report; never rejects (`runDailyJob` never throws). */
export function runScheduled(
  controller: ScheduledControllerLike,
  env: CronEnv,
  deps: SchedulerDeps = {}
): Promise<DailyJobReport> {
  return runDailyJob(env, {
    fetch: deps.fetch,
    now: new Date(controller.scheduledTime),
  });
}
