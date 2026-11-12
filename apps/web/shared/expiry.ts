/**
 * Expiry classification (spec §6.2) — Safe / Near Expiry / Urgent / Expired.
 *
 * Copied in shape from the desktop app's `classifyExpiry`, with the labels the
 * brief uses ("Urgent" and "Near Expiry" instead of "Expiring Soon" / "Expiring
 * Later") and with whole-day arithmetic done on facility-local calendar dates
 * rather than `Date.now()`.
 *
 * The class is NEVER stored: it is derived from `expiry`, today in the facility
 * timezone and the two thresholds, so changing a threshold is instantly
 * consistent everywhere. SQL callers use `classBoundaries()` + `expiryClassCase()`
 * so the database and the UI can never disagree about a boundary day.
 */

import { addDays, daysBetween } from "./dates";

export const EXPIRY_CLASSES = [
  "safe",
  "near_expiry",
  "urgent",
  "expired",
] as const;

export type ExpiryClass = (typeof EXPIRY_CLASSES)[number];

/** Text is always shown with the colour — colour is never the only signal (spec §10). */
export const EXPIRY_CLASS_LABELS: Record<ExpiryClass, string> = {
  expired: "Expired",
  near_expiry: "Near Expiry",
  safe: "Safe",
  urgent: "Urgent",
};

/** Lower = more severe. Use to sort "worst first". */
export const EXPIRY_CLASS_RANK: Record<ExpiryClass, number> = {
  expired: 0,
  near_expiry: 2,
  safe: 3,
  urgent: 1,
};

export interface ExpiryThresholds {
  /** Last day count (inclusive) that is still "Near Expiry". Default 30. */
  nearDays: number;
  /** Last day count (inclusive) that is "Urgent". Default 7. */
  urgentDays: number;
}

export const DEFAULT_EXPIRY_THRESHOLDS: ExpiryThresholds = {
  nearDays: 30,
  urgentDays: 7,
};

/** Upper bound for either threshold (three years) — a typo guard, not a business rule. */
export const MAX_THRESHOLD_DAYS = 1095;

export type ThresholdValidation = { ok: true } | { message: string; ok: false };

/** `0 ≤ urgentDays < nearDays ≤ MAX_THRESHOLD_DAYS`, both whole numbers. */
export function validateThresholds(
  thresholds: ExpiryThresholds
): ThresholdValidation {
  const { nearDays, urgentDays } = thresholds;
  if (!(Number.isInteger(urgentDays) && Number.isInteger(nearDays))) {
    return { message: "Thresholds must be whole numbers of days.", ok: false };
  }
  if (urgentDays < 0) {
    return { message: "Urgent days cannot be negative.", ok: false };
  }
  if (urgentDays >= nearDays) {
    return {
      message: "Urgent days must be fewer than Near Expiry days.",
      ok: false,
    };
  }
  if (nearDays > MAX_THRESHOLD_DAYS) {
    return {
      message: `Near Expiry days cannot exceed ${MAX_THRESHOLD_DAYS}.`,
      ok: false,
    };
  }
  return { ok: true };
}

/**
 * Class for a whole-day count. `null` (no expiry date) is Safe.
 * `daysUntil` is `expiry − today` in calendar days: 0 means "expires today".
 */
export function classifyDays(
  daysUntil: number | null,
  thresholds: ExpiryThresholds = DEFAULT_EXPIRY_THRESHOLDS
): ExpiryClass {
  if (daysUntil === null) {
    return "safe";
  }
  if (daysUntil < 0) {
    return "expired";
  }
  if (daysUntil <= thresholds.urgentDays) {
    return "urgent";
  }
  if (daysUntil <= thresholds.nearDays) {
    return "near_expiry";
  }
  return "safe";
}

/** Days from facility-local `today` to `expiry`; `null` when there is no expiry. */
export function daysUntilExpiry(
  expiry: string | null,
  today: string
): number | null {
  return expiry === null ? null : daysBetween(today, expiry);
}

