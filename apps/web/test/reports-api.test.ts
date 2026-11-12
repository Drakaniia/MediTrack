import { beforeEach, describe, expect, it } from "vitest";

import type {
  ExpiryReportDto,
  StockReportDto,
  StockReportItemDto,
} from "../shared/schemas/reports";
import { actorWithRole, insertMovement } from "./analytics-helpers";
import { createTestApp, type TestApp, type TestClient } from "./app";
import { auditActions, insertBatch, insertCategory, insertItem } from "./fixtures";

let app: TestApp;
let admin: TestClient;

interface Stage {
  amoxBatch: string;
  amoxId: string;
  paraBatch: string;
  paraId: string;
}

/**
 * Manila facility, clock 2026-11-12 10:00 local. Paracetamol batch (qty now 40):
 *   +50 (Sep) · −10 (Oct 5) · −2 (Oct 31 23:30 local) · −8 (Nov 1 00:30 local) · −4/+4 undone · +10 (Nov 5)
 * Amoxicillin batch (qty now 5, expires 2026-10-20): +20 (Sep) · −15 disposed (Nov 2)
 */
function arrange(): Stage {
  const meds = insertCategory(app.sqlite, "Meds");
  const antibiotics = insertCategory(app.sqlite, "Antibiotics");
  const paraId = insertItem(app.sqlite, {
    categoryId: meds,
    lowStockThreshold: 20,
    name: "Paracetamol",
    strength: "500 mg",
  });
  const paraBatch = insertBatch(app.sqlite, {
    batchNumber: "P-1",
    expiry: "2027-01-31",
    itemId: paraId,
    qty: 40,
  });
  const amoxId = insertItem(app.sqlite, {
    categoryId: antibiotics,
    lowStockThreshold: 30,
    name: "Amoxicillin",
  });
  const amoxBatch = insertBatch(app.sqlite, {
    batchNumber: "A-1",
    expiry: "2026-10-20",
    itemId: amoxId,
    qty: 5,
  });
  insertItem(app.sqlite, { categoryId: antibiotics, lowStockThreshold: 5, name: "Ciprofloxacin" });
  insertItem(app.sqlite, { name: "Gloves" });

  const para = { batchId: paraBatch, batchNumber: "P-1", itemId: paraId };
  insertMovement(app.sqlite, { ...para, at: "2026-09-20T02:00:00.000Z", delta: 50, kind: "receive" });
  insertMovement(app.sqlite, { ...para, at: "2026-10-05T02:00:00.000Z", delta: -10, kind: "dispense" });
  insertMovement(app.sqlite, { ...para, at: "2026-10-31T15:30:00.000Z", delta: -2, kind: "dispense" });
  insertMovement(app.sqlite, { ...para, at: "2026-10-31T16:30:00.000Z", delta: -8, kind: "dispense" });
  insertMovement(app.sqlite, { ...para, at: "2026-11-03T02:00:00.000Z", delta: -4, kind: "dispense" });
  insertMovement(app.sqlite, { ...para, at: "2026-11-03T02:05:00.000Z", delta: 4, kind: "undo_dispense" });
  insertMovement(app.sqlite, { ...para, at: "2026-11-05T02:00:00.000Z", delta: 10, kind: "receive" });
  const amox = { batchId: amoxBatch, batchNumber: "A-1", itemId: amoxId };
  insertMovement(app.sqlite, { ...amox, at: "2026-09-21T02:00:00.000Z", delta: 20, kind: "receive" });
  insertMovement(app.sqlite, { ...amox, at: "2026-11-02T02:00:00.000Z", delta: -15, kind: "dispose" });
  return { amoxBatch, amoxId, paraBatch, paraId };
}

async function stock(month?: string): Promise<StockReportDto> {
  const response = await admin.get<StockReportDto>("/api/reports/stock", { month });
  if (response.status !== 200) {
    throw new Error(`stock report failed: ${response.status} ${response.error?.message}`);
  }
  return response.data;
}

