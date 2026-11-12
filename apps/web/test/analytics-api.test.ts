import { beforeEach, describe, expect, it } from "vitest";

import type { AnalyticsDto } from "../shared/schemas/analytics";
import { createTestApp, type TestApp, type TestClient } from "./app";
import {
  actorWithRole,
  insertDispensingRecord,
  insertMovement,
  insertQueueRequest,
} from "./analytics-helpers";
import { insertBatch, insertCategory, insertItem } from "./fixtures";

let app: TestApp;
let admin: TestClient;
let adminId: string;

async function fetchAnalytics(
  query: Record<string, string> = {}
): Promise<AnalyticsDto> {
  const response = await admin.get<AnalyticsDto>("/api/analytics", query);
  if (response.status !== 200) {
    throw new Error(`analytics failed: ${response.status} ${response.error?.message}`);
  }
  return response.data;
}

beforeEach(async () => {
  app = await createTestApp();
  const actor = await actorWithRole(app, "admin");
  admin = actor.client;
  adminId = actor.userId;
});

describe("GET /api/analytics access and range", () => {
  it("allows admin, inventory, pharmacist and health_admin; refuses nurse and anonymous", async () => {
    for (const role of ["admin", "inventory", "pharmacist", "health_admin"] as const) {
      const { client } = await actorWithRole(app, role);
      expect((await client.get("/api/analytics")).status).toBe(200);
    }
    const nurse = await actorWithRole(app, "nurse");
    expect((await nurse.client.get("/api/analytics")).status).toBe(403);
    expect((await app.anonymous.get("/api/analytics")).status).toBe(401);
  });

  it("defaults to the last 30 facility days", async () => {
    const data = await fetchAnalytics();
    expect(data.range).toEqual({ days: 30, from: "2026-10-14", to: "2026-11-12" });
    expect(data.timezone).toBe("Asia/Manila");
    expect(data.stockMovement.days).toHaveLength(30);
  });

  it("rejects bad ranges with 400", async () => {
    const reversed = await admin.get("/api/analytics", { from: "2026-11-10", to: "2026-11-01" });
    expect(reversed.status).toBe(400);
    expect(reversed.error?.code).toBe("validation_error");
    expect((await admin.get("/api/analytics", { from: "2025-01-01", to: "2026-11-12" })).status).toBe(400);
    expect((await admin.get("/api/analytics", { from: "nope" })).status).toBe(400);
    expect((await admin.get("/api/analytics", { from: "2026-02-30" })).status).toBe(400);
  });

  it("accepts exactly 366 days", async () => {
    const data = await fetchAnalytics({ from: "2025-11-12", to: "2026-11-12" });
    expect(data.range.days).toBe(366);
    expect(data.stockMovement.days).toHaveLength(366);
  });
});

