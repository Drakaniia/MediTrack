import { daysBetween, isIsoDate, zonedParts } from "@shared/dates";

/**
 * Display formatting. Everything that depends on a clock or a calendar reads
 * the FACILITY timezone (`useFacility().timezone`), never the browser's: a
 * nurse's laptop set to the wrong zone must still show the clinic's "today".
 *
 * Calendar dates (`YYYY-MM-DD`, e.g. expiry) are parsed by their parts, so no
 * timezone can shift them by a day. Instants (`2026-11-12T02:55:53.123Z`) go
 * through `Intl` with an explicit `timeZone`.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Shown for a missing value. */
export const EMPTY_VALUE = "—";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const PLAIN_WORD = /^[a-z]+$/;
const SIBILANT_ENDING = /(?:x|z|ch|sh)$/;
const CONSONANT_Y_ENDING = /[^aeiou]y$/;

/** Units that do not take an "s" ("5 ml", "2 mg"). */
const INVARIANT_UNITS: ReadonlySet<string> = new Set([
  "cc",
  "g",
  "iu",
  "kg",
  "l",
  "mcg",
  "mg",
  "ml",
  "oz",
  "pc",
  "pcs",
]);

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseInstant(isoUtc: string | null | undefined): Date | null {
  if (!isoUtc) {
    return null;
  }
  const date = new Date(isoUtc);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `2026-11-12` → "12 Nov 2026". A malformed value is returned as-is; empty → "—". */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) {
    return EMPTY_VALUE;
  }
  if (!isIsoDate(isoDate)) {
    return isoDate;
  }
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** An ISO-UTC instant → "12 Nov 2026, 10:55" on the facility's clock (24-hour). */
export function formatDateTime(
  isoUtc: string | null | undefined,
  timeZone: string
): string {
  const instant = parseInstant(isoUtc);
  if (!instant) {
    return isoUtc || EMPTY_VALUE;
  }
  const { day, hour, minute, month, year } = zonedParts(instant, timeZone);
  return `${day} ${MONTHS[month - 1]} ${year}, ${pad2(hour)}:${pad2(minute)}`;
}

/** An ISO-UTC instant → "10:55" on the facility's clock (24-hour). */
export function formatTime(
  isoUtc: string | null | undefined,
  timeZone: string
): string {
  const instant = parseInstant(isoUtc);
  if (!instant) {
    return isoUtc || EMPTY_VALUE;
  }
  const { hour, minute } = zonedParts(instant, timeZone);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * A calendar date relative to the facility's `today` (`useFacility().today`):
 * "Today", "Tomorrow", "Yesterday", "In 5 days", "3 days ago".
 */
export function formatRelativeDay(
  isoDate: string | null | undefined,
  today: string
): string {
  if (!isoDate) {
    return EMPTY_VALUE;
  }
  if (!(isIsoDate(isoDate) && isIsoDate(today))) {
    return isoDate;
  }
  const days = daysBetween(today, isoDate);
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Tomorrow";
  }
  if (days === -1) {
    return "Yesterday";
  }
  return days > 0 ? `In ${days} days` : `${Math.abs(days)} days ago`;
}

function pluralize(unit: string): string {
  const lower = unit.toLowerCase();
  if (
    !PLAIN_WORD.test(lower) ||
    INVARIANT_UNITS.has(lower) ||
    lower.endsWith("s")
  ) {
    return unit;
  }
  if (SIBILANT_ENDING.test(lower)) {
    return `${unit}es`;
  }
  if (CONSONANT_Y_ENDING.test(lower)) {
    return `${unit.slice(0, -1)}ies`;
  }
  return `${unit}s`;
}

/** `1250, "tablet"` → "1,250 tablets"; `1, "box"` → "1 box"; `3, "ml"` → "3 ml". */
export function formatQuantity(qty: number, unit: string): string {
  if (!Number.isFinite(qty)) {
    return EMPTY_VALUE;
  }
  const amount = NUMBER_FORMAT.format(qty);
  const trimmed = unit.trim();
  if (trimmed === "") {
    return amount;
  }
  return `${amount} ${qty === 1 ? trimmed : pluralize(trimmed)}`;
}
