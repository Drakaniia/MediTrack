/**
 * The ONLY place in `server/` that touches `console` (ARCHITECTURE.md §2.1).
 *
 * One JSON object per line, so Cloudflare's log tail / Logpush can filter on
 * fields. Context goes through the same key-based redaction as the audit trail:
 * passwords, tokens, hashes and push keys are replaced even if a caller passes a
 * whole row. Still, never put them in a message or context on purpose.
 */

import { toRedactedJson } from "./services/platform/redact";

export type LogContext = Record<string, unknown>;

type LogLevel = "error" | "warn";

const MAX_CAUSE_DEPTH = 3;

interface ErrorSummary {
  cause?: ErrorSummary;
  message: string;
  name: string;
  stack?: string;
}

function summarizeError(error: unknown, depth = 0): ErrorSummary {
  if (!(error instanceof Error)) {
    return { message: String(error), name: typeof error };
  }
  const summary: ErrorSummary = {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };
  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    summary.cause = summarizeError(error.cause, depth + 1);
  }
  return summary;
}

function write(
  level: LogLevel,
  message: string,
  error: unknown,
  context: LogContext | undefined
): void {
  const line =
    toRedactedJson({
      context,
      error: error === undefined ? undefined : summarizeError(error),
      level,
      message,
    }) ?? JSON.stringify({ level, message });
  if (level === "error") {
    console.error(line);
    return;
  }
  console.warn(line);
}

/** An unexpected failure an operator should look at. */
export function logError(
  message: string,
  error?: unknown,
  context?: LogContext
): void {
  write("error", message, error, context);
}

/** Something degraded but handled (a failed best-effort write, a rejected push endpoint). */
export function logWarn(
  message: string,
  error?: unknown,
  context?: LogContext
): void {
  write("warn", message, error, context);
}
