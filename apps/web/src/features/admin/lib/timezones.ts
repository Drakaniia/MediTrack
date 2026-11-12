import { zoneOffsetMs } from "@shared/dates";

import { formatDateTime } from "@/lib/format";

export const MAX_TIMEZONE_RESULTS = 60;

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const SEPARATORS = /[/_\s]+/;

function supportedZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

/** Every IANA zone the browser knows (plus `UTC` and any `extra` ones), sorted. */
export function listTimeZones(extra: readonly string[] = []): string[] {
  return [...new Set([...supportedZones(), "UTC", ...extra])].sort();
}

function normalize(text: string): string {
  return text.toLowerCase().split(SEPARATORS).join(" ").trim();
}

/**
 * Zones matching every word of `query` (`"new york"` finds `America/New_York`;
 * `"manila"` finds `Asia/Manila`). An empty query returns the first `limit` zones.
 */
export function filterTimeZones(
  zones: readonly string[],
  query: string,
  limit: number = MAX_TIMEZONE_RESULTS
): string[] {
  const words = normalize(query).split(" ").filter(Boolean);
  const matches: string[] = [];
  for (const zone of zones) {
    const haystack = normalize(zone);
    if (words.every((word) => haystack.includes(word))) {
      matches.push(zone);
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return matches;
}

/** `UTC+08:00`, `UTC-05:00`, `UTC+00:00`. */
export function formatUtcOffset(instant: Date, timeZone: string): string {
  const minutes = Math.round(zoneOffsetMs(instant, timeZone) / MS_PER_MINUTE);
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / MINUTES_PER_HOUR)).padStart(
    2,
    "0"
  );
  const rest = String(absolute % MINUTES_PER_HOUR).padStart(2, "0");
  return `UTC${sign}${hours}:${rest}`;
}

/** "12 Nov 2026, 14:32 · UTC+08:00": what the clock on the wall of that facility reads now. */
export function localTimePreview(instant: Date, timeZone: string): string {
  return `${formatDateTime(instant.toISOString(), timeZone)} · ${formatUtcOffset(instant, timeZone)}`;
}
