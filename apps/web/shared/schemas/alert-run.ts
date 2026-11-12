/**
 * Wire types of the daily alert job and its admin "run now" endpoint (spec §7.6, §8.6).
 *
 * The same report shape is produced by the cron Worker (and stored, as JSON, in
 * `job_runs.summary`) and returned by `POST /api/alerts/run`.
 *
 * Relative imports only (bundled by wrangler as well as Vite).
 */

import { z } from "zod";

/** Body of `POST /api/alerts/run`. */
export const alertRunBodySchema = z.strictObject({
  /** Skip the "is it time yet / already ran today" check. Default true for the admin endpoint. */
  force: z.boolean().optional(),
  /** Also send the email digest. Default false: a test click must not email everyone. */
  sendEmail: z.boolean().optional(),
});
export type AlertRunBody = z.infer<typeof alertRunBodySchema>;

export interface AlertRunCounts {
  expired: number;
  lowStock: number;
  nearExpiry: number;
  safe: number;
  urgent: number;
}

export type PushSkipReason =
  | "disabled"
  | "error"
  | "no_devices"
  | "no_vapid"
  | "nothing_new";

export interface PushRunReport {
  /** Devices a push was attempted for. */
  devices: number;
  /** Retry + failed outcomes (their `failure_count` went up). */
  failed: number;
  /** 404/410: the subscription was deleted. */
  gone: number;
  /** Subscriptions deleted after 5 consecutive failures. */
  removed: number;
  sent: number;
  /** Why nothing was attempted, or null when pushes were attempted. */
  skipped: PushSkipReason | null;
}

export type EmailSkipReason =
  | "disabled"
  | "error"
  | "no_binding"
  | "no_recipients"
  | "no_sender"
  | "not_requested"
  | "quiet";

export interface EmailFailure {
  code: string;
  to: string;
}

export interface EmailRunReport {
  failed: number;
  failures: EmailFailure[];
  recipients: number;
  sent: number;
  /** Invalid / over-limit addresses the sender refused to try. */
  skipped: number;
  /** Why no email was attempted, or null when it was. */
  skippedReason: EmailSkipReason | null;
}

export interface PurgeReport {
  loginAttempts: number;
  notifications: number;
  sessions: number;
}

export interface DailyJobDone {
  counts: AlertRunCounts;
  email: EmailRunReport;
  force: boolean;
  localDate: string;
  lowStockAlerts: number;
  notificationsCreated: number;
  purged: PurgeReport;
  push: PushRunReport;
  resolved: number;
  status: "ok";
  transitions: number;
}

export type DailyJobSkipReason = "already_ran" | "not_due" | "running";

export interface DailyJobSkipped {
  dueTime: string;
  localDate: string;
  localTime: string;
  reason: DailyJobSkipReason;
  status: "skipped";
}

export interface DailyJobFailed {
  localDate: string | null;
  message: string;
  status: "error";
}

export type DailyJobReport = DailyJobDone | DailyJobFailed | DailyJobSkipped;

/** One row of `GET /api/alerts/run/status`. */
export interface JobRunDto {
  finishedAt: string | null;
  id: string;
  job: string;
  runDate: string;
  startedAt: string;
  status: "error" | "ok" | "running";
  /** The stored report (`DailyJobDone`) or `{ message }` for a failure; null while running. */
  summary: unknown;
}
