/**
 * Bindings of the cron Worker (see `wrangler.toml`).
 *
 * `DB` is the web app's D1 database; `VAPID_*`, `EMAIL*` and `APP_URL` are optional at
 * runtime: the daily job reports a channel as skipped when its configuration is missing
 * instead of failing. `VAPID_PRIVATE_KEY` is a secret (`wrangler secret put`).
 */

import type { DailyJobEnv } from "../../../apps/web/server/services/alerts/daily-job";

export type CronEnv = DailyJobEnv;

/** The part of Cloudflare's `ScheduledController` the Worker reads. */
export interface ScheduledControllerLike {
  cron: string;
  /** Epoch milliseconds the trigger was scheduled for (not when it started running). */
  scheduledTime: number;
}

/** The part of Cloudflare's `ExecutionContext` the Worker uses. */
export interface ExecutionContextLike {
  waitUntil: (promise: Promise<unknown>) => void;
}