async function expiry(month?: string): Promise<ExpiryReportDto> {
  const response = await admin.get<ExpiryReportDto>("/api/reports/expiry", { month });
  if (response.status !== 200) {
    throw new Error(`expiry report failed: ${response.status} ${response.error?.message}`);
  }
  return response.data;
}

function itemNamed(report: StockReportDto, name: string): StockReportItemDto {
  const found = report.categories
    .flatMap((category) => category.items)
    .find((item) => item.name === name);
  if (!found) {
    throw new Error(`No item ${name} in the report`);
  }
  return found;
}

beforeEach(async () => {
  app = await createTestApp();
  admin = (await actorWithRole(app, "admin")).client;
});

describe("report access and month validation", () => {
  it("allows admin, inventory, pharmacist and health_admin; refuses nurse and anonymous", async () => {
    for (const path of ["/api/reports/stock", "/api/reports/expiry"]) {
      for (const role of ["admin", "inventory", "pharmacist", "health_admin"] as const) {
        const { client } = await actorWithRole(app, role);
        expect((await client.get(path)).status).toBe(200);
      }
      const nurse = await actorWithRole(app, "nurse");
      expect((await nurse.client.get(path)).status).toBe(403);
      expect((await app.anonymous.get(path)).status).toBe(401);
    }
  });

  it("lets only admin and health_admin export; viewers, nurse and anonymous are refused", async () => {
    for (const path of ["/api/reports/stock/export", "/api/reports/expiry/export"]) {
      for (const role of ["admin", "health_admin"] as const) {
        const { client } = await actorWithRole(app, role);
        expect((await client.get(path, { format: "pdf" })).status).toBe(200);
      }
      for (const role of ["inventory", "pharmacist", "nurse"] as const) {
        const { client } = await actorWithRole(app, role);
        const response = await client.get(path, { format: "pdf" });
        expect(response.status).toBe(403);
        expect(response.error?.code).toBe("forbidden");
      }
      expect((await app.anonymous.get(path, { format: "pdf" })).status).toBe(401);
    }
  });

  it("returns the same payload as the view route and audits every export", async () => {
    arrange();
    const before = auditActions(app.sqlite).length;
    const exported = await admin.get<StockReportDto>("/api/reports/stock/export", {
      format: "xlsx",
      month: "2026-10",
    });
    expect(exported.status).toBe(200);
    expect(exported.data).toEqual(await stock("2026-10"));
    expect((await admin.get("/api/reports/expiry/export", { format: "pdf" })).status).toBe(200);

    const rows = app.sqlite
      .prepare("SELECT action, entity_type, entity_id, summary, after FROM audit_log WHERE action = 'report.export' ORDER BY id")
      .all() as { action: string; after: string; entity_id: string; entity_type: string; summary: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      entity_id: "2026-10",
      entity_type: "report",
      summary: "Exported the stock report for 2026-10 (XLSX)",
    });
    expect(JSON.parse(rows[0].after)).toEqual({ format: "xlsx", kind: "stock", month: "2026-10" });
    expect(rows[1].summary).toBe("Exported the expiry report for 2026-11 (PDF)");
    // Viewing on screen is not an export and writes nothing.
    expect(auditActions(app.sqlite).length).toBe(before + 2);
  });

  it("requires a known export format", async () => {
    for (const format of [undefined, "csv", "PDF"]) {
      const response = await admin.get("/api/reports/stock/export", { format });
      expect(response.status).toBe(400);
      expect(response.error?.code).toBe("validation_error");
    }
  });

  it("rejects anything but YYYY-MM with 400", async () => {
    for (const month of ["2026-13", "2026-1", "2026-10-05", "october", "1800-01"]) {
      const response = await admin.get("/api/reports/stock", { month });
      expect(response.status).toBe(400);
      expect(response.error?.code).toBe("validation_error");
      expect((await admin.get("/api/reports/expiry", { month })).status).toBe(400);
    }
  });

  it("defaults to the current facility month and carries the header fields", async () => {
    app.clock.set("2026-11-30T17:00:00.000Z"); // 1 Dec 01:00 in Manila
    admin = (await actorWithRole(app, "admin")).client; // the old session expired with the jump
    await app.setSettings({ facility: { name: "Rural Health Unit 1" } });
    const report = await stock();
    expect(report).toMatchObject({
      asOf: "2026-12-01",
      facilityName: "Rural Health Unit 1",
      generatedAt: "2026-11-30T17:00:00.000Z",
      month: "2026-12",
      monthEnd: "2026-12-31",
      monthStart: "2026-12-01",
      thresholds: { nearDays: 30, urgentDays: 7 },
      timezone: "Asia/Manila",
      today: "2026-12-01",
    });
  });
});

