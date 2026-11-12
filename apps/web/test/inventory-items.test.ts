import { describe, expect, it } from "vitest";

import type { Role } from "../shared/roles";
import type {
  CategoryDto,
  CreateItemResultDto,
  HistoryEntryDto,
  ItemDetailDto,
  ItemSummaryDto,
} from "../shared/schemas/inventory";
import { createTestApp, type TestApp, type TestClient } from "./app";
import { auditActions, insertBatch, insertItem } from "./fixtures";

const BATCH = { batchNumber: "LOT-1", expiry: "2027-03-12", qty: 40 };

/** Audit actions written by the inventory routes (sign-in rows left out). */
function inventoryAudit(app: TestApp): string[] {
  return auditActions(app.sqlite).filter(
    (action) => !action.startsWith("auth.")
  );
}

async function seedItem(
  client: TestClient,
  body: Record<string, unknown> = {}
): Promise<ItemDetailDto> {
  const res = await client.post<CreateItemResultDto>("/api/items", {
    name: "Paracetamol",
    strength: "500 mg",
    ...body,
  });
  expect(res.status).toBe(201);
  return res.data.item;
}

describe("role matrix", () => {
  const WRITERS: Role[] = ["admin", "inventory"];
  const READ_ONLY: Role[] = ["pharmacist", "nurse", "health_admin"];

  it.each(WRITERS)("%s can write items", async (role) => {
    const app = await createTestApp();
    const client = await app.loginAs(role);
    const res = await client.post("/api/items", { name: "Gauze" });
    expect(res.status).toBe(201);
  });

  it.each(READ_ONLY)("%s can read but not write", async (role) => {
    const app = await createTestApp();
    const id = insertItem(app.sqlite);
    const client = await app.loginAs(role);
    expect((await client.get("/api/items")).status).toBe(200);
    expect((await client.get(`/api/items/${id}`)).status).toBe(200);
    expect((await client.get("/api/fefo")).status).toBe(200);
    expect((await client.post("/api/items", { name: "Gauze" })).status).toBe(
      403
    );
    expect(
      (await client.patch(`/api/items/${id}`, { notes: "x" })).status
    ).toBe(403);
    expect((await client.delete(`/api/items/${id}`)).status).toBe(403);
    expect((await client.post("/api/categories", { name: "X" })).status).toBe(
      403
    );
    expect(
      (await client.post("/api/items/bulk", { rows: [{ name: "A" }] })).status
    ).toBe(403);
    expect((await client.get("/api/trash")).status).toBe(403);
  });

  it("lets inventory personnel delete but not restore or purge", async () => {
    const app = await createTestApp();
    const inventory = await app.loginAs("inventory");
    const item = await seedItem(inventory);
    expect((await inventory.delete(`/api/items/${item.id}`)).status).toBe(204);
    expect((await inventory.get("/api/trash")).status).toBe(403);
    expect(
      (await inventory.post(`/api/trash/item/${item.id}/restore`)).status
    ).toBe(403);
    expect((await inventory.delete(`/api/trash/item/${item.id}`)).status).toBe(
      403
    );
  });

  it("requires a session", async () => {
    const app = await createTestApp();
    expect((await app.anonymous.get("/api/items")).error?.code).toBe(
      "unauthenticated"
    );
  });
});

