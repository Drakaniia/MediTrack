import { describe, expect, it } from "vitest";

import type {
  LowStockRowDto,
  ThresholdResultDto,
} from "../shared/schemas/expiry";
import { createTestApp, type TestApp, type TestClient } from "./app";
import { auditOf, day } from "./expiry-helpers";
import { insertBatch, insertCategory, insertItem } from "./fixtures";

interface Arranged {
  admin: TestClient;
  app: TestApp;
}

async function arrange(): Promise<Arranged> {
  const app = await createTestApp();
  return { admin: await app.loginAs("admin"), app };
}

async function lowStock(
  client: TestClient,
  query: Record<string, string | number> = {}
): Promise<LowStockRowDto[]> {
  const response = await client.get<LowStockRowDto[]>("/api/low-stock", query);
  expect(response.status).toBe(200);
  return response.data;
}

function thresholdOf(app: TestApp, itemId: string): number {
  const row = app.sqlite
    .prepare("SELECT low_stock_threshold AS value FROM items WHERE id = ?")
    .get(itemId) as { value: number };
  return row.value;
}

describe("GET /api/low-stock", () => {
  it("compares AVAILABLE stock (expired does not count) with the threshold", async () => {
    const { admin, app } = await arrange();
    const itemId = insertItem(app.sqlite, {
      lowStockThreshold: 10,
      name: "Amoxicillin",
      strength: "500 mg",
      supplier: "MediSupply",
      unit: "cap",
    });
    insertBatch(app.sqlite, {
      batchNumber: "OK",
      expiry: day(60),
      itemId,
      qty: 4,
    });
    insertBatch(app.sqlite, {
      batchNumber: "EXPIRED",
      expiry: day(-1),
      itemId,
      qty: 20,
    });

    const rows = await lowStock(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      available: 4,
      categoryId: null,
      categoryName: null,
      displayName: "Amoxicillin 500 mg",
      gap: 6,
      itemId,
      lowStockThreshold: 10,
      name: "Amoxicillin",
      nearestExpiry: day(60),
      onHand: 24,
      status: "low",
      strength: "500 mg",
      suggestedReorderQty: 16,
      supplier: "MediSupply",
      unit: "cap",
    });
  });

  it("reports items with only expired or no stock as out", async () => {
    const { admin, app } = await arrange();
    const expiredOnly = insertItem(app.sqlite, {
      lowStockThreshold: 5,
      name: "Expired only",
    });
    insertBatch(app.sqlite, { expiry: day(-3), itemId: expiredOnly, qty: 50 });
    const nothing = insertItem(app.sqlite, {
      lowStockThreshold: 5,
      name: "No batches",
    });

    const rows = await lowStock(admin, { sort: "item" });
    expect(rows.map((row) => [row.itemId, row.status, row.available])).toEqual([
      [expiredOnly, "out", 0],
      [nothing, "out", 0],
    ]);
    expect(rows[0]).toMatchObject({ nearestExpiry: null, onHand: 50 });
  });

  it("never alerts for threshold 0, at or above the threshold, or trashed items", async () => {
    const { admin, app } = await arrange();
    const noAlert = insertItem(app.sqlite, {
      lowStockThreshold: 0,
      name: "No alert",
    });
    insertBatch(app.sqlite, { expiry: day(60), itemId: noAlert, qty: 0 });
    const exactly = insertItem(app.sqlite, {
      lowStockThreshold: 5,
      name: "Exactly",
    });
    insertBatch(app.sqlite, { expiry: day(60), itemId: exactly, qty: 5 });
    const trashed = insertItem(app.sqlite, {
      lowStockThreshold: 5,
      name: "Trashed",
    });
    app.sqlite
      .prepare(
        "UPDATE items SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?"
      )
      .run(trashed);
    const disposed = insertItem(app.sqlite, {
      lowStockThreshold: 5,
      name: "Disposed",
    });
    insertBatch(app.sqlite, {
      expiry: day(60),
      itemId: disposed,
      qty: 0,
      status: "disposed",
    });

    const rows = await lowStock(admin);
    expect(rows.map((row) => row.name)).toEqual(["Disposed"]);
  });

  it("counts same-day expiry as available", async () => {
    const { admin, app } = await arrange();
    const itemId = insertItem(app.sqlite, {
      lowStockThreshold: 5,
      name: "Today",
    });
    insertBatch(app.sqlite, { expiry: day(0), itemId, qty: 5 });
    expect(await lowStock(admin)).toHaveLength(0);
  });

  it("filters by status, category and search, and sorts", async () => {
    const { admin, app } = await arrange();
    const cat = insertCategory(app.sqlite, "Antibiotics");
    const low = insertItem(app.sqlite, {
      categoryId: cat,
      lowStockThreshold: 10,
      name: "Alpha",
      sku: "SKU-ALPHA",
    });
    insertBatch(app.sqlite, { expiry: day(90), itemId: low, qty: 8 });
    const out = insertItem(app.sqlite, {
      lowStockThreshold: 30,
      name: "Bravo",
      supplier: "Acme",
    });
    const worse = insertItem(app.sqlite, {
      lowStockThreshold: 20,
      name: "Charlie",
    });
    insertBatch(app.sqlite, { expiry: day(90), itemId: worse, qty: 1 });

    expect((await lowStock(admin)).map((row) => row.name)).toEqual([
      "Bravo",
      "Charlie",
      "Alpha",
    ]);
    expect(
      (await lowStock(admin, { status: "out" })).map((row) => row.name)
    ).toEqual(["Bravo"]);
    expect(
      (await lowStock(admin, { dir: "desc", sort: "gap", status: "low" })).map(
        (row) => row.name
      )
    ).toEqual(["Charlie", "Alpha"]);
    expect(
      (await lowStock(admin, { categoryId: cat })).map((row) => row.name)
    ).toEqual(["Alpha"]);
    expect(
      (await lowStock(admin, { search: "sku-alpha" })).map((row) => row.name)
    ).toEqual(["Alpha"]);
    expect(
      (await lowStock(admin, { search: "acme" })).map((row) => row.itemId)
    ).toEqual([out]);
    expect(
      (await lowStock(admin, { dir: "desc", sort: "available" })).map(
        (row) => row.name
      )
    ).toEqual(["Alpha", "Charlie", "Bravo"]);

    const paged = await admin.get<LowStockRowDto[]>("/api/low-stock", {
      limit: 1,
    });
    expect(paged.data).toHaveLength(1);
    expect(paged.body).toMatchObject({ meta: { limit: 1, total: 3 } });
  });

  it("is readable by every role", async () => {
    const { app } = await arrange();
    for (const role of [
      "nurse",
      "health_admin",
      "pharmacist",
      "inventory",
    ] as const) {
      expect(
        (await (await app.loginAs(role)).get("/api/low-stock")).status
      ).toBe(200);
    }
  });

  it("rejects bad query values", async () => {
    const { admin } = await arrange();
    expect(
      (await admin.get("/api/low-stock", { status: "in_stock" })).status
    ).toBe(400);
    expect((await admin.get("/api/low-stock", { sort: "colour" })).status).toBe(
      400
    );
  });
});

