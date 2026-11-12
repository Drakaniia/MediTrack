import { describe, expect, it } from "vitest";

import type {
  BatchDto,
  CreateBatchResultDto,
  CreateItemResultDto,
  ItemDetailDto,
} from "../shared/schemas/inventory";
import { createTestApp, type TestApp, type TestClient } from "./app";
import { auditActions, batchQty, insertBatch, insertItem } from "./fixtures";

interface Seeded {
  admin: TestClient;
  app: TestApp;
  itemId: string;
}

async function seed(fields: Record<string, unknown> = {}): Promise<Seeded> {
  const app = await createTestApp();
  const admin = await app.loginAs("admin");
  const res = await admin.post<CreateItemResultDto>("/api/items", {
    name: "Ibuprofen",
    strength: "200 mg",
    ...fields,
  });
  return { admin, app, itemId: res.data.item.id };
}

function movements(app: TestApp) {
  return app.sqlite
    .prepare(
      "SELECT kind, qty_delta AS delta, qty_after AS after FROM stock_movements ORDER BY at, rowid"
    )
    .all() as { after: number; delta: number; kind: string }[];
}

describe("POST /api/items/:id/batches", () => {
  it("receives stock, suggesting a number when blank", async () => {
    const { admin, app, itemId } = await seed();
    const first = await admin.post<CreateBatchResultDto>(
      `/api/items/${itemId}/batches`,
      {
        batchNumber: "  ",
        expiry: "2027-05-01",
        qty: 25,
      }
    );
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({
      batch: {
        batchNumber: "IBU-261112-01",
        fefoRank: 1,
        qty: 25,
        quarantined: false,
        receivedOn: "2026-11-12",
      },
      merged: false,
      warnings: [],
    });
    const second = await admin.post<CreateBatchResultDto>(
      `/api/items/${itemId}/batches`,
      {
        expiry: "2027-06-01",
        qty: 5,
      }
    );
    expect(second.data.batch.batchNumber).toBe("IBU-261112-02");
    expect(movements(app)).toEqual([
      { after: 25, delta: 25, kind: "receive" },
      { after: 5, delta: 5, kind: "receive" },
    ]);
    expect(
      auditActions(app.sqlite).filter((a) => a === "batch.create")
    ).toHaveLength(2);
  });

  it("suggests the next free number", async () => {
    const { admin, itemId } = await seed();
    const empty = await admin.get<{ batchNumber: string }>(
      "/api/batches/suggest-number",
      { itemId }
    );
    expect(empty.data.batchNumber).toBe("IBU-261112-01");
    await admin.post(`/api/items/${itemId}/batches`, {
      batchNumber: "ibu-261112-01",
      expiry: "2027-05-01",
      qty: 1,
    });
    const next = await admin.get<{ batchNumber: string }>(
      "/api/batches/suggest-number",
      { itemId }
    );
    expect(next.data.batchNumber).toBe("IBU-261112-02");
    expect(
      (await admin.get("/api/batches/suggest-number", { itemId: "nope" }))
        .status
    ).toBe(404);
    expect((await admin.get("/api/batches/suggest-number")).status).toBe(400);
  });

  it("answers duplicate_batch for the same number, ignoring case and spacing", async () => {
    const { admin, itemId } = await seed();
    const first = await admin.post<CreateBatchResultDto>(
      `/api/items/${itemId}/batches`,
      {
        batchNumber: "LOT-7",
        expiry: "2027-05-01",
        qty: 12,
      }
    );
    const again = await admin.post(`/api/items/${itemId}/batches`, {
      batchNumber: "  lot-7 ",
      expiry: "2027-05-01",
      qty: 3,
    });
    expect(again.status).toBe(409);
    expect(again.error).toMatchObject({
      code: "duplicate_batch",
      details: { existingBatchId: first.data.batch.id, existingQty: 12 },
    });
  });

  it("merges into the existing batch when asked", async () => {
    const { admin, app, itemId } = await seed();
    const first = await admin.post<CreateBatchResultDto>(
      `/api/items/${itemId}/batches`,
      {
        batchNumber: "LOT-7",
        expiry: "2027-05-01",
        qty: 12,
      }
    );
    const merged = await admin.post<CreateBatchResultDto>(
      `/api/items/${itemId}/batches`,
      {
        batchNumber: "lot-7",
        expiry: "2030-01-01",
        mergeIntoExisting: true,
        qty: 8,
      }
    );
    expect(merged.status).toBe(200);
    expect(merged.data).toMatchObject({
      batch: {
        expiry: "2027-05-01",
        id: first.data.batch.id,
        initialQty: 20,
        qty: 20,
      },
      merged: true,
    });
    expect(batchQty(app.sqlite, first.data.batch.id)).toBe(20);
    expect(movements(app)).toEqual([
      { after: 12, delta: 12, kind: "receive" },
      { after: 20, delta: 8, kind: "receive" },
    ]);
    expect(auditActions(app.sqlite)).toContain("batch.merge");
  });

  it("refuses to merge into a disposed batch", async () => {
    const { admin, app, itemId } = await seed();
    insertBatch(app.sqlite, {
      batchNumber: "OLD",
      itemId,
      qty: 0,
      status: "disposed",
    });
    const res = await admin.post(`/api/items/${itemId}/batches`, {
      batchNumber: "old",
      expiry: "2027-05-01",
      mergeIntoExisting: true,
      qty: 1,
    });
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("conflict");
  });

  it("accepts past-expiry stock but quarantines it and warns", async () => {
    const { admin, itemId } = await seed();
    const res = await admin.post<CreateBatchResultDto>(
      `/api/items/${itemId}/batches`,
      {
        batchNumber: "OLD",
        expiry: "2026-11-01",
        qty: 9,
      }
    );
    expect(res.status).toBe(201);
    expect(res.data.warnings).toEqual(["expired_on_arrival"]);
    expect(res.data.batch).toMatchObject({
      expiryClass: "expired",
      fefoRank: null,
      quarantined: true,
    });
    const detail = await admin.get<ItemDetailDto>(`/api/items/${itemId}`);
    expect(detail.data).toMatchObject({ available: 0, onHand: 9 });
  });

  it("applies the expiry rule of the item", async () => {
    const dated = await seed();
    const missing = await dated.admin.post(
      `/api/items/${dated.itemId}/batches`,
      { qty: 3 }
    );
    expect(missing.status).toBe(400);

    const plain = await seed({
      hasExpiry: false,
      name: "Wheelchair",
      strength: "",
    });
    const withExpiry = await plain.admin.post(
      `/api/items/${plain.itemId}/batches`,
      { expiry: "2027-01-01", qty: 1 }
    );
    expect(withExpiry.status).toBe(400);
    const ok = await plain.admin.post<CreateBatchResultDto>(
      `/api/items/${plain.itemId}/batches`,
      { qty: 1 }
    );
    expect(ok.status).toBe(201);
    expect(ok.data.batch).toMatchObject({
      expiry: null,
      expiryClass: "safe",
      fefoRank: 1,
    });
  });

  it("validates quantity and dates, and rejects unknown items", async () => {
    const { admin, itemId } = await seed();
    for (const body of [
      { expiry: "2027-05-01", qty: 0 },
      { expiry: "2027-05-01", qty: 1.5 },
      { expiry: "05/01/2027", qty: 1 },
      { expiry: "2027-05-01", qty: 1, receivedOn: "nope" },
    ]) {
      expect(
        (await admin.post(`/api/items/${itemId}/batches`, body)).status
      ).toBe(400);
    }
    expect(
      (
        await admin.post("/api/items/missing/batches", {
          expiry: "2027-05-01",
          qty: 1,
        })
      ).status
    ).toBe(404);
  });

  it("is limited to inventory.write", async () => {
    const { app, itemId } = await seed();
    const nurse = await app.loginAs("nurse");
    expect(
      (
        await nurse.post(`/api/items/${itemId}/batches`, {
          expiry: "2027-05-01",
          qty: 1,
        })
      ).status
    ).toBe(403);
    const pharmacist = await app.loginAs("pharmacist");
    expect(
      (
        await pharmacist.post(`/api/items/${itemId}/batches`, {
          expiry: "2027-05-01",
          qty: 1,
        })
      ).status
    ).toBe(403);
  });
});

