import { describe, expect, it } from "vitest";

import type { AlertBannerDto } from "../shared/schemas/alerts";
import { insertNotification } from "./alerts-helpers";
import { createTestApp, type TestApp } from "./app";
import { insertBatch, insertItem } from "./fixtures";

async function loadBanner(app: TestApp): Promise<AlertBannerDto> {
  const client = await app.loginAs("nurse");
  const response = await client.get<AlertBannerDto>("/api/alerts/banner");
  expect(response.status).toBe(200);
  return response.data;
}

function stockedItem(app: TestApp, expiry: string | null, qty = 10): string {
  const itemId = insertItem(app.sqlite, { name: `Item ${expiry ?? "none"}` });
  insertBatch(app.sqlite, { expiry, itemId, qty });
  return itemId;
}

describe("GET /api/alerts/banner — expiry counts", () => {
  it("counts the boundary days: today and today + urgentDays are urgent, the next day is not", async () => {
    const app = await createTestApp();
    // today = 2026-11-12, urgentDays = 7 → urgent until 2026-11-19.
    stockedItem(app, "2026-11-11"); // expired (yesterday)
    stockedItem(app, "2026-11-12"); // urgent (expires today)
    stockedItem(app, "2026-11-19"); // urgent (last day)
    stockedItem(app, "2026-11-20"); // near expiry, not in the banner
    stockedItem(app, null); // no expiry

    const banner = await loadBanner(app);

    expect(banner.enabled).toBe(true);
    expect(banner.counts).toEqual({ expired: 1, lowStock: 0, urgent: 2 });
    expect(banner.today).toBe("2026-11-12");
    expect(banner.thresholds).toEqual({ nearDays: 30, urgentDays: 7 });
  });

  it("follows the configured urgent threshold", async () => {
    const app = await createTestApp();
    stockedItem(app, "2026-11-20");
    expect((await loadBanner(app)).counts.urgent).toBe(0);

    await app.setSettings({ expiry: { urgentDays: 10 } });

    const banner = await loadBanner(app);
    expect(banner.counts.urgent).toBe(1);
    expect(banner.thresholds.urgentDays).toBe(10);
  });

  it("uses today in the facility timezone, not UTC", async () => {
    // 20:00 UTC on the 12th is already the 13th in Manila (UTC+8) but still the 12th in LA.
    const app = await createTestApp({ now: "2026-11-12T20:00:00.000Z" });
    stockedItem(app, "2026-11-12");

    const manila = await loadBanner(app);
    expect(manila.today).toBe("2026-11-13");
    expect(manila.counts).toEqual({ expired: 1, lowStock: 0, urgent: 0 });

    await app.setSettings({ facility: { timezone: "America/Los_Angeles" } });

    const losAngeles = await loadBanner(app);
    expect(losAngeles.today).toBe("2026-11-12");
    expect(losAngeles.counts).toEqual({ expired: 0, lowStock: 0, urgent: 1 });
  });

  it("ignores empty, disposed and trashed batches and trashed items", async () => {
    const app = await createTestApp();
    const itemId = insertItem(app.sqlite, { name: "Mixed" });
    insertBatch(app.sqlite, { expiry: "2026-11-01", itemId, qty: 0 });
    insertBatch(app.sqlite, {
      expiry: "2026-11-01",
      itemId,
      status: "disposed",
    });
    insertBatch(app.sqlite, { deleted: true, expiry: "2026-11-01", itemId });
    insertBatch(app.sqlite, { expiry: "2026-11-13", itemId, qty: 0 });
    const trashed = insertItem(app.sqlite, { name: "Trashed" });
    insertBatch(app.sqlite, { expiry: "2026-11-01", itemId: trashed });
    app.sqlite
      .prepare("UPDATE items SET deleted_at = ? WHERE id = ?")
      .run("2026-11-10T00:00:00.000Z", trashed);

    const banner = await loadBanner(app);

    expect(banner.counts).toEqual({ expired: 0, lowStock: 0, urgent: 0 });
    expect(banner.topItems).toEqual([]);
  });

  it("counts batches, not items", async () => {
    const app = await createTestApp();
    const itemId = insertItem(app.sqlite, { name: "Two lots" });
    insertBatch(app.sqlite, { expiry: "2026-11-01", itemId });
    insertBatch(app.sqlite, { expiry: "2026-11-02", itemId });

    expect((await loadBanner(app)).counts.expired).toBe(2);
  });
});

