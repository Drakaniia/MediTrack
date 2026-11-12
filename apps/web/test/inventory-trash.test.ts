import { describe, expect, it } from "vitest";

import type {
  CreateItemResultDto,
  ItemDetailDto,
  ItemSummaryDto,
  TrashListDto,
} from "../shared/schemas/inventory";
import { createTestApp, type TestApp, type TestClient } from "./app";
import { auditActions } from "./fixtures";

const LOT = (n: number) => ({
  batchNumber: `LOT-${n}`,
  expiry: "2027-05-01",
  qty: 10 * n,
});

async function setup() {
  const app = await createTestApp();
  const admin = await app.loginAs("admin");
  const res = await admin.post<CreateItemResultDto>("/api/items", {
    batches: [LOT(1), LOT(2), LOT(3)],
    name: "Cetirizine",
    strength: "10 mg",
  });
  return { admin, app, item: res.data.item };
}

function count(app: TestApp, sql: string, ...args: string[]): number {
  const row = app.sqlite.prepare(sql).get(...args) as { n: number };
  return row.n;
}

async function trash(admin: TestClient): Promise<TrashListDto> {
  return (await admin.get<TrashListDto>("/api/trash")).data;
}

describe("GET /api/trash", () => {
  it("lists trashed items and batches with who and when", async () => {
    const { admin, app, item } = await setup();
    const single = item.batches.find((b) => b.batchNumber === "LOT-2");
    await admin.delete(`/api/batches/${single?.id}`);
    app.clock.advance(60_000);
    await admin.delete(`/api/items/${item.id}`);

    const list = await trash(admin);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      batchCount: 2,
      deletedAt: "2026-11-12T02:01:00.000Z",
      displayName: "Cetirizine 10 mg",
      id: item.id,
      onHand: 40,
    });
    expect(list.items[0].deletedBy).toContain("admin");
    expect(list.batches).toHaveLength(3);
    const byNumber = Object.fromEntries(
      list.batches.map((b) => [b.batchNumber, b.deletedWithItem])
    );
    expect(byNumber).toEqual({ "LOT-1": true, "LOT-2": false, "LOT-3": true });
    expect(list.batches.every((b) => b.itemDeleted)).toBe(true);
  });

  it("is admin only", async () => {
    const app = await createTestApp();
    for (const role of [
      "inventory",
      "pharmacist",
      "nurse",
      "health_admin",
    ] as const) {
      const client = await app.loginAs(role);
      expect((await client.get("/api/trash")).status).toBe(403);
    }
  });
});

describe("restore", () => {
  it("brings back an item with exactly the batches trashed with it", async () => {
    const { admin, app, item } = await setup();
    const single = item.batches.find((b) => b.batchNumber === "LOT-2");
    await admin.delete(`/api/batches/${single?.id}`);
    await admin.delete(`/api/items/${item.id}`);

    const res = await admin.post(`/api/trash/item/${item.id}/restore`);
    expect(res.status).toBe(204);
    const detail = await admin.get<ItemDetailDto>(`/api/items/${item.id}`);
    expect(detail.data.batches.map((b) => b.batchNumber).sort()).toEqual([
      "LOT-1",
      "LOT-3",
    ]);
    expect(detail.data.onHand).toBe(40);
    const list = await trash(admin);
    expect(list.items).toEqual([]);
    expect(list.batches.map((b) => b.batchNumber)).toEqual(["LOT-2"]);
    expect(list.batches[0].itemDeleted).toBe(false);
    expect(auditActions(app.sqlite)).toContain("item.restore");
  });

  it("restores a batch trashed on its own", async () => {
    const { admin, item } = await setup();
    const [single] = item.batches;
    await admin.delete(`/api/batches/${single.id}`);
    expect(
      (await admin.post(`/api/trash/batch/${single.id}/restore`)).status
    ).toBe(204);
    expect((await admin.get(`/api/batches/${single.id}`)).status).toBe(200);
  });

  it("refuses to restore a batch whose item is still trashed", async () => {
    const { admin, item } = await setup();
    await admin.delete(`/api/items/${item.id}`);
    const res = await admin.post(
      `/api/trash/batch/${item.batches[0].id}/restore`
    );
    expect(res.status).toBe(409);
    expect(res.error).toMatchObject({
      code: "restore_conflict",
      details: { itemId: item.id },
    });
  });

  it("refuses to restore an item whose identity is taken", async () => {
    const { admin, item } = await setup();
    await admin.delete(`/api/items/${item.id}`);
    const replacement = await admin.post<CreateItemResultDto>("/api/items", {
      name: "cetirizine",
      strength: "10 MG",
    });
    const res = await admin.post(`/api/trash/item/${item.id}/restore`);
    expect(res.status).toBe(409);
    expect(res.error).toMatchObject({
      code: "restore_conflict",
      details: { existingItemId: replacement.data.item.id, field: "identity" },
    });
    expect((await trash(admin)).items).toHaveLength(1);
  });

  it("refuses to restore an item whose SKU is taken", async () => {
    const app = await createTestApp();
    const admin = await app.loginAs("admin");
    const first = await admin.post<CreateItemResultDto>("/api/items", {
      name: "A",
      sku: "X-1",
    });
    await admin.delete(`/api/items/${first.data.item.id}`);
    await admin.post("/api/items", { name: "B", sku: "x-1" });
    const res = await admin.post(
      `/api/trash/item/${first.data.item.id}/restore`
    );
    expect(res.error).toMatchObject({
      code: "restore_conflict",
      details: { field: "sku" },
    });
  });

  it("refuses to restore a batch whose number was reused", async () => {
    const { admin, item } = await setup();
    const first = item.batches.find((b) => b.batchNumber === "LOT-1");
    await admin.delete(`/api/batches/${first?.id}`);
    await admin.post(`/api/items/${item.id}/batches`, LOT(1));
    const res = await admin.post(`/api/trash/batch/${first?.id}/restore`);
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("restore_conflict");
  });

  it("404s for things not in the Trash and unknown types", async () => {
    const { admin, item } = await setup();
    expect(
      (await admin.post(`/api/trash/item/${item.id}/restore`)).status
    ).toBe(404);
    expect(
      (await admin.post(`/api/trash/widget/${item.id}/restore`)).status
    ).toBe(404);
    expect((await admin.delete(`/api/trash/item/${item.id}`)).status).toBe(404);
  });
});