describe("stock report", () => {
  it("reconstructs opening and closing for a past month around the Manila month boundary", async () => {
    const { paraId } = arrange();
    const report = await stock("2026-10");
    expect(report.asOf).toBe("2026-10-31");
    const para = itemNamed(report, "Paracetamol");
    expect(para).toMatchObject({
      closingQty: 38,
      dispensed: 12,
      disposed: 0,
      itemId: paraId,
      onHand: 38,
      openingQty: 50,
      received: 0,
      status: "in_stock",
      threshold: 20,
    });
    expect(para.byBatch).toEqual([
      {
        adjusted: 0,
        batchId: expect.any(String),
        batchNumber: "P-1",
        closingQty: 38,
        dispensed: 12,
        disposed: 0,
        expiry: "2027-01-31",
        expiryClass: "safe",
        openingQty: 50,
        received: 0,
      },
    ]);
  });

  it("reports the current month with the net of an undone deduct and per-batch disposals", async () => {
    arrange();
    const report = await stock("2026-11");
    expect(report.asOf).toBe("2026-11-12");
    const para = itemNamed(report, "Paracetamol");
    expect(para).toMatchObject({
      closingQty: 40,
      dispensed: 8,
      openingQty: 38,
      received: 10,
    });
    const amox = itemNamed(report, "Amoxicillin");
    expect(amox).toMatchObject({
      available: 0,
      closingQty: 5,
      disposed: 15,
      onHand: 5,
      openingQty: 20,
      status: "out",
    });
    expect(amox.classCounts.expired).toEqual({ batches: 1, units: 5 });
    expect(amox.byBatch[0]).toMatchObject({ batchNumber: "A-1", disposed: 15, expiryClass: "expired" });
  });

  it("classifies a past month as of its last day and keeps then-held stock", async () => {
    arrange();
    const amox = itemNamed(await stock("2026-10"), "Amoxicillin");
    // Held 20 units on 31 Oct (the disposal came later), already past its 20 Oct expiry.
    expect(amox).toMatchObject({ available: 0, closingQty: 20, onHand: 20, status: "out" });
    expect(amox.classCounts.expired).toEqual({ batches: 1, units: 20 });
    expect(amox.nearestExpiry).toBeNull();
    const para = itemNamed(await stock("2026-10"), "Paracetamol");
    expect(para.nearestExpiry).toBe("2027-01-31");
  });

  it("groups by category in order with Uncategorized last, items by name", async () => {
    arrange();
    const report = await stock("2026-10");
    expect(report.categories.map((category) => category.name)).toEqual([
      "Antibiotics",
      "Meds",
      "Uncategorized",
    ]);
    expect(report.categories[0].items.map((item) => item.name)).toEqual(["Amoxicillin", "Ciprofloxacin"]);
    expect(report.categories[2].categoryId).toBeNull();
    expect(itemNamed(report, "Ciprofloxacin").status).toBe("out");
    expect(itemNamed(report, "Gloves")).toMatchObject({ onHand: 0, status: "in_stock" });
  });

  it("fills the summary block", async () => {
    arrange();
    const { summary } = await stock("2026-10");
    expect(summary).toMatchObject({
      categories: 3,
      dispensed: 12,
      disposed: 0,
      lowStockItems: 2,
      lowStockOut: 2,
      medicines: 4,
      received: 0,
      units: 58,
    });
    expect(summary.classes.safe).toEqual({ batches: 1, units: 38 });
    expect(summary.classes.expired).toEqual({ batches: 1, units: 20 });
  });

  it("handles an empty month and a future month", async () => {
    arrange();
    const empty = await stock("2026-01");
    expect(empty.summary).toMatchObject({ dispensed: 0, medicines: 4, received: 0, units: 0 });
    expect(itemNamed(empty, "Paracetamol").byBatch).toEqual([]);
    const future = await stock("2027-03");
    expect(future.asOf).toBe("2026-11-12");
    expect(itemNamed(future, "Paracetamol")).toMatchObject({ closingQty: 40, dispensed: 0, openingQty: 40 });
  });

  it("skips trashed items and batches", async () => {
    const itemId = insertItem(app.sqlite, { name: "Kept" });
    insertBatch(app.sqlite, { itemId, qty: 5 });
    insertBatch(app.sqlite, { deleted: true, itemId, qty: 50 });
    app.sqlite.prepare("UPDATE items SET deleted_at = ? WHERE id = ?").run("2026-11-01T00:00:00.000Z", insertItem(app.sqlite, { name: "Gone" }));
    const report = await stock("2026-11");
    expect(report.categories.flatMap((category) => category.items.map((item) => item.name))).toEqual(["Kept"]);
    expect(itemNamed(report, "Kept").onHand).toBe(5);
  });
});

