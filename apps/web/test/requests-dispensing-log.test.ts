import { describe, expect, it } from "vitest";

import type {
  DispensingRecordDto,
  MonthlyDispensingDto,
} from "../shared/schemas/requests";
import {
  createWorld,
  dispense,
  readyRequest,
  relogin,
  stockItem,
  type World,
} from "./requests-helpers";

async function log(world: World, query: Record<string, string> = {}) {
  const response = await world.admin.client.get<DispensingRecordDto[]>(
    "/api/dispensing",
    query
  );
  expect(response.status).toBe(200);
  return response;
}

async function seedDispensing(world: World) {
  const aspirin = stockItem(
    world.app,
    [
      { expiry: "2026-12-01", qty: 4 },
      { expiry: "2027-02-01", qty: 20 },
    ],
    "Aspirin"
  );
  const gauze = stockItem(world.app, [{ qty: 20 }], "Gauze");
  const request = await readyRequest(world, aspirin.itemId, 6);
  await dispense(world.pharmacist.client, request.id);
  // Same-instant records tie-break on a random UUID, so keep the order deterministic.
  world.app.clock.advance(1000);
  const quick = await world.nurse.client.post<{ record: DispensingRecordDto }>(
    "/api/quick-deduct",
    { itemId: gauze.itemId, qty: 2, recipient: "Walk-in Ben" }
  );
  return { aspirin, gauze, quick: quick.data.record, request };
}

describe("GET /api/dispensing", () => {
  it("lists records newest first with per-batch lines and paging meta", async () => {
    const world = await createWorld();
    const seeded = await seedDispensing(world);
    world.app.clock.advance(60_000);

    const response = await log(world);
    expect(response.data.map((record) => record.source)).toEqual([
      "quick_deduct",
      "queue",
    ]);
    const queue = response.data[1];
    expect(queue.requestCode).toBe(seeded.request.code);
    expect(queue.lines.map((line) => [line.batchNumber, line.qty])).toEqual([
      ["LOT-A", 4],
      ["LOT-B", 2],
    ]);
    expect(response.body).toMatchObject({
      meta: { limit: 50, offset: 0, total: 2 },
    });

    const paged = await log(world, { limit: "1", offset: "1" });
    expect(paged.data).toHaveLength(1);
    expect(paged.data[0].id).toBe(queue.id);
  });

  it("filters by source, item, search, user and date", async () => {
    const world = await createWorld();
    const seeded = await seedDispensing(world);

    expect((await log(world, { source: "queue" })).data).toHaveLength(1);
    expect(
      (await log(world, { itemId: seeded.gauze.itemId })).data
    ).toHaveLength(1);
    expect((await log(world, { search: "walk-in" })).data).toHaveLength(1);
    expect((await log(world, { search: "lot-b" })).data).toHaveLength(1);
    expect(
      (await log(world, { search: seeded.request.code })).data
    ).toHaveLength(1);
    expect(
      (await log(world, { dispensedBy: world.nurse.user.id })).data
    ).toHaveLength(1);
    expect(
      (await log(world, { from: "2026-11-12", to: "2026-11-12" })).data
    ).toHaveLength(2);
    expect((await log(world, { from: "2026-11-13" })).data).toHaveLength(0);
    expect((await log(world, { to: "2026-11-11" })).data).toHaveLength(0);
    expect(
      (await world.admin.client.get("/api/dispensing", { from: "bad" })).status
    ).toBe(400);
  });

  it("hides undone records unless asked", async () => {
    const world = await createWorld();
    const seeded = await seedDispensing(world);
    await world.nurse.client.post(`/api/quick-deduct/${seeded.quick.id}/undo`);
    expect((await log(world)).data).toHaveLength(1);
    const all = await log(world, { includeUndone: "1" });
    expect(all.data).toHaveLength(2);
    expect(
      all.data.find((record) => record.id === seeded.quick.id)?.undoneAt
    ).not.toBeNull();
  });

  it("is closed to nurses and open to pharmacists, inventory and health admins", async () => {
    const world = await createWorld();
    expect((await world.nurse.client.get("/api/dispensing")).status).toBe(403);
    for (const who of [world.pharmacist, world.inventory, world.healthAdmin]) {
      expect((await who.client.get("/api/dispensing")).status).toBe(200);
    }
  });
});

describe("GET /api/dispensing/monthly", () => {
  it("aggregates per item and per batch, excluding undone records", async () => {
    const world = await createWorld();
    const seeded = await seedDispensing(world);
    const extra = await world.nurse.client.post<{
      record: DispensingRecordDto;
    }>("/api/quick-deduct", { itemId: seeded.aspirin.itemId, qty: 3 });
    await world.nurse.client.post(
      `/api/quick-deduct/${extra.data.record.id}/undo`
    );

    const monthly = await world.pharmacist.client.get<MonthlyDispensingDto>(
      "/api/dispensing/monthly",
      { month: "2026-11" }
    );
    expect(monthly.status).toBe(200);
    expect(monthly.data.timezone).toBe("Asia/Manila");
    expect(monthly.data.totalQty).toBe(8);
    const [aspirin, gauze] = monthly.data.items;
    expect(aspirin).toMatchObject({ itemName: "Aspirin 500 mg", totalQty: 6 });
    expect(
      aspirin.batches.map((batch) => [batch.batchNumber, batch.qty])
    ).toEqual([
      ["LOT-A", 4],
      ["LOT-B", 2],
    ]);
    expect(gauze).toMatchObject({ itemName: "Gauze 500 mg", totalQty: 2 });

    const december = await world.pharmacist.client.get<MonthlyDispensingDto>(
      "/api/dispensing/monthly",
      { month: "2026-12" }
    );
    expect(december.data.items).toEqual([]);
    expect(
      (
        await world.pharmacist.client.get("/api/dispensing/monthly", {
          month: "bad",
        })
      ).status
    ).toBe(400);
  });

  it("uses the facility-timezone month boundary, not UTC", async () => {
    // 2026-10-31 17:30 UTC is already 2026-11-01 01:30 in Manila → November.
    const world = await createWorld("2026-10-31T17:30:00.000Z");
    const { itemId } = stockItem(world.app, [
      { expiry: "2027-06-01", qty: 10 },
    ]);
    await world.nurse.client.post("/api/quick-deduct", { itemId, qty: 2 });
    // 2026-11-30 16:30 UTC is 2026-12-01 00:30 in Manila → December.
    world.app.clock.set("2026-11-30T16:30:00.000Z");
    await relogin(world);
    await world.nurse.client.post("/api/quick-deduct", { itemId, qty: 3 });

    const get = async (month: string) =>
      (
        await world.admin.client.get<MonthlyDispensingDto>(
          "/api/dispensing/monthly",
          {
            month,
          }
        )
      ).data;
    expect((await get("2026-10")).totalQty).toBe(0);
    expect((await get("2026-11")).totalQty).toBe(2);
    expect((await get("2026-12")).totalQty).toBe(3);
  });
});