describe("PATCH /api/batches/:id", () => {
  async function withBatch() {
    const base = await seed();
    const res = await base.admin.post<CreateBatchResultDto>(
      `/api/items/${base.itemId}/batches`,
      {
        batchNumber: "LOT-1",
        expiry: "2027-05-01",
        qty: 30,
      }
    );
    return { ...base, batch: res.data.batch };
  }

  it("edits details but never the quantity", async () => {
    const { admin, app, batch } = await withBatch();
    const res = await admin.patch<BatchDto>(`/api/batches/${batch.id}`, {
      barcode: "9900",
      batchNumber: "LOT-1B",
      expiry: "2027-08-01",
      receivedOn: "2026-11-02",
      supplier: "ACME",
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      barcode: "9900",
      batchNumber: "LOT-1B",
      expiry: "2027-08-01",
      qty: 30,
      receivedOn: "2026-11-02",
      supplier: "ACME",
    });
    expect(batchQty(app.sqlite, batch.id)).toBe(30);
    const audit = app.sqlite
      .prepare(
        "SELECT before, after FROM audit_log WHERE action = 'batch.update'"
      )
      .get() as { after: string; before: string };
    expect(JSON.parse(audit.before)).toMatchObject({
      batchNumber: "LOT-1",
      expiry: "2027-05-01",
    });
    expect(JSON.parse(audit.after)).toMatchObject({
      batchNumber: "LOT-1B",
      expiry: "2027-08-01",
    });

    expect(
      (await admin.patch(`/api/batches/${batch.id}`, { qty: 99 })).status
    ).toBe(400);
    expect(
      (await admin.patch(`/api/batches/${batch.id}`, { initialQty: 99 })).status
    ).toBe(400);
    expect(batchQty(app.sqlite, batch.id)).toBe(30);
  });

  it("rejects a number already used by another batch of the item", async () => {
    const { admin, batch, itemId } = await withBatch();
    await admin.post(`/api/items/${itemId}/batches`, {
      batchNumber: "LOT-2",
      expiry: "2027-05-01",
      qty: 1,
    });
    const res = await admin.patch(`/api/batches/${batch.id}`, {
      batchNumber: " lot-2",
    });
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("duplicate_batch");
    expect(
      (await admin.patch(`/api/batches/${batch.id}`, { batchNumber: "LOT-1" }))
        .status
    ).toBe(200);
  });

  it("keeps the expiry rule and reflects a new class", async () => {
    const { admin, batch } = await withBatch();
    expect(
      (await admin.patch(`/api/batches/${batch.id}`, { expiry: null })).status
    ).toBe(400);
    const soon = await admin.patch<BatchDto>(`/api/batches/${batch.id}`, {
      expiry: "2026-11-14",
    });
    expect(soon.data).toMatchObject({ daysUntil: 2, expiryClass: "urgent" });
    expect(
      (await admin.patch("/api/batches/missing", { supplier: "x" })).status
    ).toBe(404);
    expect((await admin.patch(`/api/batches/${batch.id}`, {})).status).toBe(
      400
    );
  });

  it("is limited to inventory.write", async () => {
    const { app, batch } = await withBatch();
    const pharmacist = await app.loginAs("pharmacist");
    expect(
      (await pharmacist.patch(`/api/batches/${batch.id}`, { supplier: "x" }))
        .status
    ).toBe(403);
  });
});

