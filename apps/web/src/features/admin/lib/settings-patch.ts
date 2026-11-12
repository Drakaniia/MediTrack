import type { AppSettings, SettingsPatch } from "@shared/settings";

/**
 * `PUT /api/settings` takes a PATCH-style body, and the audit log records what it
 * changed. So the SPA sends only the fields that differ from what the server
 * last returned: saving an untouched form sends nothing at all.
 */

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The keys of `next` whose value differs from `base`, or `undefined` when none do. */
function changedKeys<T extends object>(
  base: T,
  next: T
): Partial<T> | undefined {
  const changed: Partial<T> = {};
  let any = false;
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (!Object.is(base[key], next[key])) {
      changed[key] = next[key];
      any = true;
    }
  }
  return any ? changed : undefined;
}

function digestChanges(
  base: AppSettings["digest"],
  next: AppSettings["digest"]
): SettingsPatch["digest"] {
  const changes: NonNullable<SettingsPatch["digest"]> = {};
  if (!sameList(base.recipients, next.recipients)) {
    changes.recipients = [...next.recipients];
  }
  if (base.skipWhenQuiet !== next.skipWhenQuiet) {
    changes.skipWhenQuiet = next.skipWhenQuiet;
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}

/** The smallest `SettingsPatch` that turns `base` into `next` (`{}` when they are equal). */
export function buildSettingsPatch(
  base: AppSettings,
  next: AppSettings
): SettingsPatch {
  const patch: SettingsPatch = {};
  const alerts = changedKeys(base.alerts, next.alerts);
  if (alerts) {
    patch.alerts = alerts;
  }
  const digest = digestChanges(base.digest, next.digest);
  if (digest) {
    patch.digest = digest;
  }
  const expiry = changedKeys(base.expiry, next.expiry);
  if (expiry) {
    patch.expiry = expiry;
  }
  const facility = changedKeys(base.facility, next.facility);
  if (facility) {
    patch.facility = facility;
  }
  const schedule = changedKeys(base.schedule, next.schedule);
  if (schedule) {
    patch.schedule = schedule;
  }
  return patch;
}

export function isEmptyPatch(patch: SettingsPatch): boolean {
  return Object.keys(patch).length === 0;
}
