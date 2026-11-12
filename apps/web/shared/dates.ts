/**
 * Calendar and timezone arithmetic (spec §6.2).
 *
 * Expiry dates are plain `YYYY-MM-DD` calendar dates. "Today", "this month",
 * the digest hour and report month boundaries are all read in the FACILITY
 * timezone (`settings.facility.timezone`), never UTC and never the browser's
 * zone. This module is runtime-agnostic: it uses only `Intl` and `Date`, which
 * behave identically in Workers, Node and the browser.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1000;
const MIN_YEAR = 1900;
const HOURS_PER_DAY = 24;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** `YYYY-MM` with a real month. */
export function isIsoMonth(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = ISO_MONTH.exec(value);
  if (!match) {
    return false;
  }
  const month = Number(match[2]);
  return Number(match[1]) >= MIN_YEAR && month >= 1 && month <= 12;
}

/** `HH:MM`, 24-hour. */
export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_OF_DAY.test(value);
}

function utcMsOfDate(iso: string): number {
  if (!isIsoDate(iso)) {
    throw new RangeError(`Invalid ISO date: ${String(iso)}`);
  }
  return Date.parse(`${iso}T00:00:00.000Z`);
}

/** `iso` shifted by a whole number of calendar days (negative goes back). */
export function addDays(iso: string, days: number): string {
  return new Date(utcMsOfDate(iso) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/** Whole calendar days from `fromIso` to `toIso` (positive when `toIso` is later). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcMsOfDate(toIso) - utcMsOfDate(fromIso)) / MS_PER_DAY);
}

/** `YYYY-MM` of an ISO date. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export interface MonthRange {
  days: number;
  /** First day of the following month (exclusive upper bound). */
  endExclusive: string;
  month: string;
  /** First day of the month. */
  start: string;
}

export function monthRange(month: string): MonthRange {
  if (!isIsoMonth(month)) {
    throw new RangeError(`Invalid ISO month: ${String(month)}`);
  }
  const start = `${month}-01`;
  const next = new Date(Date.parse(`${start}T00:00:00.000Z`));
  next.setUTCMonth(next.getUTCMonth() + 1);
  const endExclusive = next.toISOString().slice(0, 10);
  return {
    days: daysBetween(start, endExclusive),
    endExclusive,
    month,
    start,
  };
}

// ─── Timezones ──────────────────────────────────────────────────────────────

export function isValidTimeZone(timeZone: unknown): boolean {
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    return false;
  }
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone });
    return formatter.resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

export interface ZonedParts {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) {
    return cached;
  }
  const created = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  formatters.set(timeZone, created);
  return created;
}

/** Wall-clock parts of an instant as seen in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    day: read("day"),
    hour: read("hour") % HOURS_PER_DAY,
    minute: read("minute"),
    month: read("month"),
    second: read("second"),
    year: read("year"),
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** The facility-local calendar date (`YYYY-MM-DD`) at `now`. */
export function todayInZone(now: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(now, timeZone);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Facility-local `HH:MM` at `now`. */
export function timeInZone(now: Date, timeZone: string): string {
  const { hour, minute } = zonedParts(now, timeZone);
  return `${pad(hour, 2)}:${pad(minute, 2)}`;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (positive east of UTC). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const { year, month, day, hour, minute, second } = zonedParts(
    instant,
    timeZone
  );
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const instantSeconds =
    Math.floor(instant.getTime() / MS_PER_SECOND) * MS_PER_SECOND;
  return wallAsUtc - instantSeconds;
}

/**
 * The UTC instant at which `timeZone`'s wall clock reads `date` `time`.
 *
 * Two-pass offset resolution, so it is right on both sides of a DST change.
 * A wall time that does not exist (spring-forward gap) resolves to the nearest
 * real instant, and an ambiguous one (fall-back overlap) to the earlier of the
 * two — either way a "fires once per local day" job still fires exactly once.
 */
export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string
): Date {
  if (!(isIsoDate(date) && isTimeOfDay(time))) {
    throw new RangeError(`Invalid local date/time: ${date} ${time}`);
  }
  const [hour, minute] = time.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
  const corrected = wallAsUtc - zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(corrected);
}

/** The UTC instant of facility-local midnight at the start of `date`. */
export function startOfDayUtc(date: string, timeZone: string): Date {
  return zonedDateTimeToUtc(date, "00:00", timeZone);
}

export interface UtcRange {
  /** Exclusive. */
  endUtc: string;
  startUtc: string;
}

/**
 * ISO-UTC bounds of a facility-local month, for filtering event timestamps
 * (`dispensed_at`, `at`, …) so "November" means November in the clinic, not in UTC.
 * Use as `at >= startUtc AND at < endUtc`.
 */
export function utcRangeForMonth(month: string, timeZone: string): UtcRange {
  const { start, endExclusive } = monthRange(month);
  return {
    endUtc: startOfDayUtc(endExclusive, timeZone).toISOString(),
    startUtc: startOfDayUtc(start, timeZone).toISOString(),
  };
}

/** The facility-local date an ISO-UTC timestamp falls on. */
export function localDateOf(isoTimestamp: string, timeZone: string): string {
  return todayInZone(new Date(isoTimestamp), timeZone);
}
