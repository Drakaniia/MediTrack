import { describe, expect, it } from "vitest";

import {
  addStock,
  alertClassOf,
  count,
  freshDb,
  NOW,
  notificationRows,
  notificationsOf,
  selectCount,
  setExpiry,
  settingsWith,
  spyOn,
  TODAY,
} from "../../../test/alert-run-helpers";
import { insertBatch, insertItem } from "../../../test/fixtures";
import { runAlertGeneration } from "./generate";

const DAY_MS = 86_400_000;

function daysLater(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

describe("runAlertGeneration transitions", () => {
  it("notifies each worsening transition once, with kind, severity, wording and url", async () => {
    const db = freshDb();
    const near = addStock(db, { batchNumber: "LOT-N", expiry: "2026-12-05" });
    const urgent = addStock(db, {
      batchNumber: "LOT-U",
      expiry: "2026-11-17",
      name: "Amoxicillin",
      strength: "250 mg",
    });
    const expired = addStock(db, {
      batchNumber: "LOT-E",
      expiry: "2026-11-09",
      name: "Insulin",
      strength: "",
    });
    addStock(db, { batchNumber: "LOT-S", expiry: "2027-09-01", name: "Safe" });

    const result = await runAlertGeneration(db, {
      now: NOW,
      settings: settingsWith(),
    });

    expect(result.localDate).toBe(TODAY);
    expect(result.notificationsCreated).toBe(3);
    expect(result.counts).toEqual({
      expired: 1,
      lowStock: 0,
      nearExpiry: 1,
      safe: 1,
      urgent: 1,
    });
    expect(
      result.transitions.map((entry) => [
        entry.batchNumber,
        entry.from,
        entry.to,
      ])
    ).toEqual([
      ["LOT-E", "safe", "expired"],
      ["LOT-U", "safe", "urgent"],
      ["LOT-N", "safe", "near_expiry"],
    ]);
    const [urgentRow] = notificationsOf(db, urgent.batchId);
    expect(urgentRow).toMatchObject({
      dedupe_key: `batch:${urgent.batchId}:urgent`,
      item_id: urgent.itemId,
      kind: "urgent",
      resolved_at: null,
      severity: "warning",
      title:
        "Amoxicillin 250 mg · LOT-U is Urgent — expires in 5 days (2026-11-17)",
    });
    expect(JSON.parse(urgentRow?.data ?? "{}")).toMatchObject({
      batchNumber: "LOT-U",
      daysUntil: 5,
      expiry: "2026-11-17",
      url: "/inventory/expiry",
    });
    expect(notificationsOf(db, near.batchId)[0]).toMatchObject({
      kind: "near_expiry",
      severity: "info",
    });
    const [expiredRow] = notificationsOf(db, expired.batchId);
    expect(expiredRow).toMatchObject({ kind: "expired", severity: "critical" });
    expect(expiredRow?.title).toBe(
      "Insulin · LOT-E is Expired — expired 3 days ago (2026-11-09)"
    );
    expect(JSON.parse(expiredRow?.data ?? "{}").url).toBe(
      "/inventory/quarantine"
    );
    expect(alertClassOf(db, urgent.batchId)).toBe("urgent");
  });

  it("does not repeat a transition when run again", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2026-11-15" });
    const settings = settingsWith();

    await runAlertGeneration(db, { now: NOW, settings });
    const second = await runAlertGeneration(db, { now: NOW, settings });
    const later = await runAlertGeneration(db, {
      now: daysLater(1),
      settings,
    });

    expect(second.transitions).toEqual([]);
    expect(second.notificationsCreated).toBe(0);
    expect(later.notificationsCreated).toBe(0);
    expect(count(db, "notifications")).toBe(1);
  });

  it("walks near_expiry → urgent → expired over time and supersedes older alerts", async () => {
    const db = freshDb();
    const { batchId } = addStock(db, { expiry: "2026-12-01" });
    const settings = settingsWith();

    await runAlertGeneration(db, { now: NOW, settings });
    await runAlertGeneration(db, { now: daysLater(14), settings });
    const last = await runAlertGeneration(db, { now: daysLater(25), settings });

    expect(last.transitions.map((entry) => entry.to)).toEqual(["expired"]);
    const rows = notificationsOf(db, batchId);
    expect(rows.map((row) => [row.kind, row.resolved_at === null])).toEqual([
      ["near_expiry", false],
      ["urgent", false],
      ["expired", true],
    ]);
    expect(alertClassOf(db, batchId)).toBe("expired");
  });

  it("treats a batch that expires today as Urgent", async () => {
    const db = freshDb();
    addStock(db, { expiry: TODAY });

    const result = await runAlertGeneration(db, {
      now: NOW,
      settings: settingsWith(),
    });

    expect(result.transitions[0]).toMatchObject({ daysUntil: 0, to: "urgent" });
    expect(notificationRows(db)[0]?.title).toContain("expires today");
  });

  it("uses the facility thresholds", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2026-11-17" });
    const settings = settingsWith({ expiry: { nearDays: 10, urgentDays: 3 } });

    const result = await runAlertGeneration(db, { now: NOW, settings });

    expect(result.transitions.map((entry) => entry.to)).toEqual([
      "near_expiry",
    ]);
    expect(result.counts.nearExpiry).toBe(1);
  });

  it("uses the facility-local date, not the UTC date", async () => {
    const db = freshDb();
    addStock(db, { expiry: "2026-11-12" });
    // 2026-11-11T18:30Z is already 02:30 on 2026-11-12 in Manila: expires today (urgent).
    const result = await runAlertGeneration(db, {
      now: new Date("2026-11-11T18:30:00.000Z"),
      settings: settingsWith(),
    });

    expect(result.localDate).toBe("2026-11-12");
    expect(result.transitions[0]?.daysUntil).toBe(0);
  });

  it("never alerts a batch without an expiry date", async () => {
    const db = freshDb();
    addStock(db, { expiry: null, hasExpiry: false, name: "Gloves" });

    const result = await runAlertGeneration(db, {
      now: NOW,
      settings: settingsWith(),
    });

    expect(result.transitions).toEqual([]);
    expect(result.counts.safe).toBe(1);
    expect(count(db, "notifications")).toBe(0);
    expect(count(db, "alert_state")).toBe(0);
  });
});