describe("GET /api/alerts/banner — low stock", () => {
  it("compares the threshold with AVAILABLE stock, not on-hand", async () => {
    const app = await createTestApp();
    // Only expired stock: on-hand 20 ≥ 10, but nothing can be dispensed.
    const onlyExpired = insertItem(app.sqlite, {
      lowStockThreshold: 10,
      name: "Only expired",
    });
    insertBatch(app.sqlite, {
      expiry: "2026-11-01",
      itemId: onlyExpired,
      qty: 20,
    });
    // Expired + a little good stock.
    const mixed = insertItem(app.sqlite, {
      lowStockThreshold: 10,
      name: "Mixed",
    });
    insertBatch(app.sqlite, { expiry: "2026-11-01", itemId: mixed, qty: 20 });
    insertBatch(app.sqlite, { expiry: "2027-06-01", itemId: mixed, qty: 5 });
    // Plenty available.
    const fine = insertItem(app.sqlite, {
      lowStockThreshold: 10,
      name: "Fine",
    });
    insertBatch(app.sqlite, { expiry: "2027-06-01", itemId: fine, qty: 10 });
    // Exactly at the threshold is NOT low (available < threshold).
    const atLimit = insertItem(app.sqlite, {
      lowStockThreshold: 10,
      name: "At limit",
    });
    insertBatch(app.sqlite, { expiry: null, itemId: atLimit, qty: 10 });
    // No threshold, never alerts.
    const noThreshold = insertItem(app.sqlite, { name: "No threshold" });
    insertBatch(app.sqlite, {
      expiry: "2027-06-01",
      itemId: noThreshold,
      qty: 1,
    });
    // Threshold but no batches at all.
    insertItem(app.sqlite, { lowStockThreshold: 4, name: "Empty shelf" });
    // Disposed / trashed stock is not available either.
    const disposed = insertItem(app.sqlite, {
      lowStockThreshold: 3,
      name: "Disposed",
    });
    insertBatch(app.sqlite, { itemId: disposed, qty: 50, status: "disposed" });

    const banner = await loadBanner(app);

    expect(banner.counts.lowStock).toBe(4);
    const lowNames = banner.topItems
      .filter((item) => item.kind === "low_stock")
      .map((item) => item.itemName);
    expect(lowNames.length).toBeGreaterThan(0);
    expect(lowNames).not.toContain("Fine");
    expect(lowNames).not.toContain("At limit");
    expect(lowNames).not.toContain("No threshold");
  });

  it("does not report a trashed item", async () => {
    const app = await createTestApp();
    const itemId = insertItem(app.sqlite, {
      lowStockThreshold: 5,
      name: "Gone",
    });
    app.sqlite
      .prepare("UPDATE items SET deleted_at = ? WHERE id = ?")
      .run("2026-11-10T00:00:00.000Z", itemId);

    expect((await loadBanner(app)).counts.lowStock).toBe(0);
  });
});

describe("GET /api/alerts/banner — top items", () => {
  it("lists at most three, expired first, then urgent, then low stock", async () => {
    const app = await createTestApp();
    const urgent = insertItem(app.sqlite, {
      name: "Urgent drug",
      strength: "5 mg",
    });
    insertBatch(app.sqlite, {
      batchNumber: "U-1",
      expiry: "2026-11-15",
      itemId: urgent,
    });
    const lowItem = insertItem(app.sqlite, {
      lowStockThreshold: 20,
      name: "Low drug",
      unit: "box",
    });
    insertBatch(app.sqlite, { expiry: null, itemId: lowItem, qty: 5 });
    const expiredOld = insertItem(app.sqlite, { name: "Old expired" });
    insertBatch(app.sqlite, {
      batchNumber: "E-1",
      expiry: "2026-10-01",
      itemId: expiredOld,
    });
    const expiredNew = insertItem(app.sqlite, { name: "New expired" });
    insertBatch(app.sqlite, {
      batchNumber: "E-2",
      expiry: "2026-11-10",
      itemId: expiredNew,
    });

    const banner = await loadBanner(app);

    expect(banner.topItems).toHaveLength(3);
    expect(banner.topItems.map((item) => [item.kind, item.itemName])).toEqual([
      ["expired", "Old expired"],
      ["expired", "New expired"],
      ["urgent", "Urgent drug 5 mg"],
    ]);
    expect(banner.topItems[0]).toMatchObject({
      batchNumber: "E-1",
      daysUntil: -42,
      expiry: "2026-10-01",
    });
    expect(banner.topItems[2]).toMatchObject({ daysUntil: 3 });
    expect(banner.counts).toEqual({ expired: 2, lowStock: 1, urgent: 1 });
  });

  it("describes a low-stock item with available stock and threshold", async () => {
    const app = await createTestApp();
    const itemId = insertItem(app.sqlite, {
      lowStockThreshold: 20,
      name: "Gauze",
      unit: "roll",
    });
    insertBatch(app.sqlite, { expiry: null, itemId, qty: 5 });

    const [top] = (await loadBanner(app)).topItems;

    expect(top).toEqual({
      available: 5,
      batchId: null,
      batchNumber: null,
      daysUntil: null,
      expiry: null,
      itemId,
      itemName: "Gauze",
      kind: "low_stock",
      threshold: 20,
      unit: "roll",
    });
  });
});

describe("GET /api/alerts/banner — settings and unread", () => {
  it("returns enabled:false and empty counts when in-app alerts are off", async () => {
    const app = await createTestApp();
    stockedItem(app, "2026-11-01");
    insertNotification(app.sqlite);
    await app.setSettings({ alerts: { inApp: false } });

    const banner = await loadBanner(app);

    expect(banner.enabled).toBe(false);
    expect(banner.counts).toEqual({ expired: 0, lowStock: 0, urgent: 0 });
    expect(banner.topItems).toEqual([]);
    expect(banner.unreadCount).toBe(0);
  });

  it("reports the caller's unread count", async () => {
    const app = await createTestApp();
    insertNotification(app.sqlite, { id: "a" });
    insertNotification(app.sqlite, { id: "b" });
    const client = await app.loginAs("admin");
    await client.post("/api/alerts/a/read");

    const response = await client.get<AlertBannerDto>("/api/alerts/banner");

    expect(response.data.unreadCount).toBe(1);
  });
});