describe("POST /api/items", () => {
  it("creates an item with a first batch, ledger row and audit rows", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const res = await admin.post<CreateItemResultDto>("/api/items", {
      batches: [{ ...BATCH, batchNumber: "" }],
      lowStockThreshold: 20,
      name: " Paracetamol ",
      strength: "500 mg",
      unit: "tab",
    });

    expect(res.status).toBe(201);
    const { item, warnings } = res.data;
    expect(warnings).toEqual([]);
    expect(item).toMatchObject({
      available: 40,
      displayName: "Paracetamol 500 mg",
      lowStock: "in_stock",
      name: "Paracetamol",
      onHand: 40,
    });
    expect(item.batches[0].batchNumber).toBe("PAR-261112-01");
    expect(item.batches[0].code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(item.batches[0].fefoRank).toBe(1);

    const movements = app.sqlite
      .prepare(
        "SELECT kind, qty_delta, qty_after, item_name, actor_name FROM stock_movements"
      )
      .all();
    expect(movements).toEqual([
      expect.objectContaining({
        item_name: "Paracetamol 500 mg",
        kind: "receive",
        qty_after: 40,
        qty_delta: 40,
      }),
    ]);
    expect(inventoryAudit(app).sort()).toEqual(["batch.create", "item.create"]);
  });

  it("creates an item without batches", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const item = await seedItem(admin);
    expect(item.batches).toEqual([]);
    expect(item.unit).toBe("unit");
    expect(item.hasExpiry).toBe(true);
  });

  it("reports validation problems with paths", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const res = await admin.post("/api/items", {
      batches: [{ expiry: "2027-02-30", qty: 0 }],
      name: "",
    });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe("validation_error");
    const details = res.error?.details as { issues: { path: string }[] };
    const paths = details.issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(["name", "batches.0.expiry", "batches.0.qty"])
    );
  });

  it("rejects unknown fields", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    expect((await admin.post("/api/items", { name: "A", qty: 5 })).status).toBe(
      400
    );
  });

  it("enforces the expiry rule per item type", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const missing = await admin.post("/api/items", {
      batches: [{ qty: 1 }],
      name: "Needs expiry",
    });
    expect(missing.status).toBe(400);
    const extra = await admin.post("/api/items", {
      batches: [{ expiry: "2027-01-01", qty: 1 }],
      hasExpiry: false,
      name: "Wheelchair",
    });
    expect(extra.status).toBe(400);
    const fine = await admin.post("/api/items", {
      batches: [{ qty: 2 }],
      hasExpiry: false,
      name: "Wheelchair",
    });
    expect(fine.status).toBe(201);
  });

  it("rejects a repeated batch number inside one request", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const res = await admin.post("/api/items", {
      batches: [BATCH, { ...BATCH, batchNumber: "lot-1 " }],
      name: "Twice",
    });
    expect(res.status).toBe(400);
  });

  it("answers 409 conflict with the existing id for a duplicate identity", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const first = await seedItem(admin);
    const again = await admin.post("/api/items", {
      name: "PARACETAMOL",
      strength: "500 MG",
    });
    expect(again.status).toBe(409);
    expect(again.error).toMatchObject({
      code: "conflict",
      details: { existingItemId: first.id, field: "identity" },
    });
    expect(
      (
        await admin.post("/api/items", {
          name: "Paracetamol",
          strength: "250 mg",
        })
      ).status
    ).toBe(201);
  });

  it("rejects a duplicate SKU or barcode and unknown categories", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    await seedItem(admin, { barcode: "123", sku: "PCM" });
    const sku = await admin.post("/api/items", { name: "Other", sku: "pcm" });
    expect(sku.error?.details).toMatchObject({ field: "sku" });
    const barcode = await admin.post("/api/items", {
      barcode: "123",
      name: "Other 2",
    });
    expect(barcode.error?.details).toMatchObject({ field: "barcode" });
    const category = await admin.post("/api/items", {
      categoryId: "nope",
      name: "Other 3",
    });
    expect(category.status).toBe(400);
  });
});

describe("GET /api/items", () => {
  it("filters, sorts and pages through the API", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const a = await seedItem(admin, {
      batches: [{ ...BATCH, expiry: "2026-11-14" }],
      name: "Alpha",
      strength: "",
    });
    await seedItem(admin, {
      batches: [{ ...BATCH, expiry: "2026-10-01" }],
      lowStockThreshold: 10,
      name: "Beta",
      strength: "",
    });
    await seedItem(admin, { name: "Gamma", strength: "" });

    const all = await admin.get<ItemSummaryDto[]>("/api/items", {
      sort: "name",
    });
    expect(all.data.map((i) => i.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(all.body).toMatchObject({
      meta: { limit: 50, offset: 0, total: 3 },
    });

    const expired = await admin.get<ItemSummaryDto[]>("/api/items", {
      status: "expired",
    });
    expect(expired.data.map((i) => i.name)).toEqual(["Beta"]);
    const urgentOrExpired = await admin.get<ItemSummaryDto[]>("/api/items", {
      status: "urgent,expired",
    });
    expect(urgentOrExpired.data).toHaveLength(2);
    const out = await admin.get<ItemSummaryDto[]>("/api/items", {
      stock: "out",
    });
    expect(out.data.map((i) => i.id)).not.toContain(a.id);
    expect(out.data.map((i) => i.name)).toEqual(["Beta"]);

    const paged = await admin.get<ItemSummaryDto[]>("/api/items", {
      dir: "desc",
      limit: 1,
      offset: 1,
      sort: "name",
    });
    expect(paged.data.map((i) => i.name)).toEqual(["Beta"]);
    expect(paged.body).toMatchObject({
      meta: { limit: 1, offset: 1, total: 3 },
    });

    expect((await admin.get("/api/items", { sort: "bogus" })).status).toBe(400);
    expect((await admin.get("/api/items", { status: "weird" })).status).toBe(
      400
    );
    expect(
      (await admin.get<ItemSummaryDto[]>("/api/items", { search: "ALP" })).data
    ).toHaveLength(1);
  });
});

describe("GET /api/items/:id", () => {
  it("returns the detail or 404", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const item = await seedItem(admin, { batches: [BATCH] });
    const res = await admin.get<ItemDetailDto>(`/api/items/${item.id}`);
    expect(res.data.batches).toHaveLength(1);
    expect((await admin.get("/api/items/missing")).error?.code).toBe(
      "not_found"
    );
  });
});

