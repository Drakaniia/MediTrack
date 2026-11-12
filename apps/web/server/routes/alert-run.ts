import type { EmailBinding } from "../../../../workers/cron/src/email/sender";
import {
  alertRunBodySchema,
  type DailyJobReport,
  type JobRunDto,
} from "../../shared/schemas/alert-run";
import { actorOf, auditStatement } from "../audit";
import type { Env } from "../env";
import { ok, parseJson } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { type DailyJobEnv, runDailyJob } from "../services/alerts/daily-job";

/**
 * Admin-triggered alert job (`settings.manage`), shared with the cron Worker: the same
 * `runDailyJob` runs here in force mode so an admin can test push / email without waiting
 * for the schedule.
 */

const STATUS_LIMIT = 10;

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isEmailBinding(value: unknown): value is EmailBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    "send" in value &&
    typeof value.send === "function"
  );
}

/**
 * Push / email bindings are optional on the Pages project and not part of the shared `Env`
 * contract, so they are read defensively: a missing or mistyped value is simply absent and
 * the job reports the channel as skipped.
 */
export function readRunEnv(env: Env): DailyJobEnv {
  const bag = env as unknown as Record<string, unknown>;
  return {
    APP_URL: stringOf(bag.APP_URL),
    DB: env.DB,
    EMAIL: isEmailBinding(bag.EMAIL) ? bag.EMAIL : undefined,
    EMAIL_FROM: stringOf(bag.EMAIL_FROM),
    EMAIL_FROM_NAME: stringOf(bag.EMAIL_FROM_NAME),
    VAPID_PRIVATE_KEY: stringOf(bag.VAPID_PRIVATE_KEY),
    VAPID_PUBLIC_KEY: stringOf(bag.VAPID_PUBLIC_KEY),
    VAPID_SUBJECT: stringOf(bag.VAPID_SUBJECT),
  };
}

function describeReport(report: DailyJobReport): string {
  if (report.status === "error") {
    return `Alert job failed: ${report.message}`;
  }
  if (report.status === "skipped") {
    return `Alert job skipped (${report.reason})`;
  }
  return `Ran the alert job: ${report.transitions} new expiry alerts, ${report.lowStockAlerts} low-stock, ${report.notificationsCreated} notifications, push sent to ${report.push.sent} device(s)`;
}

async function run(ctx: ProtectedRouteContext): Promise<Response> {
  const body = await parseJson(ctx, alertRunBodySchema);
  const report = await runDailyJob(readRunEnv(ctx.env), {
    force: body.force ?? true,
    now: ctx.now,
    sendEmail: body.sendEmail ?? false,
  });
  await ctx.db.batch([
    auditStatement(ctx.db, {
      action: "alerts.run",
      actor: actorOf(ctx.user),
      after: report,
      at: ctx.now.toISOString(),
      entityId: report.localDate,
      entityType: "alerts",
      ip: ctx.ip,
      summary: describeReport(report),
    }),
  ]);
  return ok(report);
}

interface JobRunRow {
  finished_at: string | null;
  id: string;
  job: string;
  run_date: string;
  started_at: string;
  status: JobRunDto["status"];
  summary: string | null;
}

function parseSummary(text: string | null): unknown {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function status(ctx: ProtectedRouteContext): Promise<Response> {
  const { results } = await ctx.db
    .prepare(
      "SELECT id, job, run_date, started_at, finished_at, status, summary FROM job_runs ORDER BY started_at DESC, id LIMIT ?"
    )
    .bind(STATUS_LIMIT)
    .all<JobRunRow>();
  const runs: JobRunDto[] = results.map((row) => ({
    finishedAt: row.finished_at,
    id: row.id,
    job: row.job,
    runDate: row.run_date,
    startedAt: row.started_at,
    status: row.status,
    summary: parseSummary(row.summary),
  }));
  return ok(runs);
}

export const alertRunRoutes: RouteDef[] = [
  {
    access: "settings.manage",
    handler: run,
    method: "POST",
    path: "/api/alerts/run",
  },
  {
    access: "settings.manage",
    handler: status,
    method: "GET",
    path: "/api/alerts/run/status",
  },
];