describe("stockMovement", () => {
  it("assigns movements to Manila days and zero-fills the rest", async () => {
    const itemId = insertItem(app.sqlite, { name: "Gauze" });
    const batchId = insertBatch(app.sqlite, { itemId });
    const base = { batchId, itemId };
    // 2026-11-11T15:59:59Z is 23:59:59 on 11 Nov in Manila; one second later it is 12 Nov.
    insertMovement(app.sqlite, { ...base, at: "2026-11-11T15:59:59.000Z", delta: 5, kind: "receive" });
    insertMovement(app.sqlite, { ...base, at: "2026-11-11T16:00:00.000Z", delta: 7, kind: "receive" });
    insertMovement(app.sqlite, { ...base, at: "2026-11-12T01:00:00.000Z", delta: -3, kind: "dispense" });
    insertMovement(app.sqlite, { ...base, at: "2026-11-12T01:30:00.000Z", delta: -2, kind: "dispose" });
    insertMovement(app.sqlite, { ...base, at: "2026-11-12T01:45:00.000Z", delta: -1, kind: "adjust" });
    const data = await fetchAnalytics({ from: "2026-11-10", to: "2026-11-12" });
    expect(data.stockMovement.days).toEqual([
      { adjusted: 0, date: "2026-11-10", dispensed: 0, disposed: 0, received: 0 },
      { adjusted: 0, date: "2026-11-11", dispensed: 0, disposed: 0, received: 5 },
      { adjusted: -1, date: "2026-11-12", dispensed: 3, disposed: 2, received: 7 },
    ]);
  });

  it("nets an undone quick deduct out of dispensed", async () => {
    const itemId = insertItem(app.sqlite);
    const batchId = insertBatch(app.sqlite, { itemId });
    insertMovement(app.sqlite, { at: "2026-11-12T01:00:00.000Z", batchId, delta: -4, itemId, kind: "dispense" });
    insertMovement(app.sqlite, { at: "2026-11-12T01:01:00.000Z", batchId, delta: 4, itemId, kind: "undo_dispense" });
    const data = await fetchAnalytics({ from: "2026-11-12", to: "2026-11-12" });
    expect(data.stockMovement.days[0].dispensed).toBe(0);
    expect(data.usage.slices).toEqual([]);
    expect(data.topDispensed).toEqual([]);
  });

  it("ignores movements outside the range", async () => {
    const itemId = insertItem(app.sqlite);
    insertMovement(app.sqlite, { at: "2026-11-09T10:00:00.000Z", delta: 9, itemId, kind: "receive" });
    const data = await fetchAnalytics({ from: "2026-11-10", to: "2026-11-11" });
    expect(data.stockMovement.days.map((day) => day.received)).toEqual([0, 0]);
  });

  it("filters by category", async () => {
    const meds = insertCategory(app.sqlite, "Meds");
    const supplies = insertCategory(app.sqlite, "Supplies");
    const med = insertItem(app.sqlite, { categoryId: meds });
    const gauze = insertItem(app.sqlite, { categoryId: supplies });
    const at = "2026-11-12T01:00:00.000Z";
    insertMovement(app.sqlite, { at, delta: 10, itemId: med, kind: "receive" });
    insertMovement(app.sqlite, { at, delta: 4, itemId: gauze, kind: "receive" });
    const all = await fetchAnalytics({ from: "2026-11-12", to: "2026-11-12" });
    const onlyMeds = await fetchAnalytics({ categoryId: meds, from: "2026-11-12", to: "2026-11-12" });
    expect(all.stockMovement.days[0].received).toBe(14);
    expect(onlyMeds.stockMovement.days[0].received).toBe(10);
    expect(onlyMeds.categoryId).toBe(meds);
  });
});

describe("usage and topDispensed", () => {
  it("groups dispensed units by category and ranks items with per-batch counts", async () => {
    const meds = insertCategory(app.sqlite, "Meds");
    const para = insertItem(app.sqlite, { categoryId: meds, name: "Paracetamol", strength: "500 mg", unit: "tab" });
    const amox = insertItem(app.sqlite, { categoryId: meds, name: "Amoxicillin" });
    const loose = insertItem(app.sqlite, { name: "Gloves" });
    const at = "2026-11-12T01:00:00.000Z";
    const dispense = (itemId: string, batchNumber: string, qty: number): void =>
      insertMovement(app.sqlite, { at, batchNumber, delta: -qty, itemId, itemName: "x", kind: "dispense" });
    dispense(para, "P-1", 10);
    dispense(para, "P-2", 5);
    dispense(amox, "A-1", 6);
    dispense(loose, "G-1", 20);
    const data = await fetchAnalytics({ from: "2026-11-12", to: "2026-11-12" });
    expect(data.usage.totalUnits).toBe(41);
    expect(data.usage.slices.map((slice) => [slice.name, slice.units])).toEqual([
      ["Meds", 21],
      ["Uncategorized", 20],
    ]);
    expect(data.topDispensed.map((item) => [item.name, item.units, item.batchCount])).toEqual([
      ["Gloves", 20, 1],
      ["Paracetamol 500 mg", 15, 2],
      ["Amoxicillin", 6, 1],
    ]);
    expect(data.topDispensed[1].batches).toEqual([
      { batchNumber: "P-1", units: 10 },
      { batchNumber: "P-2", units: 5 },
    ]);
    expect(data.topDispensed[1].unit).toBe("tab");
  });

  it("keeps only the ten biggest items", async () => {
    const at = "2026-11-12T01:00:00.000Z";
    for (let index = 1; index <= 12; index += 1) {
      const itemId = insertItem(app.sqlite, { name: `Item ${String(index).padStart(2, "0")}` });
      insertMovement(app.sqlite, { at, delta: -index, itemId, kind: "dispense" });
    }
    const data = await fetchAnalytics({ from: "2026-11-12", to: "2026-11-12" });
    expect(data.topDispensed).toHaveLength(10);
    expect(data.topDispensed[0].units).toBe(12);
    expect(data.topDispensed.at(-1)?.units).toBe(3);
  });
});

