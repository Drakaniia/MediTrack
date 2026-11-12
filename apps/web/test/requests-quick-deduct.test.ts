import { describe, expect, it } from "vitest";

import { QUICK_DEDUCT_UNDO_SECONDS } from "../shared/api";
import type {
  DispensingRecordDto,
  QuickDeductResultDto,
  RequestDto,
} from "../shared/schemas/requests";
import { batchQty } from "./fixtures";
import {
  count,
  createWorld,
  rows,
  stockItem,
  type World,
} from "./requests-helpers";

const SECOND = 1000;

async function deduct(
  actor: World["nurse"],
  itemId: string,
  qty: number,
  extra: Record<string, unknown> = {}
) {
  return await actor.client.post<QuickDeductResultDto>("/api/quick-deduct", {
    itemId,
    qty,
    ...extra,
  });
}

describe("Quick Deduct", () => {
  it("deducts FEFO across batches, creates a claimed quick_deduct request and records everything", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [
      { expiry: "2026-12-01", qty: 3 },
      { expiry: "2027-02-01", qty: 10 },
    ]);

    const result = await deduct(world.nurse, itemId, 5, {
      note: "walk-in",
      recipient: "Ana",
    });

    expect(result.status).toBe(201);
    expect(result.data.record).toMatchObject({
      dispensedByName: world.nurse.user.displayName,
      note: "walk-in",
      qty: 5,
      recipientName: "Ana",
      source: "quick_deduct",
    });
    expect(
      result.data.record.lines.map((line) => [line.batchNumber, line.qty])
    ).toEqual([
      ["LOT-A", 3],
      ["LOT-B", 2],
    ]);
    expect(result.data.undoUntil).toBe(
      new Date(
        world.app.clock.now().getTime() + QUICK_DEDUCT_UNDO_SECONDS * SECOND
      ).toISOString()
    );
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(0);
    expect(batchQty(world.app.sqlite, batchIds[1])).toBe(8);

    const list = await world.admin.client.get<RequestDto[]>("/api/requests", {
      status: "claimed",
    });
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      code: "REQ-2026-0001",
      dispensedQty: 5,
      qty: 5,
      requestor: { name: "Ana" },
      source: "quick_deduct",
      status: "claimed",
    });
    expect(list.data[0].dispensing[0].id).toBe(result.data.record.id);
    expect(count(world.app, "stock_movements", "kind = 'dispense'")).toBe(2);
    expect(
      count(world.app, "audit_log", "action = 'quick_deduct.create'")
    ).toBe(1);
  });

  it("refuses a short quantity naming what is there, with no partial", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [
      { qty: 3 },
      { expiry: "2026-11-01", qty: 20 },
    ]);
    const refused = await deduct(world.nurse, itemId, 5);
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe("insufficient_stock");
    expect(refused.error?.message).toContain("Only 3 tab in stock");
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(3);
    expect(count(world.app, "dispensing_records")).toBe(0);
    expect(count(world.app, "requests")).toBe(0);
  });

  it("validates input and item", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 3 }]);
    expect((await deduct(world.nurse, itemId, 0)).status).toBe(400);
    expect((await deduct(world.nurse, itemId, 1.5)).status).toBe(400);
    expect((await deduct(world.nurse, "missing", 1)).status).toBe(404);
  });

  it("allows nurses, pharmacists, inventory and admin; refuses health admin", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    for (const who of [
      world.nurse,
      world.pharmacist,
      world.inventory,
      world.admin,
    ]) {
      expect((await deduct(who, itemId, 1)).status).toBe(201);
    }
    expect((await deduct(world.healthAdmin, itemId, 1)).status).toBe(403);
  });
});

