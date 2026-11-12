/**
 * Calendar and timezone arithmetic for the seed scripts.
 *
 * A plain-ESM mirror of the parts of `apps/web/shared/dates.ts` the seeds need, so bare
 * `node` can run them (no TypeScript imports). The tests compare the results with the real
 * shared module, so the two cannot drift silently.
 */

import { SeedError } from "./errors.mjs";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const RELATIVE_AT = /^([+-]?\d{1,4})d (\d{2}):(\d{2})$/u;
const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const HOURS_PER_DAY = 24;
const MIN_YEAR = 1900;
const MAX_MINUTE = 59;

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isIsoDate(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
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

/** @param {string} iso */
function utcMsOfDate(iso) {
  if (!isIsoDate(iso)) {
    throw new SeedError(`Invalid ISO date: ${String(iso)}`);
  }
  return Date.parse(`${iso}T00:00:00.000Z`);
}

/**
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function addDays(iso, days) {
  return new Date(utcMsOfDate(iso) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/**
 * @param {string} fromIso
 * @param {string} toIso
 * @returns {number}
 */
export function daysBetween(fromIso, toIso) {
  return Math.round((utcMsOfDate(toIso) - utcMsOfDate(fromIso)) / MS_PER_DAY);
}

/**
 * @param {unknown} timeZone
 * @returns {boolean}
 */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    return false;
  }
  try {
    const resolved = new Intl.DateTimeFormat("en-US", {
      timeZone,
    }).resolvedOptions();
    return resolved.timeZone !== "";
  } catch {
    return false;
  }
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

/** @param {string} timeZone */
function formatterFor(timeZone) {
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

/**
 * @param {Date} instant
 * @param {string} timeZone
 */
function zonedParts(instant, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(instant);
  /** @param {string} type */
  const read = (type) => {
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

/**
 * @param {number} value
 * @param {number} width
 */
function pad(value, width) {
  return String(value).padStart(width, "0");
}

/**
 * The facility-local calendar date at `now`.
 * @param {Date} now
 * @param {string} timeZone
 * @returns {string}
 */
export function todayInZone(now, timeZone) {
  const { year, month, day } = zonedParts(now, timeZone);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * @param {Date} instant
 * @param {string} timeZone
 */
function zoneOffsetMs(instant, timeZone) {
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
 * The UTC instant at which `timeZone`'s wall clock reads `date` `HH:MM`.
 * @param {string} date
 * @param {string} time
 * @param {string} timeZone
 * @returns {Date}
 */
export function zonedDateTimeToUtc(date, time, timeZone) {
  const [hour, minute] = time.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
  const corrected = wallAsUtc - zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(corrected);
}

/**
 * A relative moment such as `-3d 09:30` (three facility-local days before `today`, 09:30 local)
 * as an ISO-UTC timestamp with milliseconds.
 * @param {string} spec
 * @param {string} today
 * @param {string} timeZone
 * @returns {{ date: string, iso: string, offset: number }}
 */
export function resolveRelativeMoment(spec, today, timeZone) {
  const match = RELATIVE_AT.exec(spec);
  if (!match) {
    throw new SeedError(
      `Bad relative time "${spec}": expected e.g. "-3d 09:30" (days from today, local time).`
    );
  }
  const offset = Number(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour >= HOURS_PER_DAY || minute > MAX_MINUTE) {
    throw new SeedError(`Bad time of day in "${spec}".`);
  }
  const date = addDays(today, offset);
  const time = `${pad(hour, 2)}:${pad(minute, 2)}`;
  return {
    date,
    iso: zonedDateTimeToUtc(date, time, timeZone).toISOString(),
    offset,
  };
}

/**
 * ISO-UTC timestamp of facility-local `date` at `HH:MM`, plus whole minutes.
 * @param {string} date
 * @param {string} time
 * @param {string} timeZone
 * @param {number} [plusMinutes]
 * @returns {string}
 */
export function localMoment(date, time, timeZone, plusMinutes = 0) {
  const base = zonedDateTimeToUtc(date, time, timeZone).getTime();
  return new Date(base + plusMinutes * MS_PER_MINUTE).toISOString();
}