describe("PATCH /api/items/:id", () => {
  it("edits fields and audits before / after", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const item = await seedItem(admin);
    const res = await admin.patch<ItemDetailDto>(`/api/items/${item.id}`, {
      lowStockThreshold: 50,
      notes: "Keep cool",
      supplier: "ACME",
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      lowStockThreshold: 50,
      notes: "Keep cool",
      supplier: "ACME",
    });
    const row = app.sqlite
      .prepare(
        "SELECT before, after FROM audit_log WHERE action = 'item.update'"
      )
      .get() as { after: string; before: string };
    expect(JSON.parse(row.before)).toMatchObject({
      lowStockThreshold: 0,
      notes: "",
    });
    expect(JSON.parse(row.after)).toMatchObject({
      lowStockThreshold: 50,
      notes: "Keep cool",
    });
  });

  it("does nothing, quietly, when no value changes", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const item = await seedItem(admin);
    expect(
      (await admin.patch(`/api/items/${item.id}`, { notes: "" })).status
    ).toBe(200);
    expect(inventoryAudit(app)).toEqual(["item.create"]);
  });

  it("rejects clashes, empty bodies and quantity fields", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const a = await seedItem(admin, { name: "A", sku: "SKU-A", strength: "" });
    const b = await seedItem(admin, { name: "B", strength: "" });
    const clash = await admin.patch(`/api/items/${b.id}`, { name: "a" });
    expect(clash.status).toBe(409);
    expect(clash.error?.details).toMatchObject({ existingItemId: a.id });
    expect(
      (await admin.patch(`/api/items/${b.id}`, { sku: "sku-a" })).status
    ).toBe(409);
    expect((await admin.patch(`/api/items/${b.id}`, {})).status).toBe(400);
    expect((await admin.patch(`/api/items/${b.id}`, { qty: 4 })).status).toBe(
      400
    );
    expect((await admin.patch("/api/items/nope", { notes: "x" })).status).toBe(
      404
    );
  });

  it("blocks changing expiry tracking while batches exist", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const withStock = await seedItem(admin, {
      batches: [BATCH],
      name: "Stocked",
    });
    const blocked = await admin.patch(`/api/items/${withStock.id}`, {
      hasExpiry: false,
    });
    expect(blocked.status).toBe(409);
    const empty = await seedItem(admin, { name: "Empty" });
    const ok = await admin.patch<ItemDetailDto>(`/api/items/${empty.id}`, {
      hasExpiry: false,
    });
    expect(ok.data.hasExpiry).toBe(false);
  });
});

describe("DELETE /api/items/:id", () => {
  it("soft deletes the item and its live batches together", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const item = await seedItem(admin, {
      batches: [BATCH, { ...BATCH, batchNumber: "LOT-2" }],
    });
    const trashedSeparately = item.batches[0].id;
    expect(
      (await admin.delete(`/api/batches/${trashedSeparately}`)).status
    ).toBe(204);

    expect((await admin.delete(`/api/items/${item.id}`)).status).toBe(204);
    expect((await admin.get(`/api/items/${item.id}`)).status).toBe(404);
    expect((await admin.get<ItemSummaryDto[]>("/api/items")).data).toEqual([]);

    const rows = app.sqlite
      .prepare(
        "SELECT id, deleted_with_item AS withItem FROM batches ORDER BY batch_number"
      )
      .all() as { id: string; withItem: number }[];
    expect(rows.map((r) => r.withItem).sort()).toEqual([0, 1]);
    expect(auditActions(app.sqlite)).toContain("item.delete");
    expect((await admin.delete(`/api/items/${item.id}`)).status).toBe(404);
  });
});

