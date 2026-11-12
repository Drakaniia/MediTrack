import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, mergeSettings } from "../shared/settings";
import { createMigratedD1, type FakeD1 } from "../test/harness";
import {
  changedSettingKeys,
  describeSettingsChange,
  loadSettings,
  settingsWriteStatements,
} from "./settings-store";

const T0 = new Date("2026-11-12T02:00:00.000Z");
const T1 = new Date("2026-11-12T03:00:00.000Z");

interface SettingRow {
  key: string;
  updated_at: string;
  updated_by: string | null;
  value: string;
}

function rows(db: FakeD1): SettingRow[] {
  return db.sqlite
    .prepare("SELECT * FROM settings ORDER BY key")
    .all() as unknown as SettingRow[];
}

function insertUser(db: FakeD1, id: string): void {
  db.sqlite
    .prepare(
      "INSERT INTO users (id, username, username_lower, display_name, role, password_hash) VALUES (?, ?, ?, 'Admin', 'admin', 'x')"
    )
    .run(id, id, id);
}

async function save(
  db: FakeD1,
  patch: Parameters<typeof mergeSettings>[1],
  now: Date,
  actorId: string | null
): Promise<void> {
  const previous = await loadSettings(db);
  const next = mergeSettings(previous, patch);
  await db.batch(settingsWriteStatements(db, next, previous, { actorId, now }));
}

describe("loadSettings", () => {
  it("returns the defaults for an empty table", async () => {
    const db = createMigratedD1();
    expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back per field when a row is corrupt", async () => {
    const db = createMigratedD1();
    db.sqlite.exec(
      [
        "INSERT INTO settings (key, value, updated_at) VALUES ('facility.name', '\"Clinic Rosa\"', '2026-01-01T00:00:00.000Z')",
        "INSERT INTO settings (key, value, updated_at) VALUES ('facility.timezone', 'not json', '2026-01-01T00:00:00.000Z')",
        "INSERT INTO settings (key, value, updated_at) VALUES ('expiry.nearDays', '5', '2026-01-01T00:00:00.000Z')",
        "INSERT INTO settings (key, value, updated_at) VALUES ('expiry.urgentDays', '9', '2026-01-01T00:00:00.000Z')",
      ].join(";")
    );
    const settings = await loadSettings(db);
    expect(settings.facility).toEqual({
      name: "Clinic Rosa",
      timezone: DEFAULT_SETTINGS.facility.timezone,
    });
    // urgent (9) >= near (5): the pair falls back together.
    expect(settings.expiry).toEqual(DEFAULT_SETTINGS.expiry);
  });
});

describe("settingsWriteStatements", () => {
  it("writes nothing when nothing changed", () => {
    const db = createMigratedD1();
    expect(
      settingsWriteStatements(db, DEFAULT_SETTINGS, DEFAULT_SETTINGS, {
        actorId: null,
        now: T0,
      })
    ).toEqual([]);
    expect(changedSettingKeys(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual([]);
  });

  it("upserts only the keys that changed and round-trips", async () => {
    const db = createMigratedD1();
    insertUser(db, "admin-1");
    await save(
      db,
      { expiry: { urgentDays: 10 }, facility: { name: "Clinic Rosa" } },
      T0,
      "admin-1"
    );

    expect(rows(db)).toEqual([
      {
        key: "expiry.urgentDays",
        updated_at: T0.toISOString(),
        updated_by: "admin-1",
        value: "10",
      },
      {
        key: "facility.name",
        updated_at: T0.toISOString(),
        updated_by: "admin-1",
        value: '"Clinic Rosa"',
      },
    ]);
    const loaded = await loadSettings(db);
    expect(loaded.expiry).toEqual({ nearDays: 30, urgentDays: 10 });
    expect(loaded.facility.name).toBe("Clinic Rosa");
  });

  it("touches only the changed key on later saves", async () => {
    const db = createMigratedD1();
    insertUser(db, "admin-1");
    await save(db, { facility: { name: "First" } }, T0, "admin-1");
    await save(db, { alerts: { push: false } }, T1, "admin-1");
    await save(db, { facility: { name: "Second" } }, T1, null);

    const byKey = Object.fromEntries(rows(db).map((row) => [row.key, row]));
    expect(byKey["alerts.push"]).toMatchObject({
      updated_at: T1.toISOString(),
      value: "false",
    });
    expect(byKey["facility.name"]).toMatchObject({
      updated_at: T1.toISOString(),
      updated_by: null,
      value: '"Second"',
    });
    expect(rows(db)).toHaveLength(2);
  });

  it("refuses an editor that is not a user (foreign key)", async () => {
    const db = createMigratedD1();
    await expect(
      save(db, { facility: { name: "X" } }, T0, "ghost")
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("describeSettingsChange", () => {
  it("lists the changed keys with their before and after values", () => {
    const next = mergeSettings(DEFAULT_SETTINGS, {
      digest: { recipients: ["a@example.com"] },
      expiry: { nearDays: 60, urgentDays: 14 },
    });
    expect(describeSettingsChange(next, DEFAULT_SETTINGS)).toEqual({
      after: {
        "digest.recipients": ["a@example.com"],
        "expiry.nearDays": 60,
        "expiry.urgentDays": 14,
      },
      before: {
        "digest.recipients": [],
        "expiry.nearDays": 30,
        "expiry.urgentDays": 7,
      },
      keys: ["digest.recipients", "expiry.nearDays", "expiry.urgentDays"],
    });
  });
});