describe("Quick Deduct undo", () => {
  it("restores the exact batches inside the window and cancels the request", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [
      { expiry: "2026-12-01", qty: 3 },
      { expiry: "2027-02-01", qty: 10 },
    ]);
    const made = await deduct(world.nurse, itemId, 5);
    world.app.clock.advance((QUICK_DEDUCT_UNDO_SECONDS - 1) * SECOND);

    const undone = await world.nurse.client.post<DispensingRecordDto>(
      `/api/quick-deduct/${made.data.record.id}/undo`
    );
    expect(undone.status).toBe(200);
    expect(undone.data.undoneAt).toBe(world.app.clock.now().toISOString());
    expect(undone.data.undoneBy).toBe(world.nurse.user.id);
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(3);
    expect(batchQty(world.app.sqlite, batchIds[1])).toBe(10);

    const movements = rows<{ kind: string; qty_delta: number }>(
      world.app,
      "SELECT kind, qty_delta FROM stock_movements WHERE kind = 'undo_dispense' ORDER BY rowid"
    );
    expect(movements).toEqual([
      { kind: "undo_dispense", qty_delta: 3 },
      { kind: "undo_dispense", qty_delta: 2 },
    ]);
    const request = rows<{ status: string }>(
      world.app,
      "SELECT status FROM requests"
    );
    expect(request[0].status).toBe("cancelled");
    expect(count(world.app, "audit_log", "action = 'quick_deduct.undo'")).toBe(
      1
    );
    expect(count(world.app, "dispensing_records")).toBe(1);
  });

  it("refuses a second undo", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [{ qty: 10 }]);
    const made = await deduct(world.nurse, itemId, 4);
    const url = `/api/quick-deduct/${made.data.record.id}/undo`;
    expect((await world.nurse.client.post(url)).status).toBe(200);
    const again = await world.nurse.client.post(url);
    expect(again.status).toBe(409);
    expect(again.error?.message).toContain("already undone");
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(10);
  });

  it("refuses an undo after the window", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [{ qty: 10 }]);
    const made = await deduct(world.nurse, itemId, 4);
    world.app.clock.advance((QUICK_DEDUCT_UNDO_SECONDS + 1) * SECOND);
    const late = await world.nurse.client.post(
      `/api/quick-deduct/${made.data.record.id}/undo`
    );
    expect(late.status).toBe(409);
    expect(late.error?.code).toBe("conflict");
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(6);
  });

  it("lets only the same user (or an admin) undo", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [{ qty: 10 }]);
    const made = await deduct(world.nurse, itemId, 2);
    const url = `/api/quick-deduct/${made.data.record.id}/undo`;
    for (const stranger of [world.pharmacist, world.inventory]) {
      const refused = await stranger.client.post(url);
      expect(refused.status).toBe(403);
    }
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(8);
    expect((await world.admin.client.post(url)).status).toBe(200);
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(10);
  });

  it("refuses when a batch was purged or disposed, leaving everything as it was", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [
      { expiry: "2026-12-01", qty: 3 },
      { expiry: "2027-02-01", qty: 10 },
    ]);
    const made = await deduct(world.nurse, itemId, 5);
    world.app.sqlite
      .prepare("UPDATE batches SET deleted_at = ? WHERE id = ?")
      .run("2026-11-12T02:00:30.000Z", batchIds[0]);
    const refused = await world.nurse.client.post(
      `/api/quick-deduct/${made.data.record.id}/undo`
    );
    expect(refused.status).toBe(409);
    expect(batchQty(world.app.sqlite, batchIds[1])).toBe(8);

    world.app.sqlite.exec("PRAGMA foreign_keys = OFF");
    world.app.sqlite
      .prepare("DELETE FROM batches WHERE id = ?")
      .run(batchIds[0]);
    world.app.sqlite.exec("PRAGMA foreign_keys = ON");
    const purged = await world.nurse.client.post(
      `/api/quick-deduct/${made.data.record.id}/undo`
    );
    expect(purged.status).toBe(409);
    expect(
      count(world.app, "dispensing_records", "undone_at IS NOT NULL")
    ).toBe(0);
  });

  it("does not undo a queue hand-over and 404s on unknown ids", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    expect(
      (await world.nurse.client.post("/api/quick-deduct/nope/undo")).status
    ).toBe(404);
    const made = await deduct(world.nurse, itemId, 1);
    world.app.sqlite
      .prepare("UPDATE dispensing_records SET source = 'queue' WHERE id = ?")
      .run(made.data.record.id);
    const refused = await world.nurse.client.post(
      `/api/quick-deduct/${made.data.record.id}/undo`
    );
    expect(refused.status).toBe(409);
  });
});