describe("PATCH /api/items/:id/threshold", () => {
  it("changes the threshold, audits before/after and the list follows", async () => {
    const { admin, app } = await arrange();
    const itemId = insertItem(app.sqlite, {
      lowStockThreshold: 0,
      name: "Thresholded",
    });
    insertBatch(app.sqlite, { expiry: day(90), itemId, qty: 3 });
    expect(await lowStock(admin)).toHaveLength(0);

    const response = await admin.patch<ThresholdResultDto>(
      `/api/items/${itemId}/threshold`,
      { lowStockThreshold: 12 }
    );
    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      itemId,
      lowStockThreshold: 12,
      previous: 0,
    });
    expect(thresholdOf(app, itemId)).toBe(12);

    const [audit] = auditOf(app, "item.threshold");
    expect(audit.entity_id).toBe(itemId);
    expect(JSON.parse(audit.before ?? "null")).toEqual({
      lowStockThreshold: 0,
    });
    expect(JSON.parse(audit.after ?? "null")).toEqual({
      lowStockThreshold: 12,
    });

    expect((await lowStock(admin)).map((row) => row.itemId)).toEqual([itemId]);

    await admin.patch(`/api/items/${itemId}/threshold`, {
      lowStockThreshold: 0,
    });
    expect(await lowStock(admin)).toHaveLength(0);
  });

  it("does nothing (and audits nothing) when the value is unchanged", async () => {
    const { admin, app } = await arrange();
    const itemId = insertItem(app.sqlite, { lowStockThreshold: 7 });
    const response = await admin.patch<ThresholdResultDto>(
      `/api/items/${itemId}/threshold`,
      { lowStockThreshold: 7 }
    );
    expect(response.data.lowStockThreshold).toBe(7);
    expect(auditOf(app, "item.threshold")).toHaveLength(0);
  });

  it("is allowed for admin and inventory only", async () => {
    const { app } = await arrange();
    const itemId = insertItem(app.sqlite, { lowStockThreshold: 1 });
    for (const role of ["admin", "inventory"] as const) {
      const client = await app.loginAs(role);
      const response = await client.patch(`/api/items/${itemId}/threshold`, {
        lowStockThreshold: 2,
      });
      expect(response.status).toBe(200);
    }
    for (const role of ["pharmacist", "nurse", "health_admin"] as const) {
      const client = await app.loginAs(role);
      const response = await client.patch(`/api/items/${itemId}/threshold`, {
        lowStockThreshold: 9,
      });
      expect(response.status).toBe(403);
      expect(response.error?.code).toBe("forbidden");
    }
    expect(thresholdOf(app, itemId)).toBe(2);
  });

  it("validates the body and the item", async () => {
    const { admin, app } = await arrange();
    const itemId = insertItem(app.sqlite, { lowStockThreshold: 1 });
    for (const body of [
      { lowStockThreshold: -1 },
      { lowStockThreshold: 1.5 },
      {},
      { lowStockThreshold: "5" },
    ]) {
      const response = await admin.patch(
        `/api/items/${itemId}/threshold`,
        body
      );
      expect(response.status).toBe(400);
      expect(response.error?.code).toBe("validation_error");
    }
    const missing = await admin.patch("/api/items/nope/threshold", {
      lowStockThreshold: 3,
    });
    expect(missing.status).toBe(404);

    const trashed = insertItem(app.sqlite, { name: "Trashed" });
    app.sqlite
      .prepare(
        "UPDATE items SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?"
      )
      .run(trashed);
    const gone = await admin.patch(`/api/items/${trashed}/threshold`, {
      lowStockThreshold: 3,
    });
    expect(gone.status).toBe(404);
  });
});