describe("expiryTimeline", () => {
  it("lists 12 zero-filled months with the class split and an earlier bucket", async () => {
    const meds = insertCategory(app.sqlite, "Meds");
    const itemId = insertItem(app.sqlite, { categoryId: meds });
    const other = insertItem(app.sqlite);
    // today = 2026-11-12; urgent ≤ 7d (to 11-19), near ≤ 30d (to 12-12).
    insertBatch(app.sqlite, { batchNumber: "OLD", expiry: "2026-09-30", itemId, qty: 2 });
    insertBatch(app.sqlite, { batchNumber: "EXP", expiry: "2026-11-05", itemId, qty: 3 });
    insertBatch(app.sqlite, { batchNumber: "URG", expiry: "2026-11-15", itemId, qty: 4 });
    insertBatch(app.sqlite, { batchNumber: "NEAR", expiry: "2026-12-01", itemId, qty: 5 });
    insertBatch(app.sqlite, { batchNumber: "SAFE", expiry: "2026-12-20", itemId, qty: 6 });
    insertBatch(app.sqlite, { batchNumber: "LATE", expiry: "2027-10-31", itemId, qty: 7 });
    insertBatch(app.sqlite, { batchNumber: "BEYOND", expiry: "2027-11-01", itemId, qty: 8 });
    insertBatch(app.sqlite, { batchNumber: "EMPTY", expiry: "2026-11-20", itemId, qty: 0 });
    insertBatch(app.sqlite, { batchNumber: "TRASH", deleted: true, expiry: "2026-11-20", itemId, qty: 9 });
    insertBatch(app.sqlite, { batchNumber: "OTHER", expiry: "2026-11-25", itemId: other, qty: 10 });
    insertBatch(app.sqlite, { batchNumber: "NOEXP", expiry: null, itemId, qty: 11 });
    const data = await fetchAnalytics();
    const { months, earlier } = data.expiryTimeline;
    expect(months).toHaveLength(12);
    expect(months[0].month).toBe("2026-11");
    expect(months[11].month).toBe("2027-10");
    expect(earlier).toEqual({ batches: 1, units: 2 });
    expect(months[0].classes.expired).toEqual({ batches: 1, units: 3 });
    expect(months[0].classes.urgent).toEqual({ batches: 1, units: 4 });
    expect(months[0].classes.near_expiry).toEqual({ batches: 1, units: 10 });
    expect(months[0].batches).toBe(3);
    expect(months[1].classes.near_expiry).toEqual({ batches: 1, units: 5 });
    expect(months[1].classes.safe).toEqual({ batches: 1, units: 6 });
    expect(months[11]).toMatchObject({ batches: 1, units: 7 });
    expect(months[5]).toMatchObject({ batches: 0, units: 0 });
    const filtered = await fetchAnalytics({ categoryId: meds });
    expect(filtered.expiryTimeline.months[0].batches).toBe(2);
  });
});

describe("lowStockTrend", () => {
  it("reconstructs the daily count from the ledger", async () => {
    const itemA = insertItem(app.sqlite, { lowStockThreshold: 10, name: "A" });
    const batchA = insertBatch(app.sqlite, { expiry: "2027-06-01", itemId: itemA, qty: 4 });
    insertMovement(app.sqlite, { at: "2026-11-01T02:00:00.000Z", batchId: batchA, delta: 20, itemId: itemA, kind: "receive" });
    insertMovement(app.sqlite, { at: "2026-11-08T02:00:00.000Z", batchId: batchA, delta: -16, itemId: itemA, kind: "dispense" });
    const itemB = insertItem(app.sqlite, { lowStockThreshold: 5, name: "B" });
    const batchB = insertBatch(app.sqlite, { expiry: "2027-06-01", itemId: itemB, qty: 0 });
    insertMovement(app.sqlite, { at: "2026-11-09T02:00:00.000Z", batchId: batchB, delta: 3, itemId: itemB, kind: "receive" });
    insertMovement(app.sqlite, { at: "2026-11-11T02:00:00.000Z", batchId: batchB, delta: -3, itemId: itemB, kind: "dispense" });
    insertItem(app.sqlite, { lowStockThreshold: 0, name: "Untracked" });
    const data = await fetchAnalytics({ from: "2026-11-06", to: "2026-11-12" });
    expect(data.lowStockTrend.itemsTracked).toBe(2);
    expect(data.lowStockTrend.days.map((day) => day.underThreshold)).toEqual([1, 1, 2, 2, 2, 2, 2]);
    expect(data.lowStockTrend.days.map((day) => day.out)).toEqual([1, 1, 1, 0, 0, 1, 1]);
  });

  it("counts a batch as unavailable from the day after it expires", async () => {
    const itemId = insertItem(app.sqlite, { lowStockThreshold: 10 });
    insertBatch(app.sqlite, { expiry: "2026-11-09", itemId, qty: 20 });
    const data = await fetchAnalytics({ from: "2026-11-08", to: "2026-11-11" });
    expect(data.lowStockTrend.days.map((day) => day.out)).toEqual([0, 0, 1, 1]);
  });

  it("respects the category filter", async () => {
    const meds = insertCategory(app.sqlite, "Meds");
    insertItem(app.sqlite, { categoryId: meds, lowStockThreshold: 5 });
    insertItem(app.sqlite, { lowStockThreshold: 5 });
    const data = await fetchAnalytics({ categoryId: meds, from: "2026-11-12", to: "2026-11-12" });
    expect(data.lowStockTrend.itemsTracked).toBe(1);
  });
});

