import { describe, expect, it, vi } from "vitest";

import type { D1PreparedStatement } from "../server/env";
import * as dispenseModule from "../server/services/requests/dispense";
import type { DispenseResultDto, RequestDto } from "../shared/schemas/requests";
import { batchQty } from "./fixtures";
import {
  count,
  createRequest,
  createWorld,
  dispense,
  readyRequest,
  relogin,
  rows,
  stockItem,
} from "./requests-helpers";

interface MovementRow {
  batch_number: string;
  kind: string;
  qty_after: number;
  qty_delta: number;
  ref_type: string;
}

describe("hand-over", () => {
  it("splits FEFO across batches (3 from A, 2 from B) with per-batch lines, ledger and audit", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [
      { expiry: "2026-12-01", qty: 3 },
      { expiry: "2027-02-01", qty: 10 },
    ]);
    const request = await readyRequest(world, itemId, 5);

    const result = await dispense(world.pharmacist.client, request.id);

    expect(result.status).toBe(200);
    expect(result.data.partial).toBe(false);
    expect(result.data.request).toMatchObject({
      dispensedQty: 5,
      remaining: 0,
      status: "claimed",
    });
    expect(result.data.request.claimedAt).toBe(
      world.app.clock.now().toISOString()
    );
    expect(result.data.record).toMatchObject({
      dispensedByName: world.pharmacist.user.displayName,
      qty: 5,
      requestCode: request.code,
      source: "queue",
    });
    expect(
      result.data.record.lines.map((line) => [
        line.batchNumber,
        line.qty,
        line.expiry,
      ])
    ).toEqual([
      ["LOT-A", 3, "2026-12-01"],
      ["LOT-B", 2, "2027-02-01"],
    ]);
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(0);
    expect(batchQty(world.app.sqlite, batchIds[1])).toBe(8);

    const movements = rows<MovementRow>(
      world.app,
      "SELECT batch_number, kind, qty_delta, qty_after, ref_type FROM stock_movements ORDER BY rowid"
    );
    expect(movements).toEqual([
      {
        batch_number: "LOT-A",
        kind: "dispense",
        qty_after: 0,
        qty_delta: -3,
        ref_type: "dispensing_record",
      },
      {
        batch_number: "LOT-B",
        kind: "dispense",
        qty_after: 8,
        qty_delta: -2,
        ref_type: "dispensing_record",
      },
    ]);
    expect(count(world.app, "audit_log", "action = 'request.dispense'")).toBe(
      1
    );
    expect(result.data.request.events.at(-1)).toMatchObject({
      fromStatus: "ready",
      toStatus: "claimed",
    });
  });

  it("only dispenses a Ready to Claim request", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const pending = await createRequest(world.nurse.client, itemId, 1);
    const refused = await dispense(world.pharmacist.client, pending.id);
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe("invalid_transition");
    expect((await dispense(world.pharmacist.client, "unknown")).status).toBe(
      404
    );
  });

  it("hands over partially, stays Ready, then completes with a second record", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [{ qty: 10 }]);
    const request = await readyRequest(world, itemId, 6);

    const first = await dispense(world.pharmacist.client, request.id, {
      qty: 4,
    });
    expect(first.data.partial).toBe(true);
    expect(first.data.request).toMatchObject({
      dispensedQty: 4,
      remaining: 2,
      status: "ready",
    });
    expect(first.data.request.claimedAt).toBeNull();

    const tooMany = await dispense(world.pharmacist.client, request.id, {
      qty: 3,
    });
    expect(tooMany.status).toBe(400);

    const second = await dispense(world.pharmacist.client, request.id);
    expect(second.data.request).toMatchObject({
      dispensedQty: 6,
      remaining: 0,
      status: "claimed",
    });
    expect(second.data.request.dispensing).toHaveLength(2);
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(4);
    expect(count(world.app, "dispensing_records")).toBe(2);

    const backwards = await world.pharmacist.client.post(
      `/api/requests/${request.id}/transition`,
      { to: "approved" }
    );
    expect(backwards.status).toBe(409);
  });

  it("blocks moving back or cancelling after part of it was handed over", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const request = await readyRequest(world, itemId, 6);
    await dispense(world.pharmacist.client, request.id, { qty: 2 });
    const back = await world.pharmacist.client.post(
      `/api/requests/${request.id}/transition`,
      { to: "approved" }
    );
    expect(back.error?.code).toBe("invalid_transition");
    const cancel = await world.pharmacist.client.post(
      `/api/requests/${request.id}/cancel`,
      {}
    );
    expect(cancel.error?.code).toBe("invalid_transition");
  });
});

