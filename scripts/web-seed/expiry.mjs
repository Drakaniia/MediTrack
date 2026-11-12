/**
 * Expiry classification for the seed (mirror of `classifyDays` / `assessExpiry` in
 * `apps/web/shared/expiry.ts`; the tests check both against each other).
 */

import { daysBetween } from "./dates.mjs";

export const DEFAULT_THRESHOLDS = { nearDays: 30, urgentDays: 7 };

/**
 * @typedef {"safe" | "near_expiry" | "urgent" | "expired"} ExpiryClass
 * @typedef {{ nearDays: number, urgentDays: number }} Thresholds
 */

/**
 * @param {number | null} daysUntil
 * @param {Thresholds} thresholds
 * @returns {ExpiryClass}
 */
export function classifyDays(daysUntil, thresholds) {
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

/**
 * @param {string | null} expiry
 * @param {string} today
 * @param {Thresholds} thresholds
 * @returns {ExpiryClass}
 */
export function classifyExpiry(expiry, today, thresholds) {
  return classifyDays(
    expiry === null ? null : daysBetween(today, expiry),
    thresholds
  );
}
