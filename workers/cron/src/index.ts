/**
 * MediTract cron Worker: expiry transitions, notifications, web push and the daily email
 * digest, against the same D1 as the web app. Not a web service: `fetch` answers 404.
 */

import type {
  CronEnv,
  ExecutionContextLike,
  ScheduledControllerLike,
} from "./env";
import { runScheduled } from "./scheduler";

export default {
  fetch: (): Response => new Response("Not found", { status: 404 }),
  scheduled: (
    controller: ScheduledControllerLike,
    env: CronEnv,
    ctx: ExecutionContextLike
  ): void => {
    ctx.waitUntil(runScheduled(controller, env));
  },
};