describe("availability at hand-over", () => {
  it("refuses a short quantity with a message naming what is available", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [{ qty: 3 }]);
    const request = await readyRequest(world, itemId, 5);
    const refused = await dispense(world.pharmacist.client, request.id);
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe("insufficient_stock");
    expect(refused.error?.message).toContain("Only 3 tab in stock");
    expect(refused.error?.details).toMatchObject({
      available: 3,
      requested: 5,
    });
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(3);
    expect(count(world.app, "dispensing_records")).toBe(0);
  });

  it("hands over what is available when allowPartial is sent", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [{ qty: 3 }]);
    const request = await readyRequest(world, itemId, 5);
    const result = await dispense(world.pharmacist.client, request.id, {
      allowPartial: true,
    });
    expect(result.status).toBe(200);
    expect(result.data.partial).toBe(true);
    expect(result.data.record.qty).toBe(3);
    expect(result.data.request).toMatchObject({
      dispensedQty: 3,
      remaining: 2,
      status: "ready",
    });
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(0);
  });

  it("skips an expired batch and draws only on dispensable stock", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [
      { expiry: "2026-11-01", qty: 9 },
      { expiry: "2027-01-01", qty: 4 },
    ]);
    const request = await readyRequest(world, itemId, 4);
    const result = await dispense(world.pharmacist.client, request.id);
    expect(result.data.record.lines.map((line) => line.batchNumber)).toEqual([
      "LOT-B",
    ]);
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(9);
  });

  it("re-validates when a batch expires between approval and hand-over", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [
      { expiry: "2026-11-20", qty: 5 },
    ]);
    const request = await readyRequest(world, itemId, 5);

    // Nine days later (facility date 2026-11-21) the only batch is expired.
    world.app.clock.set("2026-11-21T02:00:00.000Z");
    await relogin(world);
    const refused = await dispense(world.pharmacist.client, request.id);
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe("insufficient_stock");
    expect(refused.error?.message).toContain("expired");
    expect(refused.error?.details).toMatchObject({ available: 0, expired: 5 });
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(5);

    const stillReady = await world.admin.client.get<RequestDto>(
      `/api/requests/${request.id}`
    );
    expect(stillReady.data.status).toBe("ready");
    expect(stillReady.data.availableNow).toBe(0);
  });

  it("reduces the hand-over when only part of the stock expired", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [
      { expiry: "2026-11-20", qty: 3 },
      { expiry: "2027-06-01", qty: 4 },
    ]);
    const request = await readyRequest(world, itemId, 7);
    world.app.clock.set("2026-11-21T02:00:00.000Z");
    await relogin(world);
    const refused = await dispense(world.pharmacist.client, request.id);
    expect(refused.error?.message).toContain("Only 4 tab in stock");
    const partial = await dispense(world.pharmacist.client, request.id, {
      allowPartial: true,
    });
    expect(partial.data.record.qty).toBe(4);
    expect(partial.data.request.remaining).toBe(3);
  });
});

describe("races", () => {
  it("re-plans once from fresh data when a batch changes right before the write", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [
      { expiry: "2026-12-01", qty: 5 },
      { expiry: "2027-02-01", qty: 10 },
    ]);
    const request = await readyRequest(world, itemId, 5);

    const original = world.app.db.batch.bind(world.app.db);
    let raced = false;
    world.app.db.batch = (async (statements: D1PreparedStatement[]) => {
      if (!raced && statements.length > 3) {
        raced = true;
        world.app.sqlite
          .prepare("UPDATE batches SET qty = 2 WHERE id = ?")
          .run(batchIds[0]);
      }
      return await original(statements);
    }) as typeof world.app.db.batch;

    const result = await dispense(world.pharmacist.client, request.id);
    expect(raced).toBe(true);
    expect(result.status).toBe(200);
    expect(
      result.data.record.lines.map((line) => [line.batchNumber, line.qty])
    ).toEqual([
      ["LOT-A", 2],
      ["LOT-B", 3],
    ]);
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(0);
    expect(batchQty(world.app.sqlite, batchIds[1])).toBe(7);
  });

  it("gives up with 409 stock_conflict when the race repeats", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [{ qty: 50 }]);
    const request = await readyRequest(world, itemId, 5);

    const original = world.app.db.batch.bind(world.app.db);
    // Someone else drains the batch just before each of our writes: 50 → 3 → 1.
    const drained = [3, 1];
    world.app.db.batch = (async (statements: D1PreparedStatement[]) => {
      const next = drained.shift();
      if (next !== undefined && statements.length > 3) {
        world.app.sqlite
          .prepare("UPDATE batches SET qty = ? WHERE id = ?")
          .run(next, batchIds[0]);
      }
      return await original(statements);
    }) as typeof world.app.db.batch;

    const result = await dispense(world.pharmacist.client, request.id, {
      allowPartial: true,
    });
    expect(result.status).toBe(409);
    expect(result.error?.code).toBe("stock_conflict");
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(1);
    expect(count(world.app, "dispensing_records")).toBe(0);
    expect(count(world.app, "stock_movements")).toBe(0);
  });

  it("never lets two competing hand-overs drive stock negative", async () => {
    const world = await createWorld();
    const { batchIds, itemId } = stockItem(world.app, [{ qty: 6 }]);
    const a = await readyRequest(world, itemId, 5);
    const b = await readyRequest(world, itemId, 5);

    const results = await Promise.all([
      dispense(world.pharmacist.client, a.id),
      dispense(world.admin.client, b.id),
    ]);
    const statuses = results.map((result) => result.status).toSorted();
    expect(statuses).toEqual([200, 409]);
    expect(batchQty(world.app.sqlite, batchIds[0])).toBe(1);
    expect(count(world.app, "dispensing_records")).toBe(1);
    const failed = results.find((result) => result.status === 409);
    expect(failed?.error?.code).toBe("insufficient_stock");
  });
});

describe("shared dispensing service", () => {
  it("is the one code path for both the queue hand-over and Quick Deduct", async () => {
    const world = await createWorld();
    const spy = vi.spyOn(dispenseModule, "dispenseStock");
    try {
      const { itemId } = stockItem(world.app, [{ qty: 20 }]);
      const request = await readyRequest(world, itemId, 2);
      await dispense(world.pharmacist.client, request.id);
      expect(spy).toHaveBeenCalledTimes(1);

      const deduct = await world.nurse.client.post("/api/quick-deduct", {
        itemId,
        qty: 1,
      });
      expect(deduct.status).toBe(201);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("response shape", () => {
  it("returns the updated request and the record with per-batch lines", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const request = await readyRequest(world, itemId, 2);
    const { data } = await dispense(world.pharmacist.client, request.id);
    const typed: DispenseResultDto = data;
    expect(typed.record.lines).toHaveLength(1);
    expect(typed.request.dispensing[0].id).toBe(typed.record.id);
  });
});