describe("history and fefo", () => {
  it("lists movements and audit rows newest first, paged", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const item = await seedItem(admin, { batches: [BATCH] });
    app.clock.advance(60_000);
    await admin.patch(`/api/items/${item.id}`, { notes: "later" });

    const res = await admin.get<HistoryEntryDto[]>(
      `/api/items/${item.id}/history`
    );
    expect(res.status).toBe(200);
    expect(res.data[0]).toMatchObject({ kind: "item.update", source: "audit" });
    expect(res.data.map((e) => e.source)).toContain("movement");
    expect(res.data.find((e) => e.source === "movement")).toMatchObject({
      kind: "receive",
      qtyAfter: 40,
      qtyDelta: 40,
    });
    expect(res.body).toMatchObject({ meta: { total: 4 } });

    const page = await admin.get<HistoryEntryDto[]>(
      `/api/items/${item.id}/history`,
      { limit: 1, offset: 1 }
    );
    expect(page.data).toHaveLength(1);
    expect((await admin.get("/api/items/none/history")).status).toBe(404);
  });

  it("serves the per-item and facility FEFO lists", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const item = await seedItem(admin, {
      batches: [
        { ...BATCH, batchNumber: "LATE", expiry: "2027-09-01" },
        { ...BATCH, batchNumber: "SOON", expiry: "2027-01-01" },
      ],
    });
    const perItem = await admin.get<
      { batchNumber: string; fefoRank: number }[]
    >(`/api/items/${item.id}/fefo`);
    expect(perItem.data.map((b) => [b.batchNumber, b.fefoRank])).toEqual([
      ["SOON", 1],
      ["LATE", 2],
    ]);
    const facility =
      await admin.get<{ batch: { batchNumber: string } }[]>("/api/fefo");
    expect(facility.data.map((e) => e.batch.batchNumber)).toEqual(["SOON"]);
  });
});

describe("categories", () => {
  it("creates, renames, orders and deletes", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const a = await admin.post<CategoryDto>("/api/categories", {
      name: "Analgesics",
    });
    const b = await admin.post<CategoryDto>("/api/categories", {
      name: "Antibiotics",
    });
    expect(a.status).toBe(201);
    expect(b.data.sortOrder).toBeGreaterThan(a.data.sortOrder ?? 0);
    expect(
      (await admin.post("/api/categories", { name: "analgesics" })).status
    ).toBe(409);

    const renamed = await admin.patch<CategoryDto>(
      `/api/categories/${a.data.id}`,
      { name: "Pain relief" }
    );
    expect(renamed.data.name).toBe("Pain relief");
    expect(
      (
        await admin.patch(`/api/categories/${a.data.id}`, {
          name: "antibiotics",
        })
      ).status
    ).toBe(409);

    const list = await admin.get<CategoryDto[]>("/api/categories");
    expect(list.data.map((c) => c.name)).toEqual([
      "Pain relief",
      "Antibiotics",
    ]);
    expect((await admin.delete(`/api/categories/${b.data.id}`)).status).toBe(
      204
    );
    expect(auditActions(app.sqlite)).toEqual(
      expect.arrayContaining([
        "category.create",
        "category.update",
        "category.delete",
      ])
    );
  });

  it("refuses to delete a used category unless the items are reassigned", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const used = (
      await admin.post<CategoryDto>("/api/categories", { name: "Used" })
    ).data;
    const other = (
      await admin.post<CategoryDto>("/api/categories", { name: "Other" })
    ).data;
    const item = await seedItem(admin, { categoryId: used.id });
    expect(item.categoryName).toBe("Used");

    const blocked = await admin.delete(`/api/categories/${used.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.error?.details).toMatchObject({ itemCount: 1 });
    const counts = await admin.get<CategoryDto[]>("/api/categories");
    expect(counts.data.find((c) => c.id === used.id)?.itemCount).toBe(1);

    const moved = await admin.request("DELETE", `/api/categories/${used.id}`, {
      query: { reassignTo: other.id },
    });
    expect(moved.status).toBe(204);
    const detail = await admin.get<ItemDetailDto>(`/api/items/${item.id}`);
    expect(detail.data.categoryId).toBe(other.id);
    expect((await admin.delete("/api/categories/missing")).status).toBe(404);
  });
});

describe("derived values through the API", () => {
  it("quarantines expired stock and keeps it out of available", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const id = insertItem(app.sqlite, { lowStockThreshold: 10 });
    insertBatch(app.sqlite, { expiry: "2026-11-01", itemId: id, qty: 30 });
    const res = await admin.get<ItemDetailDto>(`/api/items/${id}`);
    expect(res.data).toMatchObject({
      available: 0,
      lowStock: "out",
      onHand: 30,
      worstClass: "expired",
    });
    expect(res.data.batches[0]).toMatchObject({
      fefoRank: null,
      quarantined: true,
    });
  });
});