describe("GET and DELETE /api/batches/:id", () => {
  it("reads a batch, soft deletes it and audits", async () => {
    const { admin, app, itemId } = await seed();
    const created = await admin.post<CreateBatchResultDto>(
      `/api/items/${itemId}/batches`,
      { expiry: "2027-05-01", qty: 4 }
    );
    const {
      batch: { id },
    } = created.data;
    expect((await admin.get<BatchDto>(`/api/batches/${id}`)).data.qty).toBe(4);

    const inventory = await app.loginAs("inventory");
    expect((await inventory.delete(`/api/batches/${id}`)).status).toBe(204);
    expect((await admin.get(`/api/batches/${id}`)).status).toBe(404);
    expect((await admin.delete(`/api/batches/${id}`)).status).toBe(404);
    const row = app.sqlite
      .prepare("SELECT deleted_at, deleted_with_item FROM batches WHERE id = ?")
      .get(id) as { deleted_at: string | null; deleted_with_item: number };
    expect(row.deleted_at).not.toBeNull();
    expect(row.deleted_with_item).toBe(0);
    expect(auditActions(app.sqlite)).toContain("batch.delete");
    const nurse = await app.loginAs("nurse");
    expect((await nurse.delete(`/api/batches/${id}`)).status).toBe(403);
  });

  it("cannot receive stock for a trashed item", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const id = insertItem(app.sqlite);
    app.sqlite
      .prepare(
        "UPDATE items SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?"
      )
      .run(id);
    expect(
      (
        await admin.post(`/api/items/${id}/batches`, {
          expiry: "2027-05-01",
          qty: 1,
        })
      ).status
    ).toBe(404);
  });
});