describe("dispensedVsRequested", () => {
  it("buckets by Monday-start week and ignores cancelled and quick-deduct rows", async () => {
    const itemId = insertItem(app.sqlite);
    // 2026-11-09 is a Monday. 2026-11-08T16:30Z = Mon 00:30 in Manila.
    insertQueueRequest(app.sqlite, { itemId, qty: 10, submittedAt: "2026-11-08T16:30:00.000Z" });
    insertQueueRequest(app.sqlite, { itemId, qty: 4, status: "denied", submittedAt: "2026-11-10T01:00:00.000Z" });
    insertQueueRequest(app.sqlite, { itemId, qty: 99, status: "cancelled", submittedAt: "2026-11-10T01:00:00.000Z" });
    insertQueueRequest(app.sqlite, { itemId, qty: 50, source: "quick_deduct", submittedAt: "2026-11-10T01:00:00.000Z" });
    insertQueueRequest(app.sqlite, { itemId, qty: 6, submittedAt: "2026-11-08T15:00:00.000Z" });
    insertDispensingRecord(app.sqlite, { at: "2026-11-10T03:00:00.000Z", by: adminId, itemId, qty: 8 });
    insertDispensingRecord(app.sqlite, { at: "2026-11-10T03:00:00.000Z", by: adminId, itemId, qty: 20, undone: true });
    insertDispensingRecord(app.sqlite, { at: "2026-11-10T03:00:00.000Z", by: adminId, itemId, qty: 30, source: "quick_deduct" });
    const data = await fetchAnalytics({ from: "2026-11-02", to: "2026-11-12" });
    expect(data.dispensedVsRequested.granularity).toBe("week");
    expect(data.dispensedVsRequested.buckets).toEqual([
      { dispensed: 0, from: "2026-11-02", requested: 6, to: "2026-11-08" },
      { dispensed: 8, from: "2026-11-09", requested: 14, to: "2026-11-12" },
    ]);
  });

  it("uses calendar months for long ranges and the category filter", async () => {
    const meds = insertCategory(app.sqlite, "Meds");
    const med = insertItem(app.sqlite, { categoryId: meds });
    const other = insertItem(app.sqlite);
    insertQueueRequest(app.sqlite, { itemId: med, qty: 5, submittedAt: "2026-09-15T01:00:00.000Z" });
    insertQueueRequest(app.sqlite, { itemId: other, qty: 7, submittedAt: "2026-09-15T01:00:00.000Z" });
    const all = await fetchAnalytics({ from: "2026-08-15", to: "2026-11-12" });
    expect(all.dispensedVsRequested.granularity).toBe("month");
    expect(all.dispensedVsRequested.buckets.map((bucket) => bucket.requested)).toEqual([0, 12, 0, 0]);
    const filtered = await fetchAnalytics({ categoryId: meds, from: "2026-08-15", to: "2026-11-12" });
    expect(filtered.dispensedVsRequested.buckets.map((bucket) => bucket.requested)).toEqual([0, 5, 0, 0]);
    expect(all.dispensedVsRequested.buckets[0]).toMatchObject({ from: "2026-08-15", to: "2026-08-31" });
  });
});