describe("runAlertGeneration resolution", () => {
  it("resolves silently when the class improves and records the new state", async () => {
    const db = freshDb();
    const { batchId } = addStock(db, { expiry: "2026-11-15" });
    const settings = settingsWith();
    await runAlertGeneration(db, { now: NOW, settings });

    setExpiry(db, batchId, "2027-05-01");
    const result = await runAlertGeneration(db, { now: NOW, settings });

    expect(result.transitions).toEqual([]);
    expect(result.notificationsCreated).toBe(0);
    expect(result.resolved).toBe(1);
    expect(notificationsOf(db, batchId)[0]?.resolved_at).not.toBeNull();
    expect(alertClassOf(db, batchId)).toBe("safe");
  });

  it("alerts again, as a fresh unread alert, when a resolved batch worsens again", async () => {
    const db = freshDb();
    const { batchId } = addStock(db, { expiry: "2026-12-01" });
    const settings = settingsWith();
    await runAlertGeneration(db, { now: NOW, settings });
    const userId = "user-1";
    db.sqlite
      .prepare(
        "INSERT INTO users (id, username, username_lower, display_name, role, password_hash) VALUES (?, 'u', 'u', 'U', 'admin', 'x')"
      )
      .run(userId);
    const [first] = notificationRows(db);
    db.sqlite
      .prepare(
        "INSERT INTO notification_state (notification_id, user_id, read_at, dismissed_at) VALUES (?, ?, 'x', 'x')"
      )
      .run(first?.id ?? "", userId);
    setExpiry(db, batchId, "2027-05-01");
    await runAlertGeneration(db, { now: NOW, settings });

    setExpiry(db, batchId, "2026-12-02");
    const again = await runAlertGeneration(db, { now: NOW, settings });

    expect(again.notificationsCreated).toBe(1);
    const rows = notificationRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resolved_at).toBeNull();
    expect(count(db, "notification_state")).toBe(0);
  });

  it("resolves the notifications of disposed, emptied and trashed batches and forgets their state", async () => {
    const db = freshDb();
    const disposed = addStock(db, {
      batchNumber: "D",
      expiry: "2026-11-15",
      name: "Disposed",
    });
    const emptied = addStock(db, {
      batchNumber: "Z",
      expiry: "2026-11-15",
      name: "Emptied",
    });
    const trashed = addStock(db, {
      batchNumber: "T",
      expiry: "2026-11-15",
      name: "Trashed",
    });
    const settings = settingsWith();
    await runAlertGeneration(db, { now: NOW, settings });
    expect(count(db, "alert_state")).toBe(3);

    db.sqlite
      .prepare("UPDATE batches SET status = 'disposed' WHERE id = ?")
      .run(disposed.batchId);
    db.sqlite
      .prepare("UPDATE batches SET qty = 0 WHERE id = ?")
      .run(emptied.batchId);
    db.sqlite
      .prepare("UPDATE batches SET deleted_at = ? WHERE id = ?")
      .run(NOW.toISOString(), trashed.batchId);
    const result = await runAlertGeneration(db, { now: NOW, settings });

    expect(result.resolved).toBe(3);
    expect(count(db, "alert_state")).toBe(0);
    expect(notificationRows(db).every((row) => row.resolved_at !== null)).toBe(
      true
    );
  });
});

