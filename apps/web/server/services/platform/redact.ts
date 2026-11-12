/**
 * Secret redaction shared by the audit trail (`server/audit.ts`) and the error
 * logger (`server/log.ts`).
 *
 * Redaction is KEY based: any property whose name looks sensitive is replaced by
 * a marker at every depth, so a slice that snapshots a whole row into `before` /
 * `after` (or into a log context) can never leak a hash, token or push key.
 */

/** Property names that must never reach the audit log or the console. */
export const SENSITIVE_KEY = /password|hash|token|secret|p256dh|auth|pepper/i;

export const REDACTED = "[redacted]";

function redactingReplacer(key: string, value: unknown): unknown {
  return SENSITIVE_KEY.test(key) ? REDACTED : value;
}

/**
 * JSON text of `value` with sensitive keys replaced. Returns `null` for
 * `undefined` and for values JSON cannot represent (circular structures,
 * bigint), so callers never have to guard against a throw.
 */
export function toRedactedJson(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value, redactingReplacer) ?? null;
  } catch {
    return null;
  }
}