describe("expiry report", () => {
  function arrangeExpiryBatches(itemId: string): void {
    insertBatch(app.sqlite, { batchNumber: "OLD", expiry: "2026-08-31", itemId, qty: 3 });
    insertBatch(app.sqlite, { batchNumber: "EDGE", expiry: "2026-10-31", itemId, qty: 6 });
    insertBatch(app.sqlite, { batchNumber: "NEXT", expiry: "2026-11-01", itemId, qty: 9 });
  }

  it("lists in-month and earlier-expired batches with classes at month end", async () => {
    const { paraId } = arrange();
    arrangeExpiryBatches(paraId);
    const report = await expiry("2026-10");
    expect(report.rows.map((row) => [row.batchNumber, row.section, row.qty])).toEqual([
      ["A-1", "expiring", 20],
      ["EDGE", "expiring", 6],
      ["OLD", "expired", 3],
    ]);
    const edge = report.rows[1];
    expect(edge).toMatchObject({
      classAtMonthEnd: "urgent",
      classNow: "urgent",
      daysUntilMonthEnd: 0,
      itemName: "Paracetamol 500 mg",
      categoryName: "Meds",
    });
    expect(report.rows[0]).toMatchObject({ classAtMonthEnd: "expired", daysUntilMonthEnd: -11, openingQty: 20 });
    expect(report.rows[2].daysUntilMonthEnd).toBe(-61);
    expect(report.summary.expiring).toEqual({ batches: 2, units: 26 });
    expect(report.summary.expired).toEqual({ batches: 1, units: 3 });
    expect(report.summary.total).toEqual({ batches: 3, units: 29 });
    expect(report.summary.classes.expired).toEqual({ batches: 2, units: 23 });
    expect(report.summary.classes.urgent).toEqual({ batches: 1, units: 6 });
  });

  it("evaluates the current month as of today but classifies at month end", async () => {
    const { paraId } = arrange();
    insertBatch(app.sqlite, { batchNumber: "SOON", expiry: "2026-11-15", itemId: paraId, qty: 4 });
    const report = await expiry();
    const soon = report.rows.find((row) => row.batchNumber === "SOON");
    expect(soon).toMatchObject({
      classAtMonthEnd: "expired",
      classNow: "urgent",
      daysUntilMonthEnd: -15,
      daysUntilNow: 3,
      section: "expiring",
    });
    expect(report.rows.find((row) => row.batchNumber === "A-1")).toMatchObject({
      disposed: 15,
      qty: 5,
    });
  });

  it("is empty for a month with nothing expiring", async () => {
    arrange();
    const report = await expiry("2026-03");
    expect(report.rows).toEqual([]);
    expect(report.summary.total).toEqual({ batches: 0, units: 0 });
  });
});
