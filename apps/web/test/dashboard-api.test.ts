import { describe, expect, it } from "vitest";

import { DASHBOARD_LIST_LIMIT } from "../shared/schemas/dashboard";
import { createTestApp, type TestApp } from "./app";
import {
  dashboardActor,
  fetchDashboard,
  insertDispensing,
  insertDisposal,
  insertReceive,
  insertRequest,
} from "./dashboard-helpers";
import { day } from "./expiry-helpers";
import { insertBatch, insertItem } from "./fixtures";

const MANILA_MIDNIGHT = "2026-11-11T16:00:00.000Z";
const JUST_BEFORE_MANILA_MIDNIGHT = "2026-11-11T15:59:59.000Z";

function itemWith(
  app: TestApp,
  expiries: readonly (string | null)[],
  fields: { lowStockThreshold?: number; name?: string; qty?: number } = {}
): { batchIds: string[]; itemId: string } {
  const itemId = insertItem(app.sqlite, {
    hasExpiry: !expiries.includes(null),
    lowStockThreshold: fields.lowStockThreshold,
    name: fields.name,
  });
  const batchIds = expiries.map((expiry, index) =>
    insertBatch(app.sqlite, {
      batchNumber: `LOT-${index}`,
      expiry,
      itemId,
      qty: fields.qty ?? 10,
    })
  );
  return { batchIds, itemId };
}

describe("GET /api/dashboard — access and role shape", () => {
  it("rejects anonymous callers", async () => {
    const app = await createTestApp();
    const response = await app.anonymous.get("/api/dashboard");
    expect(response.status).toBe(401);
  });

  it("omits the dispensing and activity cards for nurses, keeps availability", async () => {
    const app = await createTestApp();
    itemWith(app, [day(20)], { name: "Gauze" });
    const nurse = await dashboardActor(app, "nurse");

    const body = await fetchDashboard(nurse.client);

    expect("recentDispensing" in body).toBe(false);
    expect("activity" in body).toBe(false);
    expect(body.pendingRequests?.counts).toEqual({
      approved: 0,
      pending: 0,
      ready: 0,
    });
    expect(body.useFirst).toHaveLength(1);
    expect(body.totals.itemCount).toBe(1);
  });

  it("gives analytics and dispensing roles every card, health admin included", async () => {
    const app = await createTestApp();
    for (const role of [
      "admin",
      "inventory",
      "pharmacist",
      "health_admin",
    ] as const) {
      const actor = await dashboardActor(app, role);
      const body = await fetchDashboard(actor.client);
      expect(Object.keys(body).sort(), role).toEqual(
        [
          "activity",
          "expiringThisMonth",
          "generatedAt",
          "month",
          "pendingRequests",
          "recentDispensing",
          "thresholds",
          "timezone",
          "today",
          "totals",
          "useFirst",
        ].sort()
      );
    }
  });

  it("reports the facility today, month, timezone, thresholds and generation time", async () => {
    const app = await createTestApp();
    const admin = await dashboardActor(app, "admin");
    const body = await fetchDashboard(admin.client);
    expect(body).toMatchObject({
      generatedAt: app.clock.now().toISOString(),
      month: "2026-11",
      thresholds: { nearDays: 30, urgentDays: 7 },
      timezone: "Asia/Manila",
      today: "2026-11-12",
    });
  });
});

