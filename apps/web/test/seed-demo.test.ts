/**
 * `pnpm web:seed-demo`: the demo dataset (`apps/web/demo/demo-data.json`) turned into SQL by
 * `scripts/web-seed/*.mjs` and applied to the REAL schema (SQLite, foreign keys on, append-only
 * audit triggers). The expectations use the shared domain code (`shared/expiry`, `fefo`,
 * `low-stock`) rather than the seed's own helpers, so the demo cannot drift from the app's rules.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import * as sharedDates from "../shared/dates";
import { DEFAULT_PASSWORD_ITERATIONS, verifyPassword } from "../server/auth/password";
import {
  addDays as seedAddDays,
  daysBetween as seedDaysBetween,
  resolveRelativeMoment,
  todayInZone as seedTodayInZone,
  zonedDateTimeToUtc as seedZonedDateTimeToUtc,
} from "../../../scripts/web-seed/dates.mjs";
import { buildDemoPlan, type DemoPlan, type Row } from "../../../scripts/web-seed/demo-plan.mjs";
import { buildDemoSql, WIPE_STATEMENTS } from "../../../scripts/web-seed/demo-sql.mjs";
import { formatDemoSummary } from "../../../scripts/web-seed/demo-summary.mjs";
import {
  type DemoOptions,
  isProductionTarget,
  parseDemoArgs,
  resolveDemoTarget,
} from "../../../scripts/web-seed/demo-target.mjs";
import { isBatchCode } from "../shared/batch-code";
import { addDays, localDateOf } from "../shared/dates";
import {
  assessExpiry,
  classBoundaries,
  type ExpiryClass,
  expiryClassCase,
} from "../shared/expiry";
import {
  compareFefo,
  FEFO_ORDER_SQL,
  type FefoBatchLike,
  fefoOrder,
  isQuarantined,
} from "../shared/fefo";
import { classifyLowStock } from "../shared/low-stock";
import { createTestApp } from "./app";
import { createMigratedD1 } from "./harness";

const TIME_ZONE = "Asia/Manila";
const TODAY = "2026-11-12";
const FAST = 1000;
const DEMO_PASSWORD = "Demo-Password-2026";
const SCRIPT = join(import.meta.dirname, "..", "..", "..", "scripts", "web-seed-demo.mjs");
const DATASET = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "demo", "demo-data.json"), "utf8")
) as Record<string, unknown>;

/** Dates that stress month, year and leap-day boundaries. */
const BASE_DATES = ["2026-11-12", "2027-01-01", "2028-02-29", "2026-03-31"];

const planCache = new Map<string, DemoPlan>();

function planFor(today: string, timeZone = TIME_ZONE): DemoPlan {
  const key = `${today}|${timeZone}`;
  const cached = planCache.get(key);
  if (cached) {
    return cached;
  }
  const plan = buildDemoPlan(DATASET, { iterations: FAST, timeZone, today });
  planCache.set(key, plan);
  return plan;
}

function seed(sqlite: DatabaseSync, plan: DemoPlan): void {
  sqlite.exec(buildDemoSql(plan));
}

function seeded(today = TODAY, timeZone = TIME_ZONE) {
  const db = createMigratedD1();
  const plan = planFor(today, timeZone);
  seed(db.sqlite, plan);
  return { plan, sqlite: db.sqlite };
}

function all<T = Record<string, unknown>>(
  sqlite: DatabaseSync,
  sql: string,
  ...params: (string | number)[]
): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}

