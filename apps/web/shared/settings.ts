/**
 * Facility settings (spec §7.10): one typed object, stored as flat key → JSON rows
 * in the `settings` table. Defaults live here, in code, so a fresh database needs
 * no seed rows and a missing/corrupt row falls back to a sane value.
 *
 * Shared by the API (validation + persistence), the cron Worker (schedule,
 * thresholds, digest recipients) and the SPA (settings form).
 */

import { z } from "zod";

import { isTimeOfDay, isValidTimeZone } from "./dates";
import {
  DEFAULT_EXPIRY_THRESHOLDS,
  type ExpiryThresholds,
  validateThresholds,
} from "./expiry";

export interface AppSettings {
  alerts: {
    /** Daily email digest to `digest.recipients`. */
    emailDigest: boolean;
    /** In-app notification centre + dashboard banner. */
    inApp: boolean;
    /** Browser push to subscribed devices. */
    push: boolean;
  };
  digest: {
    /** Verified Cloudflare Email addresses only (free tier). Max 50. */
    recipients: string[];
    /** Do not send the digest on days with no new transitions (spec §7.6). */
    skipWhenQuiet: boolean;
  };
  expiry: ExpiryThresholds;
  facility: {
    name: string;
    /** IANA zone, e.g. `Asia/Manila`. Drives "today", month boundaries and the schedule. */
    timezone: string;
  };
  schedule: {
    /** Facility-local `HH:MM` the daily alert/push/digest run happens at. */
    dailyTime: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  alerts: { emailDigest: false, inApp: true, push: true },
  digest: { recipients: [], skipWhenQuiet: true },
  expiry: { ...DEFAULT_EXPIRY_THRESHOLDS },
  facility: { name: "MediTract", timezone: "Asia/Manila" },
  schedule: { dailyTime: "06:00" },
};

export const MAX_DIGEST_RECIPIENTS = 50;
export const MAX_FACILITY_NAME_LENGTH = 80;

/** The flat keys used in the `settings` table, in a stable order. */
export const SETTING_KEYS = [
  "alerts.emailDigest",
  "alerts.inApp",
  "alerts.push",
  "digest.recipients",
  "digest.skipWhenQuiet",
  "expiry.nearDays",
  "expiry.urgentDays",
  "facility.name",
  "facility.timezone",
  "schedule.dailyTime",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** The subset of settings every signed-in role may read (sent with `/api/auth/me`). */
export interface PublicSettings {
  facilityName: string;
  nearDays: number;
  timezone: string;
  urgentDays: number;
}

export function toPublicSettings(settings: AppSettings): PublicSettings {
  return {
    facilityName: settings.facility.name,
    nearDays: settings.expiry.nearDays,
    timezone: settings.facility.timezone,
    urgentDays: settings.expiry.urgentDays,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

const timeOfDay = z
  .string()
  .refine(isTimeOfDay, { message: "Use HH:MM, 24-hour." });

const timeZone = z
  .string()
  .refine(isValidTimeZone, { message: "Unknown timezone." });

/** `PATCH`-style body for `PUT /api/settings`: every group and field is optional. */
export const settingsPatchSchema = z.strictObject({
  alerts: z
    .strictObject({
      emailDigest: z.boolean().optional(),
      inApp: z.boolean().optional(),
      push: z.boolean().optional(),
    })
    .optional(),
  digest: z
    .strictObject({
      recipients: z
        .array(z.email().max(254))
        .max(MAX_DIGEST_RECIPIENTS)
        .optional(),
      skipWhenQuiet: z.boolean().optional(),
    })
    .optional(),
  expiry: z
    .strictObject({
      nearDays: z.number().int().optional(),
      urgentDays: z.number().int().optional(),
    })
    .optional(),
  facility: z
    .strictObject({
      name: z.string().trim().min(1).max(MAX_FACILITY_NAME_LENGTH).optional(),
      timezone: timeZone.optional(),
    })
    .optional(),
  schedule: z.strictObject({ dailyTime: timeOfDay.optional() }).optional(),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Applies a patch on top of `base` without mutating either. */
export function mergeSettings(
  base: AppSettings,
  patch: SettingsPatch
): AppSettings {
  return {
    alerts: { ...base.alerts, ...patch.alerts },
    digest: {
      recipients: patch.digest?.recipients
        ? dedupeEmails(patch.digest.recipients)
        : base.digest.recipients,
      skipWhenQuiet: patch.digest?.skipWhenQuiet ?? base.digest.skipWhenQuiet,
    },
    expiry: {
      nearDays: patch.expiry?.nearDays ?? base.expiry.nearDays,
      urgentDays: patch.expiry?.urgentDays ?? base.expiry.urgentDays,
    },
    facility: {
      name: patch.facility?.name ?? base.facility.name,
      timezone: patch.facility?.timezone ?? base.facility.timezone,
    },
    schedule: {
      dailyTime: patch.schedule?.dailyTime ?? base.schedule.dailyTime,
    },
  };
}

/** Cross-field checks a per-field schema cannot express. Empty array = valid. */
export function validateSettings(settings: AppSettings): string[] {
  const problems: string[] = [];
  const thresholds = validateThresholds(settings.expiry);
  if (!thresholds.ok) {
    problems.push(thresholds.message);
  }
  if (!isValidTimeZone(settings.facility.timezone)) {
    problems.push("Unknown timezone.");
  }
  if (!isTimeOfDay(settings.schedule.dailyTime)) {
    problems.push("Daily run time must be HH:MM.");
  }
  if (settings.alerts.emailDigest && settings.digest.recipients.length === 0) {
    problems.push("Add at least one recipient to enable the email digest.");
  }
  return problems;
}

function dedupeEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of emails) {
    const key = email.trim().toLowerCase();
    if (key !== "" && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

// ─── Row mapping ────────────────────────────────────────────────────────────

/** Flat `key → JSON text` rows for every setting (what `PUT` persists). */
export function flattenSettings(
  settings: AppSettings
): Record<SettingKey, string> {
  return {
    "alerts.emailDigest": JSON.stringify(settings.alerts.emailDigest),
    "alerts.inApp": JSON.stringify(settings.alerts.inApp),
    "alerts.push": JSON.stringify(settings.alerts.push),
    "digest.recipients": JSON.stringify(settings.digest.recipients),
    "digest.skipWhenQuiet": JSON.stringify(settings.digest.skipWhenQuiet),
    "expiry.nearDays": JSON.stringify(settings.expiry.nearDays),
    "expiry.urgentDays": JSON.stringify(settings.expiry.urgentDays),
    "facility.name": JSON.stringify(settings.facility.name),
    "facility.timezone": JSON.stringify(settings.facility.timezone),
    "schedule.dailyTime": JSON.stringify(settings.schedule.dailyTime),
  };
}

function parseStored(raw: string | undefined): unknown {
  if (raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function pickBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function pickInt(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isInteger(raw) ? raw : fallback;
}

/**
 * Builds settings from `settings` table rows (`key → JSON text`). Every field
 * falls back to its default when the row is missing, unparseable or the wrong
 * type, and the threshold pair falls back TOGETHER if it fails validation — a
 * half-corrupt pair must never make `urgent ≥ near` reachable.
 */
export function inflateSettings(
  rows: Readonly<Record<string, string>>
): AppSettings {
  const d = DEFAULT_SETTINGS;
  const stored = (key: SettingKey): unknown => parseStored(rows[key]);

  const name = stored("facility.name");
  const zone = stored("facility.timezone");
  const time = stored("schedule.dailyTime");
  const recipients = stored("digest.recipients");

  const expiry: ExpiryThresholds = {
    nearDays: pickInt(stored("expiry.nearDays"), d.expiry.nearDays),
    urgentDays: pickInt(stored("expiry.urgentDays"), d.expiry.urgentDays),
  };

  return {
    alerts: {
      emailDigest: pickBoolean(
        stored("alerts.emailDigest"),
        d.alerts.emailDigest
      ),
      inApp: pickBoolean(stored("alerts.inApp"), d.alerts.inApp),
      push: pickBoolean(stored("alerts.push"), d.alerts.push),
    },
    digest: {
      recipients: Array.isArray(recipients)
        ? dedupeEmails(
            recipients.filter(
              (entry): entry is string => typeof entry === "string"
            )
          ).slice(0, MAX_DIGEST_RECIPIENTS)
        : [],
      skipWhenQuiet: pickBoolean(
        stored("digest.skipWhenQuiet"),
        d.digest.skipWhenQuiet
      ),
    },
    expiry: validateThresholds(expiry).ok ? expiry : { ...d.expiry },
    facility: {
      name:
        typeof name === "string" && name.trim() !== ""
          ? name.trim().slice(0, MAX_FACILITY_NAME_LENGTH)
          : d.facility.name,
      timezone:
        typeof zone === "string" && isValidTimeZone(zone)
          ? zone
          : d.facility.timezone,
    },
    schedule: {
      dailyTime:
        typeof time === "string" && isTimeOfDay(time)
          ? time
          : d.schedule.dailyTime,
    },
  };
}