describe("GET /api/dashboard — totals", () => {
  it("classifies batches on the boundary days and counts only live stock", async () => {
    const app = await createTestApp();
    const itemId = insertItem(app.sqlite, { name: "Boundary" });
    const specs: [string, number, number][] = [
      ["D-1", -1, 1],
      ["D0", 0, 2],
      ["D7", 7, 4],
      ["D8", 8, 8],
      ["D30", 30, 16],
      ["D31", 31, 32],
    ];
    for (const [batchNumber, offset, qty] of specs) {
      insertBatch(app.sqlite, { batchNumber, expiry: day(offset), itemId, qty });
    }
    // Never counted: empty, disposed, trashed.
    insertBatch(app.sqlite, { batchNumber: "EMPTY", expiry: day(-3), itemId, qty: 0 });
    insertBatch(app.sqlite, {
      batchNumber: "DISPOSED",
      expiry: day(-3),
      itemId,
      qty: 5,
      status: "disposed",
    });
    insertBatch(app.sqlite, {
      batchNumber: "TRASHED",
      deleted: true,
      expiry: day(3),
      itemId,
      qty: 5,
    });
    const noExpiry = insertItem(app.sqlite, { hasExpiry: false, name: "Bed" });
    insertBatch(app.sqlite, { batchNumber: "NOEXP", expiry: null, itemId: noExpiry, qty: 64 });
    const admin = await dashboardActor(app, "admin");

    const { totals } = await fetchDashboard(admin.client);

    expect(totals.classes).toEqual({
      expired: { batches: 1, units: 1 },
      near_expiry: { batches: 2, units: 24 },
      safe: { batches: 2, units: 96 },
      urgent: { batches: 2, units: 6 },
    });
    expect(totals.itemCount).toBe(2);
  });

  it("flips a batch from Urgent to Expired exactly at Manila midnight", async () => {
    const app = await createTestApp({ now: JUST_BEFORE_MANILA_MIDNIGHT });
    itemWith(app, ["2026-11-11"], { qty: 7 });
    const admin = await dashboardActor(app, "admin");

    const before = await fetchDashboard(admin.client);
    expect(before.today).toBe("2026-11-11");
    expect(before.totals.classes.urgent).toEqual({ batches: 1, units: 7 });
    expect(before.totals.classes.expired.batches).toBe(0);

    app.clock.set(MANILA_MIDNIGHT);
    const after = await fetchDashboard(admin.client);
    expect(after.today).toBe("2026-11-12");
    expect(after.totals.classes.expired).toEqual({ batches: 1, units: 7 });
    expect(after.totals.classes.urgent.batches).toBe(0);
  });

  it("follows changed thresholds at once", async () => {
    const app = await createTestApp();
    itemWith(app, [day(9)]);
    const admin = await dashboardActor(app, "admin");
    expect((await fetchDashboard(admin.client)).totals.classes.near_expiry.batches).toBe(1);

    await app.setSettings({ expiry: { urgentDays: 10 } });

    const { totals } = await fetchDashboard(admin.client);
    expect(totals.classes.urgent.batches).toBe(1);
    expect(totals.classes.near_expiry.batches).toBe(0);
  });

  it("counts low stock on available quantity, not on hand", async () => {
    const app = await createTestApp();
    // 6 usable + 20 expired: on hand 26 ≥ 10, available 6 < 10 → low.
    const low = insertItem(app.sqlite, { lowStockThreshold: 10, name: "Low" });
    insertBatch(app.sqlite, { batchNumber: "OK", expiry: day(60), itemId: low, qty: 6 });
    insertBatch(app.sqlite, { batchNumber: "OLD", expiry: day(-2), itemId: low, qty: 20 });
    // Exactly at the threshold is fine.
    const atThreshold = insertItem(app.sqlite, { lowStockThreshold: 10, name: "At" });
    insertBatch(app.sqlite, { expiry: day(60), itemId: atThreshold, qty: 10 });
    // Nothing available at all.
    insertItem(app.sqlite, { lowStockThreshold: 5, name: "Out" });
    // Only expired stock.
    const onlyExpired = insertItem(app.sqlite, { lowStockThreshold: 5, name: "Expired" });
    insertBatch(app.sqlite, { expiry: day(-1), itemId: onlyExpired, qty: 50 });
    // No threshold → never low.
    insertItem(app.sqlite, { lowStockThreshold: 0, name: "Untracked" });
    const admin = await dashboardActor(app, "admin");

    const { totals } = await fetchDashboard(admin.client);

    expect(totals.itemCount).toBe(5);
    expect(totals.lowStockCount).toBe(3);
    expect(totals.outOfStockCount).toBe(2);
  });
});