export interface ExpiryAssessment {
  daysUntil: number | null;
  expiryClass: ExpiryClass;
}

export function assessExpiry(
  expiry: string | null,
  today: string,
  thresholds: ExpiryThresholds = DEFAULT_EXPIRY_THRESHOLDS
): ExpiryAssessment {
  const daysUntil = daysUntilExpiry(expiry, today);
  return { daysUntil, expiryClass: classifyDays(daysUntil, thresholds) };
}

/** True when a batch with this expiry can no longer be used (strictly before today). */
export function isExpired(expiry: string | null, today: string): boolean {
  return expiry !== null && expiry < today;
}

// ─── SQL helpers ────────────────────────────────────────────────────────────

export interface ClassBoundaries {
  /** Last date (inclusive) that is Near Expiry. */
  nearUntil: string;
  today: string;
  /** Last date (inclusive) that is Urgent. */
  urgentUntil: string;
}

/**
 * ISO date cut-offs equivalent to the day-count rules, so a query can classify
 * with plain string comparison on the indexed `expiry` column:
 *
 *   expired  expiry <  today
 *   urgent   today ≤ expiry ≤ urgentUntil
 *   near     urgentUntil < expiry ≤ nearUntil
 *   safe     expiry > nearUntil, or expiry IS NULL
 */
export function classBoundaries(
  today: string,
  thresholds: ExpiryThresholds = DEFAULT_EXPIRY_THRESHOLDS
): ClassBoundaries {
  return {
    nearUntil: addDays(today, thresholds.nearDays),
    today,
    urgentUntil: addDays(today, thresholds.urgentDays),
  };
}

export interface SqlFragment {
  params: string[];
  sql: string;
}

/**
 * A `CASE` expression yielding 'safe' | 'near_expiry' | 'urgent' | 'expired'
 * for `column` (e.g. `"b.expiry"`). Bind `params` in order wherever the
 * fragment appears. `column` must be a trusted identifier, never user input.
 */
export function expiryClassCase(
  column: string,
  boundaries: ClassBoundaries
): SqlFragment {
  return {
    params: [boundaries.today, boundaries.urgentUntil, boundaries.nearUntil],
    sql: `CASE WHEN ${column} IS NULL THEN 'safe' WHEN ${column} < ? THEN 'expired' WHEN ${column} <= ? THEN 'urgent' WHEN ${column} <= ? THEN 'near_expiry' ELSE 'safe' END`,
  };
}

/**
 * `WHERE` fragment selecting rows of ONE expiry class. Binds the same
 * boundaries `expiryClassCase` does, but is index-friendly (range scans).
 */
export function expiryClassWhere(
  column: string,
  expiryClass: ExpiryClass,
  boundaries: ClassBoundaries
): SqlFragment {
  switch (expiryClass) {
    case "expired":
      return {
        params: [boundaries.today],
        sql: `(${column} IS NOT NULL AND ${column} < ?)`,
      };
    case "urgent":
      return {
        params: [boundaries.today, boundaries.urgentUntil],
        sql: `(${column} >= ? AND ${column} <= ?)`,
      };
    case "near_expiry":
      return {
        params: [boundaries.urgentUntil, boundaries.nearUntil],
        sql: `(${column} > ? AND ${column} <= ?)`,
      };
    default:
      return {
        params: [boundaries.nearUntil],
        sql: `(${column} IS NULL OR ${column} > ?)`,
      };
  }
}

// ─── Wording ────────────────────────────────────────────────────────────────

export function relativeExpiryText(daysUntil: number | null): string {
  if (daysUntil === null) {
    return "No expiry";
  }
  if (daysUntil < 0) {
    return `Expired ${Math.abs(daysUntil)}d ago`;
  }
  if (daysUntil === 0) {
    return "Expires today";
  }
  if (daysUntil === 1) {
    return "Expires tomorrow";
  }
  return `In ${daysUntil}d`;
}
