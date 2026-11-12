import type {
  DailyJobDone,
  DailyJobReport,
  EmailSkipReason,
  JobRunDto,
  PushSkipReason,
} from "@shared/schemas/alert-run";

export const PUSH_SKIP_TEXT: Record<PushSkipReason, string> = {
  disabled: "Browser push is turned off.",
  error: "Push sending failed.",
  no_devices: "No devices are subscribed to push.",
  no_vapid: "Push keys are not configured on the server.",
  nothing_new: "Nothing new to push.",
};

export const EMAIL_SKIP_TEXT: Record<EmailSkipReason, string> = {
  disabled: "The email digest is turned off.",
  error: "Email sending failed.",
  no_binding: "Email sending is not configured on the server.",
  no_recipients: "There are no recipients.",
  no_sender: "No sender address is configured.",
  not_requested: "Not sent: “Also send the email digest” was off.",
  quiet: "Skipped: nothing new today.",
};

export const SKIP_REASON_TEXT: Record<string, string> = {
  already_ran: "It already ran today.",
  not_due: "It is not time yet.",
  running: "Another run is in progress.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A stored `job_runs.summary` that is a finished report, or `null` for anything else. */
export function asDoneReport(summary: unknown): DailyJobDone | null {
  if (
    isRecord(summary) &&
    summary.status === "ok" &&
    isRecord(summary.push) &&
    isRecord(summary.email)
  ) {
    return summary as unknown as DailyJobDone;
  }
  return null;
}

export function isDone(report: DailyJobReport): report is DailyJobDone {
  return report.status === "ok";
}

/** One line for the "Last runs" table. */
export function describeJobRun(run: JobRunDto): string {
  const done = asDoneReport(run.summary);
  if (done) {
    return `${done.notificationsCreated} notifications · push sent ${done.push.sent} · email sent ${done.email.sent}`;
  }
  if (run.status === "error" && isRecord(run.summary)) {
    const { message } = run.summary;
    return typeof message === "string" ? message : "Failed";
  }
  return run.status === "running" ? "In progress" : "—";
}