describe("GET /api/dashboard — expiring in the selected month", () => {
  it("defaults to the facility month and lists at most eight batches by expiry", async () => {
    const app = await createTestApp();
    const offsets = [-7, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const { itemId } = itemWith(app, []);
    for (const offset of offsets) {
      insertBatch(app.sqlite, {
        batchNumber: `D${offset}`,
        expiry: day(offset),
        itemId,
        qty: 2,
      });
    }
    insertBatch(app.sqlite, { batchNumber: "DEC", expiry: "2026-12-01", itemId, qty: 9 });
    const admin = await dashboardActor(app, "admin");

    const { expiringThisMonth } = await fetchDashboard(admin.client);

    expect(expiringThisMonth.month).toBe("2026-11");
    expect(expiringThisMonth.batches).toBe(11);
    expect(expiringThisMonth.units).toBe(22);
    expect(expiringThisMonth.items).toHaveLength(DASHBOARD_LIST_LIMIT);
    expect(expiringThisMonth.items.map((row) => row.batchNumber)).toEqual([
      "D-7",
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
      "D6",
      "D7",
    ]);
    expect(expiringThisMonth.items[0]).toMatchObject({
      daysUntil: -7,
      expiryClass: "expired",
    });
    expect(expiringThisMonth.items[1]).toMatchObject({
      daysUntil: 1,
      expiryClass: "urgent",
    });
  });

  it("filters by ?month= on the facility calendar", async () => {
    const app = await createTestApp();
    const { itemId } = itemWith(app, []);
    insertBatch(app.sqlite, { batchNumber: "NOV30", expiry: "2026-11-30", itemId, qty: 1 });
    insertBatch(app.sqlite, { batchNumber: "DEC01", expiry: "2026-12-01", itemId, qty: 4 });
    insertBatch(app.sqlite, { batchNumber: "DEC31", expiry: "2026-12-31", itemId, qty: 5 });
    insertBatch(app.sqlite, { batchNumber: "JAN01", expiry: "2027-01-01", itemId, qty: 6 });
    const admin = await dashboardActor(app, "admin");

    const december = await fetchDashboard(admin.client, "2026-12");

    expect(december.month).toBe("2026-12");
    expect(december.expiringThisMonth.items.map((row) => row.batchNumber)).toEqual([
      "DEC01",
      "DEC31",
    ]);
    expect(december.expiringThisMonth.units).toBe(9);
    // The class totals are about today, not about the selected month.
    expect(december.today).toBe("2026-11-12");
  });

  it("answers 400 for an invalid month", async () => {
    const app = await createTestApp();
    const admin = await dashboardActor(app, "admin");
    for (const month of ["2026-13", "2026-00", "2026-1", "abc", "2026-11-05", ""]) {
      const response = await admin.client.get("/api/dashboard", { month });
      expect(response.status, month).toBe(400);
      expect(response.error?.code, month).toBe("validation_error");
    }
  });
});

describe("GET /api/dashboard — use first (FEFO)", () => {
  it("lists each item's next eligible batch, earliest expiry first, without expired stock", async () => {
    const app = await createTestApp();
    const a = itemWith(app, [day(40), day(10)], { name: "Amoxicillin" });
    const b = itemWith(app, [day(5)], { name: "Bandage" });
    itemWith(app, [day(-4)], { name: "Cough syrup" });
    const d = itemWith(app, [null], { name: "Dressing" });
    itemWith(app, [day(3)], { name: "Empty", qty: 0 });
    const nurse = await dashboardActor(app, "nurse");

    const { useFirst } = await fetchDashboard(nurse.client);

    expect(useFirst.map((entry) => entry.item.id)).toEqual([
      b.itemId,
      a.itemId,
      d.itemId,
    ]);
    expect(useFirst[1].batch).toMatchObject({
      expiry: day(10),
      fefoRank: 1,
      id: a.batchIds[1],
    });
  });

  it("caps the shortlist at eight items", async () => {
    const app = await createTestApp();
    for (let index = 0; index < 11; index += 1) {
      itemWith(app, [day(20 + index)], { name: `Item ${index}` });
    }
    const admin = await dashboardActor(app, "admin");
    const { useFirst } = await fetchDashboard(admin.client);
    expect(useFirst).toHaveLength(DASHBOARD_LIST_LIMIT);
    expect(useFirst[0].batch.expiry).toBe(day(20));
  });
});

describe("GET /api/dashboard — requests and dispensing cards", () => {
  it("counts open requests per status and lists the five oldest pending", async () => {
    const app = await createTestApp();
    const nurse = await dashboardActor(app, "nurse");
    for (let index = 0; index < 7; index += 1) {
      insertRequest(app.sqlite, {
        itemName: `Item ${index}`,
        requestedBy: nurse.userId,
        submittedAt: `2026-11-0${index + 1}T08:00:00.000Z`,
      });
    }
    insertRequest(app.sqlite, { status: "approved" });
    insertRequest(app.sqlite, { status: "approved" });
    insertRequest(app.sqlite, { status: "ready" });
    insertRequest(app.sqlite, { status: "claimed" });
    insertRequest(app.sqlite, { status: "denied" });
    insertRequest(app.sqlite, { archivedAt: "2026-11-02T00:00:00.000Z", status: "pending" });

    const { pendingRequests } = await fetchDashboard(nurse.client);

    expect(pendingRequests?.counts).toEqual({ approved: 2, pending: 7, ready: 1 });
    expect(pendingRequests?.oldestPending.map((row) => row.itemName)).toEqual([
      "Item 0",
      "Item 1",
      "Item 2",
      "Item 3",
      "Item 4",
    ]);
    expect(pendingRequests?.oldestPending[0].requestorName).toContain("nurse");
  });

  it("lists the eight latest dispensing records, skipping undone ones, with their batches", async () => {
    const app = await createTestApp();
    const pharmacist = await dashboardActor(app, "pharmacist");
    for (let index = 0; index < 9; index += 1) {
      insertDispensing(app.sqlite, {
        at: `2026-11-0${index + 1}T08:00:00.000Z`,
        by: pharmacist.userId,
        itemName: `Item ${index}`,
        lines: [
          { batchNumber: "LOT-A", qty: 2 },
          { batchNumber: "LOT-B", qty: 1 },
        ],
      });
    }
    insertDispensing(app.sqlite, {
      at: "2026-11-10T08:00:00.000Z",
      by: pharmacist.userId,
      itemName: "Undone",
      undone: true,
    });

    const { recentDispensing } = await fetchDashboard(pharmacist.client);

    expect(recentDispensing).toHaveLength(DASHBOARD_LIST_LIMIT);
    expect(recentDispensing?.[0]).toMatchObject({
      batches: [
        { batchNumber: "LOT-A", qty: 2 },
        { batchNumber: "LOT-B", qty: 1 },
      ],
      dispensedByName: "Dana Pharmacist",
      itemName: "Item 8",
      qty: 3,
    });
    expect(recentDispensing?.some((row) => row.itemName === "Undone")).toBe(false);
  });
});

describe("GET /api/dashboard — activity", () => {
  it("sums the selected facility month, with Manila month boundaries", async () => {
    const app = await createTestApp();
    const admin = await dashboardActor(app, "admin");
    // 2026-10-31T16:00Z is 1 Nov 00:00 in Manila: November. One second earlier is October.
    insertDispensing(app.sqlite, { at: "2026-10-31T16:00:00.000Z", by: admin.userId, qty: 5 });
    insertDispensing(app.sqlite, { at: "2026-10-31T15:59:59.000Z", by: admin.userId, qty: 100 });
    insertDispensing(app.sqlite, { at: "2026-11-05T01:00:00.000Z", by: admin.userId, qty: 7 });
    insertDispensing(app.sqlite, {
      at: "2026-11-06T01:00:00.000Z",
      by: admin.userId,
      qty: 1000,
      undone: true,
    });
    insertReceive(app.sqlite, { at: "2026-11-02T01:00:00.000Z", qty: 40 });
    insertReceive(app.sqlite, { at: "2026-10-31T15:59:59.000Z", qty: 900 });
    insertDisposal(app.sqlite, { at: "2026-11-09T01:00:00.000Z", by: admin.userId, qty: 3 });
    insertDisposal(app.sqlite, { at: "2026-11-10T01:00:00.000Z", by: admin.userId, qty: 4 });
    insertDisposal(app.sqlite, { at: "2026-12-01T01:00:00.000Z", by: admin.userId, qty: 50 });

    const november = await fetchDashboard(admin.client);
    expect(november.activity).toEqual({
      disposals: { count: 2, units: 7 },
      month: "2026-11",
      unitsDispensed: 12,
      unitsReceived: 40,
    });

    const october = await fetchDashboard(admin.client, "2026-10");
    expect(october.activity).toEqual({
      disposals: { count: 0, units: 0 },
      month: "2026-10",
      unitsDispensed: 100,
      unitsReceived: 900,
    });
  });
});

describe("GET /api/dashboard — empty database", () => {
  it("returns zeros and empty lists", async () => {
    const app = await createTestApp();
    const admin = await dashboardActor(app, "admin");

    const body = await fetchDashboard(admin.client);

    expect(body.totals).toEqual({
      classes: {
        expired: { batches: 0, units: 0 },
        near_expiry: { batches: 0, units: 0 },
        safe: { batches: 0, units: 0 },
        urgent: { batches: 0, units: 0 },
      },
      itemCount: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
    });
    expect(body.expiringThisMonth).toEqual({
      batches: 0,
      items: [],
      month: "2026-11",
      units: 0,
    });
    expect(body.useFirst).toEqual([]);
    expect(body.recentDispensing).toEqual([]);
    expect(body.pendingRequests).toEqual({
      counts: { approved: 0, pending: 0, ready: 0 },
      oldestPending: [],
    });
    expect(body.activity).toEqual({
      disposals: { count: 0, units: 0 },
      month: "2026-11",
      unitsDispensed: 0,
      unitsReceived: 0,
    });
  });
});
