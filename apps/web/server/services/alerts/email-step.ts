/**
 * Daily email digest: current counts plus what is NEW in this run (spec §7.6). Sent as one
 * message per recipient, so a recipient the free tier refuses (`E_RECIPIENT_NOT_ALLOWED`)
 * never blocks the others. Every problem here is DATA in the report, never an exception:
 * a missing binding or a failed recipient must not fail the job.
 */

import {
  type DigestInput,
  isQuietDigest,
  renderDigest,
} from "../../../../../workers/cron/src/email/digest-render";
import {
  createEmailSender,
  EMAIL_UNKNOWN_CODE,
  type EmailBinding,
  sendDigestToRecipients,
} from "../../../../../workers/cron/src/email/sender";
import type { EmailRunReport } from "../../../shared/schemas/alert-run";
import type { AppSettings } from "../../../shared/settings";
import type { GenerationResult } from "./types";

export interface EmailEnv {
  APP_URL?: string;
  EMAIL?: EmailBinding;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
}

const MAX_REPORTED_FAILURES = 10;

function emptyReport(
  skippedReason: NonNullable<EmailRunReport["skippedReason"]>,
  recipients = 0
): EmailRunReport {
  return {
    failed: 0,
    failures: [],
    recipients,
    sent: 0,
    skipped: 0,
    skippedReason,
  };
}

export function buildDigestInput(
  env: EmailEnv,
  settings: AppSettings,
  generation: GenerationResult
): DigestInput {
  return {
    appUrl: env.APP_URL?.trim() ?? "",
    counts: generation.counts,
    facilityName: settings.facility.name,
    localDate: generation.localDate,
    lowStock: generation.lowStock.map((entry) => ({
      itemName: entry.itemName,
      onHand: entry.available,
      threshold: entry.threshold,
      unit: entry.unit,
    })),
    transitions: generation.transitions.map((entry) => ({
      batchNumber: entry.batchNumber,
      daysUntil: entry.daysUntil,
      expiry: entry.expiry,
      from: entry.from,
      itemName: entry.itemName,
      to: entry.to,
    })),
  };
}

function skipReason(
  env: EmailEnv,
  settings: AppSettings,
  requested: boolean
): EmailRunReport["skippedReason"] {
  if (!requested) {
    return "not_requested";
  }
  if (!settings.alerts.emailDigest) {
    return "disabled";
  }
  if (settings.digest.recipients.length === 0) {
    return "no_recipients";
  }
  if (!env.EMAIL) {
    return "no_binding";
  }
  return (env.EMAIL_FROM?.trim() ?? "") === "" ? "no_sender" : null;
}

/** Sends the digest if it is wanted and possible. Never throws. */
export async function sendDailyDigest(
  env: EmailEnv,
  settings: AppSettings,
  generation: GenerationResult,
  requested: boolean
): Promise<EmailRunReport> {
  const { recipients } = settings.digest;
  const reason = skipReason(env, settings, requested);
  if (reason !== null) {
    return emptyReport(reason, recipients.length);
  }
  const input = buildDigestInput(env, settings, generation);
  if (settings.digest.skipWhenQuiet && isQuietDigest(input)) {
    return emptyReport("quiet", recipients.length);
  }
  try {
    const summary = await sendDigestToRecipients(
      createEmailSender(env),
      recipients,
      renderDigest(input)
    );
    const failures = summary.results.flatMap((entry) =>
      entry.status === "failed" && entry.result && !entry.result.ok
        ? [{ code: entry.result.code, to: entry.to }]
        : []
    );
    return {
      failed: summary.failed,
      failures: failures.slice(0, MAX_REPORTED_FAILURES),
      recipients: recipients.length,
      sent: summary.sent,
      skipped: summary.skipped,
      skippedReason: null,
    };
  } catch {
    return {
      failed: recipients.length,
      failures: [{ code: EMAIL_UNKNOWN_CODE, to: "*" }],
      recipients: recipients.length,
      sent: 0,
      skipped: 0,
      skippedReason: null,
    };
  }
}