describe("runAlertGeneration low stock", () => {
  it("notifies when an item newly drops below its threshold and resolves on recovery", async () => {
    const db = freshDb();
    const { batchId, itemId } = addStock(db, {
      name: "Gauze",
      qty: 4,
      strength: "",
      threshold: 10,
    });
    const settings = settingsWith();

    const first = await runAlertGeneration(db, { now: NOW, settings });
    const second = await runAlertGeneration(db, { now: NOW, settings });

    expect(first.lowStock).toEqual([
      { available: 4, itemId, itemName: "Gauze", threshold: 10, unit: "tab" },
    ]);
    expect(first.counts.lowStock).toBe(1);
    expect(second.lowStock).toEqual([]);
    expect(second.counts.lowStock).toBe(1);
    expect(notificationRows(db)).toHaveLength(1);
    expect(notificationRows(db)[0]).toMatchObject({
      dedupe_key: `lowstock:${itemId}:${TODAY}`,
      kind: "low_stock",
      severity: "warning",
    });

    db.sqlite.prepare("UPDATE batches SET qty = 50 WHERE id = ?").run(batchId);
    const recovered = await runAlertGeneration(db, { now: NOW, settings });

    expect(recovered.resolved).toBe(1);
    expect(recovered.counts.lowStock).toBe(0);
    expect(notificationRows(db)[0]?.resolved_at).not.toBeNull();
    const state = db.sqlite
      .prepare("SELECT is_low FROM low_stock_state WHERE item_id = ?")
      .get(itemId) as { is_low: number };
    expect(state.is_low).toBe(0);
  });

  it("is critical when nothing usable is left, and expired stock does not count as available", async () => {
    const db = freshDb();
    const { itemId } = addStock(db, {
      expiry: "2026-11-01",
      qty: 30,
      threshold: 5,
    });

    const result = await runAlertGeneration(db, {
      now: NOW,
      settings: settingsWith(),
    });

    expect(result.lowStock[0]).toMatchObject({ available: 0, itemId });
    const low = notificationRows(db).find((row) => row.kind === "low_stock");
    expect(low?.severity).toBe("critical");
  });

  it("ignores items without a threshold and re-alerts on a new day", async () => {
    const db = freshDb();
    addStock(db, { name: "Untracked", qty: 0, threshold: 0 });
    const tracked = addStock(db, { name: "Tracked", qty: 1, threshold: 5 });
    const settings = settingsWith();

    await runAlertGeneration(db, { now: NOW, settings });
    db.sqlite
      .prepare("UPDATE batches SET qty = 9 WHERE id = ?")
      .run(tracked.batchId);
    await runAlertGeneration(db, { now: NOW, settings });
    db.sqlite
      .prepare("UPDATE batches SET qty = 1 WHERE id = ?")
      .run(tracked.batchId);
    const nextDay = await runAlertGeneration(db, {
      now: daysLater(1),
      settings,
    });

    expect(nextDay.lowStock.map((entry) => entry.itemName)).toEqual([
      "Tracked 500 mg",
    ]);
    const keys = notificationRows(db).map((row) => row.dedupe_key);
    expect(keys).toEqual([
      `lowstock:${tracked.itemId}:2026-11-12`,
      `lowstock:${tracked.itemId}:2026-11-13`,
    ]);
  });
});

describe("runAlertGeneration with in-app alerts off", () => {
  it("advances the state but creates no notification rows", async () => {
    const db = freshDb();
    const { batchId } = addStock(db, { expiry: "2026-11-15", threshold: 50 });
    const off = settingsWith({ alerts: { inApp: false } });

    const result = await runAlertGeneration(db, { now: NOW, settings: off });

    expect(result.notificationsCreated).toBe(0);
    expect(result.transitions).toHaveLength(1);
    expect(result.lowStock).toHaveLength(1);
    expect(count(db, "notifications")).toBe(0);
    expect(alertClassOf(db, batchId)).toBe("urgent");
    expect(count(db, "low_stock_state")).toBe(1);

    const on = await runAlertGeneration(db, {
      now: NOW,
      settings: settingsWith(),
    });
    expect(on.transitions).toEqual([]);
    expect(on.notificationsCreated).toBe(0);
    expect(count(db, "notifications")).toBe(0);
  });
});

describe("runAlertGeneration at scale", () => {
  it("handles 250 batches in a few chunked statements without per-row queries", async () => {
    const db = freshDb();
    for (let index = 0; index < 250; index += 1) {
      const itemId = insertItem(db.sqlite, {
        lowStockThreshold: 1000,
        name: `Item ${index}`,
      });
      insertBatch(db.sqlite, {
        batchNumber: `L${index}`,
        expiry: index % 2 === 0 ? "2026-11-15" : "2026-11-01",
        itemId,
        qty: 5,
      });
    }
    const spy = spyOn(db);

    const result = await runAlertGeneration(spy.db, {
      now: NOW,
      settings: settingsWith(),
    });

    expect(result.transitions).toHaveLength(250);
    expect(result.lowStock).toHaveLength(250);
    expect(result.notificationsCreated).toBe(500);
    expect(count(db, "notifications")).toBe(500);
    expect(count(db, "alert_state")).toBe(250);
    expect(selectCount(spy)).toBeLessThanOrEqual(3);
    expect(Math.max(...spy.batchSizes)).toBeLessThanOrEqual(90);
    expect(spy.sql.length).toBeLessThan(150);

    const rerun = await runAlertGeneration(spy.db, {
      now: NOW,
      settings: settingsWith(),
    });
    expect(rerun.notificationsCreated).toBe(0);
    expect(count(db, "notifications")).toBe(500);
  });
});