function count(sqlite: DatabaseSync, table: string): number {
  return (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

interface BatchRow {
  batch_number: string;
  deleted_at: string | null;
  expiry: string | null;
  id: string;
  initial_qty: number;
  item_id: string;
  qty: number;
  received_on: string;
  status: "active" | "disposed";
}

function liveBatches(sqlite: DatabaseSync): BatchRow[] {
  return all<BatchRow>(
    sqlite,
    "SELECT * FROM batches WHERE deleted_at IS NULL AND status = 'active' AND qty > 0"
  );
}

function dump(sqlite: DatabaseSync): string {
  const tables = [
    "categories",
    "items",
    "batches",
    "stock_movements",
    "requests",
    "request_events",
    "dispensing_records",
    "dispensing_lines",
    "disposals",
    "notifications",
    "notification_state",
    "alert_state",
    "low_stock_state",
    "counters",
    "users",
  ];
  return JSON.stringify(
    tables.map((table) => all(sqlite, `SELECT * FROM ${table} ORDER BY 1, 2`))
  );
}

describe("demo seed: applying", () => {
  it("applies cleanly to a migrated database with foreign keys on", () => {
    const { plan, sqlite } = seeded();
    expect(all(sqlite, "PRAGMA foreign_key_check")).toEqual([]);
    expect(count(sqlite, "items")).toBe(plan.summary.counts.items);
    expect(count(sqlite, "batches")).toBe(plan.summary.counts.batches);
    expect(count(sqlite, "stock_movements")).toBe(plan.summary.counts.movements);
    expect(count(sqlite, "requests")).toBe(plan.summary.counts.requests);
    expect(count(sqlite, "dispensing_records")).toBe(plan.summary.counts.dispensingRecords);
    expect(count(sqlite, "notifications")).toBe(plan.summary.counts.notifications);
    expect(count(sqlite, "users")).toBe(5);
  });

  it("has the advertised size", () => {
    const { counts } = planFor(TODAY).summary;
    expect(counts.items).toBeGreaterThanOrEqual(26);
    expect(counts.items).toBeLessThanOrEqual(30);
    expect(counts.batches).toBeGreaterThanOrEqual(50);
    expect(counts.dispensingRecords).toBeGreaterThanOrEqual(25);
  });

  it("is idempotent: a rerun leaves identical data and no extra audit rows", () => {
    const { plan, sqlite } = seeded();
    const before = dump(sqlite);
    const auditBefore = count(sqlite, "audit_log");
    seed(sqlite, plan);
    expect(dump(sqlite)).toBe(before);
    expect(count(sqlite, "audit_log")).toBe(auditBefore);
  });

  it("a rerun for another date replaces the data and only appends audit rows", () => {
    const { sqlite } = seeded("2026-11-12");
    const auditBefore = count(sqlite, "audit_log");
    seed(sqlite, planFor("2026-12-20"));
    expect(count(sqlite, "batches")).toBe(planFor("2026-12-20").summary.counts.batches);
    expect(count(sqlite, "audit_log")).toBeGreaterThan(auditBefore);
    expect(all(sqlite, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("uses the same ids and batch codes for every base date", () => {
    const first = planFor("2026-11-12").tables.batches;
    const second = planFor("2028-02-29").tables.batches;
    expect(second.map((row) => [row.id, row.code])).toEqual(
      first.map((row) => [row.id, row.code])
    );
    const codes = first.map((row) => String(row.code));
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => isBatchCode(code))).toBe(true);
  });

  it("never deletes from or rewrites audit_log (it is append-only)", () => {
    const db = createMigratedD1();
    db.sqlite
      .prepare("INSERT INTO audit_log (at, actor_name, action, entity_type, summary) VALUES (?, 'x', 'user.create', 'user', 'kept')")
      .run("2026-01-01T00:00:00.000Z");
    const sql = buildDemoSql(planFor(TODAY));
    expect(sql).not.toMatch(/DELETE FROM audit_log|UPDATE audit_log|DROP /i);
    seed(db.sqlite, planFor(TODAY));
    expect(all(db.sqlite, "SELECT summary FROM audit_log WHERE summary = 'kept'")).toHaveLength(1);
    expect(planFor(TODAY).tables.audit_log.length).toBeGreaterThanOrEqual(5);
  });

  it("replaces inventory data but keeps other users, sessions and settings", () => {
    const db = createMigratedD1();
    const { sqlite } = db;
    const now = "2026-11-01T00:00:00.000Z";
    sqlite
      .prepare("INSERT INTO users (id, username, username_lower, display_name, role, password_hash) VALUES ('real-1', 'maria', 'maria', 'Maria', 'admin', 'pbkdf2-sha256$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')")
      .run();
    sqlite
      .prepare("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES ('sess', 'real-1', ?, ?, ?, ?)")
      .run(now, now, now, now);
    sqlite
      .prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('facility.name', '\"Clinic\"', ?, 'real-1')")
      .run(now);
    sqlite.prepare("INSERT INTO categories (id, name, name_lower) VALUES ('c-old', 'Old', 'old')").run();
    sqlite.prepare("INSERT INTO items (id, name, category_id) VALUES ('i-old', 'Old item', 'c-old')").run();
    sqlite
      .prepare("INSERT INTO batches (id, item_id, code, batch_number, batch_number_lower, qty, initial_qty, received_on) VALUES ('b-old', 'i-old', '0000000000', 'X', 'x', 1, 1, '2026-01-01')")
      .run();
    sqlite.prepare("INSERT INTO counters (name, value) VALUES ('request:2026', 99), ('other', 7)").run();

    seed(sqlite, planFor(TODAY));

    expect(all(sqlite, "SELECT id FROM items WHERE id = 'i-old'")).toEqual([]);
    expect(all(sqlite, "SELECT id FROM categories WHERE id = 'c-old'")).toEqual([]);
    expect(all(sqlite, "SELECT id FROM users WHERE id = 'real-1'")).toHaveLength(1);
    expect(count(sqlite, "sessions")).toBe(1);
    expect(all(sqlite, "SELECT value FROM settings WHERE key = 'facility.name'")).toEqual([{ value: '"Clinic"' }]);
    expect(all(sqlite, "SELECT value FROM counters WHERE name = 'other'")).toEqual([{ value: 7 }]);
    const counter = all<{ value: number }>(sqlite, "SELECT value FROM counters WHERE name = 'request:2026'");
    expect(counter[0].value).toBe(planFor(TODAY).summary.counts.requests);
  });

  it("wipes only demo-managed tables", () => {
    const touched = WIPE_STATEMENTS.map((statement) => /FROM (\w+)/.exec(statement)?.[1]);
    expect(touched).not.toContain("users");
    expect(touched).not.toContain("sessions");
    expect(touched).not.toContain("settings");
    expect(touched).not.toContain("audit_log");
  });
});

describe("demo seed: expiry classes", () => {
  it.each(BASE_DATES)("populates every class on %s, as the shared rules and the SQL CASE see it", (today) => {
    const { plan, sqlite } = seeded(today);
    const { thresholds } = plan;
    const byClass: Record<ExpiryClass, number> = { expired: 0, near_expiry: 0, safe: 0, urgent: 0 };
    const daysSeen = new Set<number>();
    for (const batch of liveBatches(sqlite)) {
      const { daysUntil, expiryClass } = assessExpiry(batch.expiry, today, thresholds);
      byClass[expiryClass] += 1;
      if (daysUntil !== null) {
        daysSeen.add(daysUntil);
      }
    }
    for (const expiryClass of Object.keys(byClass) as ExpiryClass[]) {
      expect(byClass[expiryClass], expiryClass).toBeGreaterThan(2);
    }
    // Boundary days: exactly 0, 1, 7 (Urgent), 8 and 30 (Near Expiry), 31 (Safe), -1.. (Expired).
    for (const day of [0, 1, 7, 8, 30, 31]) {
      expect(daysSeen.has(day), `a batch ${day} day(s) from expiry`).toBe(true);
    }
    expect([...daysSeen].some((day) => day < 0)).toBe(true);
    expect(byClass.expired).toBe(plan.summary.batchClasses.expired);
    expect(byClass.urgent).toBe(plan.summary.batchClasses.urgent);
    expect(byClass.near_expiry).toBe(plan.summary.batchClasses.near_expiry);

    const fragment = expiryClassCase("b.expiry", classBoundaries(today, thresholds));
    const grouped = all<{ cls: ExpiryClass; n: number }>(
      sqlite,
      `SELECT ${fragment.sql} AS cls, count(*) AS n FROM batches b WHERE b.deleted_at IS NULL AND b.status = 'active' AND b.qty > 0 GROUP BY cls`,
      ...fragment.params
    );
    for (const row of grouped) {
      expect(row.n).toBe(byClass[row.cls]);
    }
  });

  it("holds expired stock in quarantine, with a disposal record for the written-off ones", () => {
    const { plan, sqlite } = seeded();
    const batches = all<BatchRow>(sqlite, "SELECT * FROM batches").map(
      (row): FefoBatchLike & { itemId: string } => ({
        batchNumber: row.batch_number,
        expiry: row.expiry,
        id: row.id,
        itemId: row.item_id,
        qty: row.qty,
        receivedOn: row.received_on,
        status: row.status,
      })
    );
    const quarantined = batches.filter((batch) => isQuarantined(batch, TODAY));
    expect(quarantined.length).toBeGreaterThanOrEqual(3);
    expect(quarantined.length).toBe(plan.summary.quarantine);

    const disposals = all<{ batch_id: string; qty: number; reason: string; batch_number: string }>(
      sqlite,
      "SELECT * FROM disposals"
    );
    expect(disposals.length).toBeGreaterThanOrEqual(2);
    const expiredDisposal = disposals.find((row) => row.reason === "expired");
    expect(expiredDisposal).toBeDefined();
    const batch = all<BatchRow>(sqlite, "SELECT * FROM batches WHERE id = ?", String(expiredDisposal?.batch_id))[0];
    expect(batch).toMatchObject({ qty: 0, status: "disposed" });
    expect(String(batch.expiry) < TODAY).toBe(true);
    const movement = all<{ kind: string; qty_delta: number; qty_after: number }>(
      sqlite,
      "SELECT * FROM stock_movements WHERE kind = 'dispose' AND batch_id = ?",
      batch.id
    );
    expect(movement).toEqual([
      expect.objectContaining({ qty_after: 0, qty_delta: -Number(expiredDisposal?.qty) }),
    ]);
  });

  it("has same-expiry FEFO ties, broken by received date and then batch number", () => {
    const { sqlite } = seeded();
    const rows = all<BatchRow & { item_name: string }>(
      sqlite,
      "SELECT b.*, i.name AS item_name FROM batches b JOIN items i ON i.id = b.item_id"
    );
    const asFefo = (row: BatchRow): FefoBatchLike => ({
      batchNumber: row.batch_number,
      expiry: row.expiry,
      id: row.id,
      qty: row.qty,
      receivedOn: row.received_on,
      status: row.status,
    });
    const byItem = Map.groupBy(rows, (row) => row.item_id);
    let sameDay = 0;
    let sameDayAndReceived = 0;
    for (const batches of byItem.values()) {
      const eligible = fefoOrder(batches.map(asFefo), TODAY);
      for (let index = 1; index < eligible.length; index += 1) {
        const [a, b] = [eligible[index - 1], eligible[index]];
        if (a.expiry !== null && a.expiry === b.expiry) {
          sameDay += 1;
          if (a.receivedOn === b.receivedOn) {
            sameDayAndReceived += 1;
            expect(a.batchNumber.toLowerCase() < b.batchNumber.toLowerCase()).toBe(true);
          } else {
            expect(a.receivedOn < b.receivedOn).toBe(true);
          }
        }
      }
    }
    expect(sameDay).toBeGreaterThanOrEqual(2);
    expect(sameDayAndReceived).toBeGreaterThanOrEqual(1);

    // The SQL ordering the API uses agrees with the pure comparator.
    const cetirizine = all<BatchRow>(
      sqlite,
      `SELECT * FROM batches WHERE item_id = (SELECT id FROM items WHERE name = 'Cetirizine') AND status = 'active' AND qty > 0 ORDER BY ${FEFO_ORDER_SQL}`
    );
    const sorted = [...cetirizine].sort((a, b) =>
      compareFefo(
        { batchNumber: a.batch_number, expiry: a.expiry, id: a.id, receivedOn: a.received_on },
        { batchNumber: b.batch_number, expiry: b.expiry, id: b.id, receivedOn: b.received_on }
      )
    );
    expect(cetirizine.map((row) => row.batch_number)).toEqual(sorted.map((row) => row.batch_number));
    expect(cetirizine.map((row) => row.batch_number).slice(-2)).toEqual(["CTZ-0101", "CTZ-0102"]);
  });

  it("includes a zero-quantity active batch and batches without an expiry date", () => {
    const { sqlite } = seeded();
    expect(
      count(sqlite, "batches WHERE qty = 0 AND status = 'active'")
    ).toBeGreaterThanOrEqual(1);
    const undated = all<{ name: string; has_expiry: number }>(
      sqlite,
      "SELECT i.name, i.has_expiry FROM batches b JOIN items i ON i.id = b.item_id WHERE b.expiry IS NULL"
    );
    expect(undated.length).toBeGreaterThanOrEqual(1);
    expect(undated.every((row) => row.has_expiry === 0)).toBe(true);
    expect(count(sqlite, "items WHERE has_expiry = 0")).toBeGreaterThanOrEqual(2);
  });
});

describe("demo seed: low stock", () => {
  it("has exactly two low items, by the shared classification on AVAILABLE stock", () => {
    const { sqlite } = seeded();
    const stock = all<{ id: string; name: string; threshold: number; available: number; on_hand: number }>(
      sqlite,
      `SELECT i.id, i.name, i.low_stock_threshold AS threshold,
         COALESCE(SUM(CASE WHEN b.status = 'active' AND b.deleted_at IS NULL AND b.qty > 0 AND (b.expiry IS NULL OR b.expiry >= ?) THEN b.qty ELSE 0 END), 0) AS available,
         COALESCE(SUM(CASE WHEN b.status = 'active' AND b.deleted_at IS NULL THEN b.qty ELSE 0 END), 0) AS on_hand
       FROM items i LEFT JOIN batches b ON b.item_id = i.id WHERE i.deleted_at IS NULL GROUP BY i.id`,
      TODAY
    );
    const flagged = stock
      .map((row) => ({ ...row, status: classifyLowStock({ available: row.available, threshold: row.threshold }) }))
      .filter((row) => row.status !== "in_stock");
    expect(flagged.map((row) => `${row.name}:${row.status}`).sort()).toEqual([
      "Loperamide:out",
      "Oral Rehydration Salts:low",
    ]);
    const ors = flagged.find((row) => row.status === "low");
    // Low only because the rest is expired: on hand would have been enough.
    expect(ors?.on_hand).toBeGreaterThanOrEqual(ors?.threshold ?? Number.POSITIVE_INFINITY);
    expect(ors?.available).toBeLessThan(ors?.threshold ?? 0);
    expect(all(sqlite, "SELECT is_low FROM low_stock_state WHERE is_low = 1")).toHaveLength(2);
  });
});

describe("demo seed: requests", () => {
  it("has every status in the specified numbers", () => {
    const { sqlite } = seeded();
    const counts = Object.fromEntries(
      all<{ status: string; n: number }>(sqlite, "SELECT status, count(*) AS n FROM requests GROUP BY status").map(
        (row) => [row.status, row.n]
      )
    );
    expect(counts).toEqual({ approved: 3, cancelled: 1, claimed: 4, denied: 2, pending: 4, ready: 3 });
  });

  it("has the special cases: partial hand-over, quick deduct, denial reasons", () => {
    const { sqlite } = seeded();
    const partial = all<{ qty: number; dispensed_qty: number }>(
      sqlite,
      "SELECT qty, dispensed_qty FROM requests WHERE status = 'ready' AND dispensed_qty > 0"
    );
    expect(partial).toHaveLength(1);
    expect(partial[0].dispensed_qty).toBeLessThan(partial[0].qty);
    expect(count(sqlite, "requests WHERE status = 'claimed' AND source = 'quick_deduct'")).toBe(1);
    const denied = all<{ denied_reason: string; denied_note: string }>(
      sqlite,
      "SELECT denied_reason, denied_note FROM requests WHERE status = 'denied'"
    );
    expect(denied.map((row) => row.denied_reason).sort()).toEqual(["Duplicate Request", "Out of Stock"]);
    expect(denied.every((row) => row.denied_note !== "")).toBe(true);
  });

  it("keeps the event trail consistent with each request", () => {
    const { sqlite } = seeded();
    for (const request of all<{ id: string; status: string; code: string; dispensed_qty: number; qty: number }>(
      sqlite,
      "SELECT * FROM requests"
    )) {
      const events = all<{ from_status: string | null; to_status: string; at: string }>(
        sqlite,
        "SELECT * FROM request_events WHERE request_id = ? ORDER BY at, rowid",
        request.id
      );
      expect(events.length, request.code).toBeGreaterThanOrEqual(1);
      expect(events[0].from_status, request.code).toBeNull();
      expect(events.at(-1)?.to_status, request.code).toBe(request.status);
      for (let index = 1; index < events.length; index += 1) {
        expect(events[index].from_status, request.code).toBe(events[index - 1].to_status);
      }
      expect(request.dispensed_qty).toBeLessThanOrEqual(request.qty);
    }
    const codes = all<{ code: string }>(sqlite, "SELECT code FROM requests").map((row) => row.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^REQ-\d{4}-\d{4}$/.test(code))).toBe(true);
  });

  it("numbers requests per facility year across a year boundary", () => {
    const { plan, sqlite } = seeded("2027-01-02");
    const counters = all<{ name: string; value: number }>(sqlite, "SELECT * FROM counters ORDER BY name");
    expect(counters.map((row) => row.name)).toEqual(["request:2026", "request:2027"]);
    expect(counters[0].value + counters[1].value).toBe(plan.summary.counts.requests);
    for (const counter of counters) {
      const year = counter.name.slice("request:".length);
      const last = all<{ code: string }>(sqlite, "SELECT code FROM requests WHERE code LIKE ? ORDER BY code DESC", `REQ-${year}-%`)[0];
      expect(last.code).toBe(`REQ-${year}-${String(counter.value).padStart(4, "0")}`);
    }
  });
});

describe("demo seed: dispensing and the stock ledger", () => {
  it("has about 25-30 records over the last 45 days, with per-batch lines", () => {
    const { sqlite } = seeded();
    const records = all<{ id: string; qty: number; dispensed_at: string; source: string }>(
      sqlite,
      "SELECT * FROM dispensing_records"
    );
    expect(records.length).toBeGreaterThanOrEqual(25);
    const earliest = addDays(TODAY, -45);
    for (const record of records) {
      const day = localDateOf(record.dispensed_at, TIME_ZONE);
      expect(day >= earliest && day <= TODAY, record.dispensed_at).toBe(true);
    }
    expect(new Set(records.map((record) => record.source))).toEqual(new Set(["queue", "quick_deduct"]));
    const multi = all(sqlite, "SELECT record_id FROM dispensing_lines GROUP BY record_id HAVING count(*) > 1");
    expect(multi.length).toBeGreaterThanOrEqual(1);
  });

  it("lines add up to the record, and each line matches its batch", () => {
    const { sqlite } = seeded();
    for (const record of all<{ id: string; qty: number; dispensed_at: string; item_id: string }>(
      sqlite,
      "SELECT * FROM dispensing_records"
    )) {
      const lines = all<{ batch_id: string; batch_number: string; expiry: string | null; qty: number }>(
        sqlite,
        "SELECT * FROM dispensing_lines WHERE record_id = ?",
        record.id
      );
      expect(lines.reduce((sum, line) => sum + line.qty, 0)).toBe(record.qty);
      const day = localDateOf(record.dispensed_at, TIME_ZONE);
      for (const line of lines) {
        const batch = all<BatchRow>(sqlite, "SELECT * FROM batches WHERE id = ?", line.batch_id)[0];
        expect(batch.item_id).toBe(record.item_id);
        expect(line.batch_number).toBe(batch.batch_number);
        expect(line.expiry).toBe(batch.expiry);
        // Never handed out before it arrived or after it expired.
        expect(day >= batch.received_on).toBe(true);
        expect(batch.expiry === null || day <= batch.expiry).toBe(true);
      }
    }
  });

  it("keeps initial_qty >= qty + dispensed for every batch", () => {
    const { sqlite } = seeded();
    for (const batch of all<BatchRow>(sqlite, "SELECT * FROM batches")) {
      const dispensed = all<{ total: number }>(
        sqlite,
        `SELECT COALESCE(SUM(l.qty), 0) AS total FROM dispensing_lines l
         JOIN dispensing_records r ON r.id = l.record_id
         WHERE l.batch_id = ? AND r.undone_at IS NULL`,
        batch.id
      )[0].total;
      const disposed = all<{ total: number }>(
        sqlite,
        "SELECT COALESCE(SUM(qty), 0) AS total FROM disposals WHERE batch_id = ?",
        batch.id
      )[0].total;
      expect(batch.initial_qty, batch.batch_number).toBeGreaterThanOrEqual(batch.qty + dispensed + disposed);
    }
  });

  it("has a movement per change with a running qty_after that ends at the batch quantity", () => {
    const { sqlite } = seeded();
    for (const batch of all<BatchRow>(sqlite, "SELECT * FROM batches")) {
      const movements = all<{ kind: string; qty_delta: number; qty_after: number; ref_type: string | null; ref_id: string | null }>(
        sqlite,
        "SELECT * FROM stock_movements WHERE batch_id = ? ORDER BY at, rowid",
        batch.id
      );
      expect(movements[0], batch.batch_number).toMatchObject({ kind: "receive", qty_after: batch.initial_qty });
      let running = 0;
      for (const movement of movements) {
        running += movement.qty_delta;
        expect(movement.qty_after, batch.batch_number).toBe(running);
        expect(movement.qty_after).toBeGreaterThanOrEqual(0);
      }
      expect(running, batch.batch_number).toBe(batch.qty);
    }
    const lines = count(sqlite, "dispensing_lines");
    const undoneLines = count(sqlite, "dispensing_lines WHERE record_id IN (SELECT id FROM dispensing_records WHERE undone_at IS NOT NULL)");
    expect(count(sqlite, "stock_movements WHERE kind = 'dispense'")).toBe(lines);
    expect(count(sqlite, "stock_movements WHERE kind = 'undo_dispense'")).toBe(undoneLines);
    expect(undoneLines).toBeGreaterThanOrEqual(1);
    expect(count(sqlite, "stock_movements WHERE kind = 'adjust'")).toBeGreaterThanOrEqual(2);
  });

  it("links movements to their record or disposal", () => {
    const { sqlite } = seeded();
    const dangling = all(
      sqlite,
      `SELECT m.id FROM stock_movements m
       WHERE (m.ref_type = 'dispensing_record' AND m.ref_id NOT IN (SELECT id FROM dispensing_records))
          OR (m.ref_type = 'disposal' AND m.ref_id NOT IN (SELECT id FROM disposals))`
    );
    expect(dangling).toEqual([]);
  });
});

describe("demo seed: notifications", () => {
  it("covers every kind, with a mix of read and unread, and consistent references", () => {
    const { sqlite } = seeded();
    const kinds = all<{ kind: string }>(sqlite, "SELECT DISTINCT kind FROM notifications").map((row) => row.kind).sort();
    expect(kinds).toEqual(["expired", "low_stock", "near_expiry", "urgent"]);

    const states = count(sqlite, "notification_state WHERE read_at IS NOT NULL");
    expect(states).toBeGreaterThan(0);
    const unreadForSomeone = all(
      sqlite,
      `SELECT n.id FROM notifications n CROSS JOIN users u
       WHERE NOT EXISTS (SELECT 1 FROM notification_state s WHERE s.notification_id = n.id AND s.user_id = u.id)`
    );
    expect(unreadForSomeone.length).toBeGreaterThan(0);
    expect(count(sqlite, "notifications WHERE resolved_at IS NOT NULL")).toBeGreaterThanOrEqual(1);

    for (const notification of all<{
      kind: string; item_id: string | null; batch_id: string | null; dedupe_key: string; resolved_at: string | null; data: string;
    }>(sqlite, "SELECT * FROM notifications")) {
      expect(notification.item_id).not.toBeNull();
      expect(JSON.parse(notification.data).url).toMatch(/^\//);
      if (notification.kind === "low_stock") {
        expect(notification.batch_id).toBeNull();
        expect(notification.dedupe_key).toBe(`lowstock:${notification.item_id}:${TODAY}`);
        continue;
      }
      expect(notification.dedupe_key).toBe(`batch:${notification.batch_id}:${notification.kind}`);
      const batch = all<BatchRow>(sqlite, "SELECT * FROM batches WHERE id = ?", String(notification.batch_id))[0];
      expect(batch.item_id).toBe(notification.item_id);
      if (notification.resolved_at === null) {
        expect(assessExpiry(batch.expiry, TODAY).expiryClass).toBe(notification.kind);
      }
    }
  });

  it("seeds alert_state to match, so the next cron run does not repeat the demo", () => {
    const { sqlite } = seeded();
    for (const batch of liveBatches(sqlite)) {
      const state = all<{ last_class: string }>(sqlite, "SELECT * FROM alert_state WHERE batch_id = ?", batch.id)[0];
      expect(state.last_class, batch.batch_number).toBe(assessExpiry(batch.expiry, TODAY).expiryClass);
    }
  });
});

describe("demo seed: users", () => {
  it("creates one demo user per role, ready to sign in", async () => {
    const { sqlite } = seeded();
    const users = all<{ username: string; role: string; must_change_password: number; password_hash: string; disabled_at: string | null }>(
      sqlite,
      "SELECT * FROM users ORDER BY username"
    );
    expect(users.map((user) => user.username)).toEqual([
      "demo.admin", "demo.healthadmin", "demo.inventory", "demo.nurse", "demo.pharmacist",
    ]);
    expect(users.map((user) => user.role).sort()).toEqual(["admin", "health_admin", "inventory", "nurse", "pharmacist"]);
    for (const user of users) {
      expect(user.must_change_password).toBe(0);
      expect(user.disabled_at).toBeNull();
      expect((await verifyPassword(DEMO_PASSWORD, user.password_hash)).ok).toBe(true);
      expect((await verifyPassword("not-the-password-1", user.password_hash)).ok).toBe(false);
    }
  });

  it("honours WEB_DEMO_PASSWORD (as the plan's password option) and checks its length", async () => {
    const custom = "Another-Demo-Passphrase-1";
    const plan = buildDemoPlan(DATASET, { iterations: FAST, password: custom, timeZone: TIME_ZONE, today: TODAY });
    expect(plan.passwordIsDefault).toBe(false);
    expect((await verifyPassword(custom, String(plan.tables.users[0].password_hash))).ok).toBe(true);
    expect(formatDemoSummary(plan, { defaultPassword: DEMO_PASSWORD, target: "x" })).not.toContain(custom);
    expect(() => buildDemoPlan(DATASET, { password: "short", timeZone: TIME_ZONE, today: TODAY })).toThrow(/10-128/);
  });

  it("writes hashes in the stored format at the Workers iteration ceiling by default", () => {
    const plan = buildDemoPlan(DATASET, { timeZone: TIME_ZONE, today: TODAY });
    for (const user of plan.tables.users) {
      expect(String(user.password_hash)).toMatch(
        new RegExp(`^pbkdf2-sha256\\$${DEFAULT_PASSWORD_ITERATIONS}\\$[A-Za-z0-9_-]{22}\\$[A-Za-z0-9_-]{43}$`)
      );
    }
  });

  it("can sign in through the real API", async () => {
    const app = await createTestApp();
    const plan = buildDemoPlan(DATASET, { timeZone: TIME_ZONE, today: TODAY });
    seed(app.sqlite, plan);
    for (const user of plan.tables.users) {
      const response = await app.anonymous.post<{ user?: { role: string; mustChangePassword?: boolean } }>(
        "/api/auth/login",
        { identifier: String(user.username), password: DEMO_PASSWORD }
      );
      expect(response.status, String(user.username)).toBe(200);
      expect(response.setCookie).toContain("mt_session=");
    }
  });
});

describe("demo seed: other bases", () => {
  it("honours another facility timezone and its DST", () => {
    const zone = "America/New_York";
    const { plan, sqlite } = seeded("2026-03-09", zone);
    expect(all(sqlite, "PRAGMA foreign_key_check")).toEqual([]);
    // "-1d 10:10" (d21): local date is the day before the base date, 10:10 local.
    const latest = [...plan.tables.dispensing_records].sort((a, b) =>
      String(b.dispensed_at).localeCompare(String(a.dispensed_at))
    )[0];
    const at = new Date(String(latest.dispensed_at));
    expect(sharedDates.todayInZone(at, zone)).toBe("2026-03-08");
    expect(sharedDates.timeInZone(at, zone)).toBe("10:10");
  });

  it("works with other expiry thresholds", () => {
    const plan = buildDemoPlan(DATASET, {
      iterations: FAST,
      thresholds: { nearDays: 60, urgentDays: 14 },
      timeZone: TIME_ZONE,
      today: TODAY,
    });
    const db = createMigratedD1();
    seed(db.sqlite, plan);
    for (const notification of all<{ kind: string; batch_id: string | null; resolved_at: string | null }>(
      db.sqlite,
      "SELECT kind, batch_id, resolved_at FROM notifications WHERE batch_id IS NOT NULL AND resolved_at IS NULL"
    )) {
      const batch = all<BatchRow>(db.sqlite, "SELECT * FROM batches WHERE id = ?", String(notification.batch_id))[0];
      expect(assessExpiry(batch.expiry, TODAY, plan.thresholds).expiryClass).toBe(notification.kind);
    }
  });

  it("agrees with the shared date helpers", () => {
    const zones = ["Asia/Manila", "America/New_York", "Europe/London", "Pacific/Auckland"];
    for (const zone of zones) {
      for (const date of ["2026-03-08", "2026-10-25", "2028-02-29"]) {
        for (const time of ["00:00", "02:30", "23:59"]) {
          expect(seedZonedDateTimeToUtc(date, time, zone).toISOString()).toBe(
            sharedDates.zonedDateTimeToUtc(date, time, zone).toISOString()
          );
        }
        const instant = new Date(`${date}T12:34:56.000Z`);
        expect(seedTodayInZone(instant, zone)).toBe(sharedDates.todayInZone(instant, zone));
      }
    }
    expect(seedAddDays("2028-02-28", 2)).toBe(sharedDates.addDays("2028-02-28", 2));
    expect(seedDaysBetween("2026-01-01", "2027-03-01")).toBe(sharedDates.daysBetween("2026-01-01", "2027-03-01"));
    expect(resolveRelativeMoment("-3d 09:30", "2026-11-12", TIME_ZONE)).toEqual({
      date: "2026-11-09",
      iso: "2026-11-09T01:30:00.000Z",
      offset: -3,
    });
    expect(() => resolveRelativeMoment("yesterday", TODAY, TIME_ZONE)).toThrow(/Bad relative time/);
  });
});

describe("demo seed: the dataset checks itself", () => {
  function mutated(change: (data: Record<string, any>) => void): () => unknown {
    return () => {
      const copy = structuredClone(DATASET) as Record<string, any>;
      change(copy);
      return buildDemoPlan(copy, { iterations: FAST, timeZone: TIME_ZONE, today: TODAY });
    };
  }

  it("rejects dispensing from a batch that has already expired", () => {
    expect(
      mutated((data) => {
        const record = data.dispensing.find((entry: any) => entry.ref === "d01");
        record.item = "azithromycin-500";
        record.lines = [{ batch: "AZI-2408A", qty: 1 }];
        record.at = "-2d 09:00";
      })
    ).toThrow(/expired/);
  });

  it("rejects an unknown item, a duplicate batch and a batch that would go negative", () => {
    expect(mutated((data) => { data.batches[0].item = "nope"; })).toThrow(/unknown item/);
    expect(mutated((data) => { data.batches[1].number = data.batches[0].number; })).toThrow(/duplicate/);
    expect(
      mutated((data) => {
        const batch = data.batches.find((entry: any) => entry.number === "CEF-2406A");
        batch.initialQty = 0;
      })
    ).toThrow(/CEF-2406A/);
  });

  it("rejects an expiry-less batch of an item that expires", () => {
    expect(mutated((data) => { data.batches[0].expiry = null; })).toThrow(/expiry must be set/);
  });

  it("rejects a request whose history contradicts its status", () => {
    expect(
      mutated((data) => {
        data.requests.find((entry: any) => entry.ref === "r05").status = "ready";
      })
    ).toThrow(/history ends/);
  });
});

describe("demo seed: summary and guards", () => {
  it("prints a summary table without the custom password", () => {
    const text = formatDemoSummary(planFor(TODAY), { defaultPassword: DEMO_PASSWORD, target: "local D1" });
    for (const needle of ["batches", "Near Expiry", "Urgent", "Expired (quarantine)", "pending", "cancelled", "demo.nurse", "Demo-Password-2026 (default)"]) {
      expect(text).toContain(needle);
    }
  });

  function options(argv: string[]): DemoOptions {
    return parseDemoArgs(argv);
  }

  it("targets the local database by default, with no confirmation", () => {
    expect(resolveDemoTarget(options([]))).toEqual({ database: undefined, env: undefined, production: false, remote: false });
    expect(() => resolveDemoTarget(options(["--database", "x"]))).toThrow(/only apply together with --remote/);
  });

  it("needs --yes-i-know for any remote database and a target", () => {
    expect(() => resolveDemoTarget(options(["--remote"]))).toThrow(/needs a target/);
    expect(() => resolveDemoTarget(options(["--remote", "--env", "preview"]))).toThrow(/--yes-i-know/);
    expect(() => resolveDemoTarget(options(["--remote", "--env", "preview", "--database", "x", "--yes-i-know"]))).toThrow(/not both/);
    expect(resolveDemoTarget(options(["--remote", "--env", "preview", "--yes-i-know"]))).toEqual({
      database: undefined, env: "preview", production: false, remote: true,
    });
    expect(resolveDemoTarget(options(["--remote", "--database=meditract-preview", "--yes-i-know"]))).toMatchObject({
      database: "meditract-preview", production: false, remote: true,
    });
  });

  it("refuses production without --confirm-production", () => {
    for (const argv of [
      ["--remote", "--database", "meditract", "--yes-i-know"],
      ["--remote", "--database", "MediTract", "--yes-i-know"],
      ["--remote", "--env", "production", "--yes-i-know"],
    ]) {
      expect(() => resolveDemoTarget(options(argv)), argv.join(" ")).toThrow(/PRODUCTION/);
      expect(resolveDemoTarget(options([...argv, "--confirm-production"])).production).toBe(true);
    }
    expect(isProductionTarget({ database: "meditract-preview" })).toBe(false);
    expect(isProductionTarget({ database: "prod-clinic" }, ["prod-clinic"])).toBe(true);
  });

  it("validates --today and rejects unknown flags", () => {
    expect(options(["--today", "2026-11-12"]).today).toBe("2026-11-12");
    expect(options(["--today=2026-11-12"]).today).toBe("2026-11-12");
    expect(() => options(["--today", "2026-13-40"])).toThrow(/--today/);
    expect(() => options(["--today"])).toThrow(/needs a value/);
    expect(() => options(["--wipe-everything"])).toThrow(/Unknown argument/);
  });

  it("the script itself refuses production before touching any database", () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--remote", "--database", "meditract", "--yes-i-know"],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing to seed the PRODUCTION database/);
    const noFlag = spawnSync(process.execPath, [SCRIPT, "--remote", "--env", "preview"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(noFlag.status).toBe(1);
    expect(noFlag.stderr).toMatch(/--yes-i-know/);
  });

  it("is a plan of plain data: rows only carry bindable values", () => {
    const plan = planFor(TODAY);
    for (const [table, rows] of Object.entries(plan.tables)) {
      for (const row of rows as Row[]) {
        for (const value of Object.values(row)) {
          expect(value === null || typeof value === "string" || typeof value === "number", table).toBe(true);
        }
      }
    }
  });
});
