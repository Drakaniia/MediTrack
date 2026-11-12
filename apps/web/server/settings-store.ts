/**
 * Persistence for facility settings (spec §7.10).
 *
 * The `settings` table is a flat `key → JSON text` store; defaults and validation live in
 * `shared/settings.ts`. Reads inflate whatever rows exist over the defaults (a fresh
 * database needs no seed rows, a corrupt row falls back to its default). Writes upsert only
 * the keys that actually changed, so the audit row and `updated_at` describe real edits.
 */

import {
  type AppSettings,
  flattenSettings,
  inflateSettings,
  SETTING_KEYS,
  type SettingKey,
} from "../shared/settings";
import type { D1DatabaseLike, D1PreparedStatement } from "./env";

export interface SettingsWriteOptions {
  /** The editing user; `settings.updated_by` references `users.id`. */
  actorId: string | null;
  now: Date;
}

export interface SettingsChange {
  after: Record<string, unknown>;
  before: Record<string, unknown>;
  keys: SettingKey[];
}

export async function loadSettings(db: D1DatabaseLike): Promise<AppSettings> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings")
    .all<{ key: string; value: string }>();
  const rows: Record<string, string> = {};
  for (const row of results) {
    rows[row.key] = row.value;
  }
  return inflateSettings(rows);
}

/** Setting keys whose stored value differs between the two snapshots. */
export function changedSettingKeys(
  next: AppSettings,
  previous: AppSettings
): SettingKey[] {
  const nextRows = flattenSettings(next);
  const previousRows = flattenSettings(previous);
  return SETTING_KEYS.filter((key) => nextRows[key] !== previousRows[key]);
}

/** Flat before/after maps of just the changed keys, ready for an audit row. */
export function describeSettingsChange(
  next: AppSettings,
  previous: AppSettings
): SettingsChange {
  const nextRows = flattenSettings(next);
  const previousRows = flattenSettings(previous);
  const keys = changedSettingKeys(next, previous);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of keys) {
    before[key] = JSON.parse(previousRows[key]);
    after[key] = JSON.parse(nextRows[key]);
  }
  return { after, before, keys };
}

/** One upsert per changed key. An empty array means nothing needs writing. */
export function settingsWriteStatements(
  db: D1DatabaseLike,
  next: AppSettings,
  previous: AppSettings,
  options: SettingsWriteOptions
): D1PreparedStatement[] {
  const rows = flattenSettings(next);
  const at = options.now.toISOString();
  return changedSettingKeys(next, previous).map((key) =>
    db
      .prepare(
        "INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
      )
      .bind(key, rows[key], at, options.actorId)
  );
}