describe("purge", () => {
  it("hard deletes but keeps history snapshots", async () => {
    const { admin, app, item } = await setup();
    await admin.delete(`/api/items/${item.id}`);
    expect((await admin.delete(`/api/trash/item/${item.id}`)).status).toBe(204);

    expect(
      count(app, "SELECT COUNT(*) AS n FROM items WHERE id = ?", item.id)
    ).toBe(0);
    expect(
      count(app, "SELECT COUNT(*) AS n FROM batches WHERE item_id = ?", item.id)
    ).toBe(0);
    const ledger = app.sqlite
      .prepare(
        "SELECT item_id, batch_id, item_name, batch_number FROM stock_movements ORDER BY batch_number"
      )
      .all() as {
      batch_id: string | null;
      batch_number: string;
      item_id: string | null;
      item_name: string;
    }[];
    expect(ledger).toHaveLength(3);
    expect(
      ledger.every((row) => row.item_id === null && row.batch_id === null)
    ).toBe(true);
    expect(ledger.map((row) => row.batch_number)).toEqual([
      "LOT-1",
      "LOT-2",
      "LOT-3",
    ]);
    expect(ledger[0].item_name).toBe("Cetirizine 10 mg");
    expect(auditActions(app.sqlite)).toContain("item.purge");
    expect(await trash(admin)).toEqual({ batches: [], items: [] });
  });

  it("purges a single trashed batch", async () => {
    const { admin, app, item } = await setup();
    const [target] = item.batches;
    await admin.delete(`/api/batches/${target.id}`);
    expect((await admin.delete(`/api/trash/batch/${target.id}`)).status).toBe(
      204
    );
    expect(
      count(app, "SELECT COUNT(*) AS n FROM batches WHERE id = ?", target.id)
    ).toBe(0);
    expect(
      count(
        app,
        "SELECT COUNT(*) AS n FROM stock_movements WHERE item_id = ?",
        item.id
      )
    ).toBe(3);
    expect(
      (await admin.get<ItemSummaryDto[]>("/api/items")).data[0].batchCount
    ).toBe(2);
    expect(auditActions(app.sqlite)).toContain("batch.purge");
  });

  it("never purges live rows", async () => {
    const { admin, item } = await setup();
    expect((await admin.delete(`/api/trash/item/${item.id}`)).status).toBe(404);
    expect(
      (await admin.delete(`/api/trash/batch/${item.batches[0].id}`)).status
    ).toBe(404);
    expect((await admin.get(`/api/items/${item.id}`)).status).toBe(200);
  });
});
