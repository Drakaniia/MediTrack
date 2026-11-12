import { describe, expect, it } from "vitest";

import type { ExpiryRowDto } from "../shared/schemas/expiry";
import type { BatchDto } from "../shared/schemas/inventory";
import { createTestApp, type TestApp, type TestClient } from "./app";
import {
  auditOf,
  batchState,
  countRows,
  day,
  interceptPrepare,
  movementsOf,
} from "./expiry-helpers";
import { batchQty, insertBatch, insertItem } from "./fixtures";

const CAS_UPDATE = /^UPDATE batches SET qty/;

interface Arranged {
  admin: TestClient;
  app: TestApp;
  batchId: string;
  itemId: string;
}

/** An item with one healthy batch of 10 (expires in 60 days). */
async function arrange(): Promise<Arranged> {
  const app = await createTestApp();
  const itemId = insertItem(app.sqlite, {
    name: "Ibuprofen",
    strength: "200 mg",
  });
  const batchId = insertBatch(app.sqlite, {
    batchNumber: "IBU-1",
    expiry: day(60),
    itemId,
    qty: 10,
  });
  return { admin: await app.loginAs("admin"), app, batchId, itemId };
}

describe("POST /api/batches/:id/adjust", () => {
  it("sets an absolute quantity and writes the ledger and audit rows", async () => {
    const { admin, app, batchId } = await arrange();
    const response = await admin.post<BatchDto>(
      `/api/batches/${batchId}/adjust`,
      {
        newQty: 7,
        note: "Recount",
        reason: "count_correction",
      }
    );
    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({ fefoRank: 1, id: batchId, qty: 7 });
    expect(batchQty(app.sqlite, batchId)).toBe(7);

    const [movement] = movementsOf(app, batchId);
    expect(movement).toMatchObject({
      kind: "adjust",
      note: "Recount",
      qty_after: 7,
      qty_delta: -3,
      reason: "Count correction",
      ref_id: null,
    });
    const [audit] = auditOf(app, "stock.adjust");
    expect(audit.entity_type).toBe("batch");
    expect(audit.entity_id).toBe(batchId);
    expect(JSON.parse(audit.before ?? "null")).toEqual({ qty: 10 });
    expect(JSON.parse(audit.after ?? "null")).toMatchObject({
      qty: 7,
      reason: "count_correction",
    });
    expect(audit.summary).toContain("Ibuprofen 200 mg");
  });

  it("applies a relative delta, up and down", async () => {
    const { admin, app, batchId } = await arrange();
    const up = await admin.post<BatchDto>(`/api/batches/${batchId}/adjust`, {
      delta: 5,
      reason: "found",
    });
    expect(up.data.qty).toBe(15);
    const down = await admin.post<BatchDto>(`/api/batches/${batchId}/adjust`, {
      delta: -15,
      reason: "damaged",
    });
    expect(down.data.qty).toBe(0);
    expect(
      movementsOf(app, batchId).map((row) => [row.qty_delta, row.qty_after])
    ).toEqual([
      [5, 15],
      [-15, 0],
    ]);
  });

  it("refuses a result below zero and leaves everything untouched", async () => {
    const { admin, app, batchId } = await arrange();
    const response = await admin.post(`/api/batches/${batchId}/adjust`, {
      delta: -11,
      reason: "damaged",
    });
    expect(response.status).toBe(400);
    expect(response.error?.code).toBe("validation_error");
    expect(batchQty(app.sqlite, batchId)).toBe(10);
    expect(movementsOf(app, batchId)).toHaveLength(0);
    expect(auditOf(app, "stock.adjust")).toHaveLength(0);
  });

  it("validates the body: exactly one of newQty / delta, a reason, whole numbers", async () => {
    const { admin, app, batchId } = await arrange();
    const bodies: unknown[] = [
      { reason: "other" },
      { delta: 1, newQty: 5, reason: "other" },
      { newQty: 5 },
      { newQty: -1, reason: "other" },
      { newQty: 2.5, reason: "other" },
      { delta: 0, reason: "other" },
      { newQty: 5, reason: "theft" },
      { newQty: 10, reason: "other" },
    ];
    for (const body of bodies) {
      const response = await admin.post(`/api/batches/${batchId}/adjust`, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.error?.code).toBe("validation_error");
    }
    expect(countRows(app, "stock_movements")).toBe(0);
  });

  it("refuses expired, disposed and trashed batches and unknown ids", async () => {
    const { admin, app, itemId } = await arrange();
    const expired = insertBatch(app.sqlite, {
      batchNumber: "EXP",
      expiry: day(-1),
      itemId,
      qty: 4,
    });
    const disposed = insertBatch(app.sqlite, {
      batchNumber: "DISP",
      expiry: day(60),
      itemId,
      qty: 0,
      status: "disposed",
    });
    const trashed = insertBatch(app.sqlite, {
      batchNumber: "TRASH",
      deleted: true,
      expiry: day(60),
      itemId,
    });
    const body = { delta: 1, reason: "found" };

    const expiredResponse = await admin.post(
      `/api/batches/${expired}/adjust`,
      body
    );
    expect(expiredResponse.status).toBe(409);
    expect(expiredResponse.error?.code).toBe("expired_stock");
    expect(
      (await admin.post(`/api/batches/${disposed}/adjust`, body)).error?.code
    ).toBe("conflict");
    expect(
      (await admin.post(`/api/batches/${trashed}/adjust`, body)).error?.code
    ).toBe("conflict");
    expect((await admin.post("/api/batches/nope/adjust", body)).status).toBe(
      404
    );
    expect(batchQty(app.sqlite, expired)).toBe(4);
  });

  it("allows same-day expiry (still dispensable) and no-expiry batches", async () => {
    const { admin, app, itemId } = await arrange();
    const today = insertBatch(app.sqlite, {
      batchNumber: "TODAY",
      expiry: day(0),
      itemId,
      qty: 4,
    });
    const supplies = insertItem(app.sqlite, {
      hasExpiry: false,
      name: "Bandage",
    });
    const none = insertBatch(app.sqlite, {
      batchNumber: "NONE",
      expiry: null,
      itemId: supplies,
      qty: 4,
    });
    for (const id of [today, none]) {
      const response = await admin.post(`/api/batches/${id}/adjust`, {
        delta: 1,
        reason: "found",
      });
      expect(response.status).toBe(200);
    }
  });

  it("follows the role matrix: admin, inventory and pharmacist adjust; nurse and health admin cannot", async () => {
    const { app, batchId } = await arrange();
    for (const role of ["admin", "inventory", "pharmacist"] as const) {
      const client = await app.loginAs(role);
      const response = await client.post(`/api/batches/${batchId}/adjust`, {
        delta: 1,
        reason: "found",
      });
      expect(response.status, role).toBe(200);
    }
    for (const role of ["nurse", "health_admin"] as const) {
      const client = await app.loginAs(role);
      const response = await client.post(`/api/batches/${batchId}/adjust`, {
        delta: 1,
        reason: "found",
      });
      expect(response.status, role).toBe(403);
      expect(response.error?.code).toBe("forbidden");
    }
    expect(batchQty(app.sqlite, batchId)).toBe(13);
  });

  it("answers 409 stock_conflict when the quantity changes between plan and write", async () => {
    const { admin, app, batchId } = await arrange();
    interceptPrepare(app, CAS_UPDATE, () => {
      app.sqlite
        .prepare("UPDATE batches SET qty = 4 WHERE id = ?")
        .run(batchId);
    });

    const response = await admin.post(`/api/batches/${batchId}/adjust`, {
      newQty: 7,
      reason: "count_correction",
    });
    expect(response.status).toBe(409);
    expect(response.error?.code).toBe("stock_conflict");
    expect(batchQty(app.sqlite, batchId)).toBe(4);
    expect(movementsOf(app, batchId)).toHaveLength(0);
    expect(auditOf(app, "stock.adjust")).toHaveLength(0);

    // A retry against the new quantity goes through.
    const retry = await admin.post(`/api/batches/${batchId}/adjust`, {
      newQty: 7,
      reason: "count_correction",
    });
    expect(retry.status).toBe(200);
    expect(batchQty(app.sqlite, batchId)).toBe(7);
  });

  it("a concurrent dispose makes the adjust fail instead of resurrecting stock", async () => {
    const { admin, app, batchId } = await arrange();
    interceptPrepare(app, CAS_UPDATE, () => {
      app.sqlite
        .prepare("UPDATE batches SET qty = 0, status = 'disposed' WHERE id = ?")
        .run(batchId);
    });
    const response = await admin.post(`/api/batches/${batchId}/adjust`, {
      delta: 5,
      reason: "found",
    });
    expect(response.error?.code).toBe("stock_conflict");
    expect(batchState(app, batchId)).toMatchObject({
      qty: 0,
      status: "disposed",
    });
  });
});

describe("POST /api/batches/:id/dispose", () => {
  async function arrangeExpired(): Promise<Arranged> {
    const arranged = await arrange();
    const batchId = insertBatch(arranged.app.sqlite, {
      batchNumber: "OLD-1",
      expiry: day(-10),
      itemId: arranged.itemId,
      qty: 6,
    });
    return { ...arranged, batchId };
  }

  it("writes off the whole remaining quantity with disposal, ledger and audit rows", async () => {
    const { admin, app, batchId, itemId } = await arrangeExpired();
    const response = await admin.post<{ id: string; qty: number }>(
      `/api/batches/${batchId}/dispose`,
      { note: "Incinerated", reason: "expired" }
    );
    expect(response.status).toBe(200);
    expect(response.data.qty).toBe(6);

    expect(batchState(app, batchId)).toMatchObject({
      qty: 0,
      status: "disposed",
    });
    expect(batchState(app, batchId).disposed_at).toBe(
      "2026-11-12T02:00:00.000Z"
    );

    const disposal = app.sqlite
      .prepare("SELECT * FROM disposals WHERE batch_id = ?")
      .get(batchId) as Record<string, unknown>;
    expect(disposal).toMatchObject({
      batch_number: "OLD-1",
      disposed_at: "2026-11-12T02:00:00.000Z",
      expiry: day(-10),
      id: response.data.id,
      item_id: itemId,
      item_name: "Ibuprofen 200 mg",
      note: "Incinerated",
      qty: 6,
      reason: "expired",
    });
    expect(disposal.disposed_by_name).toEqual(expect.stringContaining("admin"));

    const [movement] = movementsOf(app, batchId);
    expect(movement).toMatchObject({
      kind: "dispose",
      qty_after: 0,
      qty_delta: -6,
      ref_id: response.data.id,
      ref_type: "disposal",
    });
    const [audit] = auditOf(app, "stock.dispose");
    expect(audit.entity_id).toBe(batchId);
    expect(JSON.parse(audit.before ?? "null")).toMatchObject({
      qty: 6,
      status: "active",
    });
    expect(JSON.parse(audit.after ?? "null")).toMatchObject({
      qty: 0,
      status: "disposed",
    });
  });

  it("accepts 'expired' only for a batch that has actually expired", async () => {
    const { admin, app, batchId } = await arrange();
    const response = await admin.post(`/api/batches/${batchId}/dispose`, {
      reason: "expired",
    });
    expect(response.status).toBe(400);
    expect(response.error?.code).toBe("validation_error");
    expect(response.error?.message).toBe("The request is not valid.");
    expect(JSON.stringify(response.error?.details)).toContain(
      "Batch has not expired"
    );
    expect(batchState(app, batchId).status).toBe("active");

    const damaged = await admin.post(`/api/batches/${batchId}/dispose`, {
      reason: "damaged",
    });
    expect(damaged.status).toBe(200);
  });

  it("treats a batch expiring today as not yet expired", async () => {
    const { admin, app, itemId } = await arrange();
    const today = insertBatch(app.sqlite, {
      batchNumber: "TODAY",
      expiry: day(0),
      itemId,
      qty: 2,
    });
    const response = await admin.post(`/api/batches/${today}/dispose`, {
      reason: "expired",
    });
    expect(response.status).toBe(400);
  });

  it("requires a valid reason", async () => {
    const { admin, batchId } = await arrangeExpired();
    for (const body of [{}, { reason: "" }, { reason: "theft" }]) {
      expect(
        (await admin.post(`/api/batches/${batchId}/dispose`, body)).status
      ).toBe(400);
    }
  });

  it("refuses a second disposal, empty batches, trashed batches and unknown ids", async () => {
    const { admin, app, batchId, itemId } = await arrangeExpired();
    expect(
      (
        await admin.post(`/api/batches/${batchId}/dispose`, {
          reason: "expired",
        })
      ).status
    ).toBe(200);
    const again = await admin.post(`/api/batches/${batchId}/dispose`, {
      reason: "expired",
    });
    expect(again.status).toBe(409);
    expect(again.error?.code).toBe("conflict");
    expect(countRows(app, "disposals")).toBe(1);

    const empty = insertBatch(app.sqlite, {
      batchNumber: "EMPTY",
      expiry: day(-2),
      itemId,
      qty: 0,
    });
    expect(
      (await admin.post(`/api/batches/${empty}/dispose`, { reason: "other" }))
        .status
    ).toBe(409);
    const trashed = insertBatch(app.sqlite, {
      batchNumber: "TR",
      deleted: true,
      expiry: day(-2),
      itemId,
    });
    expect(
      (await admin.post(`/api/batches/${trashed}/dispose`, { reason: "other" }))
        .status
    ).toBe(409);
    expect(
      (await admin.post("/api/batches/nope/dispose", { reason: "other" }))
        .status
    ).toBe(404);
  });

  it("follows the role matrix: pharmacist disposes; nurse and health admin cannot", async () => {
    const { app, batchId } = await arrangeExpired();
    for (const role of ["nurse", "health_admin"] as const) {
      const client = await app.loginAs(role);
      const response = await client.post(`/api/batches/${batchId}/dispose`, {
        reason: "expired",
      });
      expect(response.status, role).toBe(403);
    }
    expect(batchState(app, batchId).status).toBe("active");
    const pharmacist = await app.loginAs("pharmacist");
    const response = await pharmacist.post(`/api/batches/${batchId}/dispose`, {
      reason: "expired",
    });
    expect(response.status).toBe(200);
  });

  it("answers 409 stock_conflict when stock moves between plan and write", async () => {
    const { admin, app, batchId } = await arrangeExpired();
    interceptPrepare(app, /^UPDATE batches SET qty = 0/, () => {
      app.sqlite
        .prepare("UPDATE batches SET qty = 2 WHERE id = ?")
        .run(batchId);
    });
    const response = await admin.post(`/api/batches/${batchId}/dispose`, {
      reason: "expired",
    });
    expect(response.status).toBe(409);
    expect(response.error?.code).toBe("stock_conflict");
    expect(batchState(app, batchId)).toMatchObject({
      qty: 2,
      status: "active",
    });
    expect(countRows(app, "disposals")).toBe(0);
    expect(movementsOf(app, batchId)).toHaveLength(0);
    expect(auditOf(app, "stock.dispose")).toHaveLength(0);
  });

  it("takes the batch out of FEFO and out of 'available'", async () => {
    const { admin, app, itemId } = await arrange();
    app.sqlite
      .prepare("UPDATE items SET low_stock_threshold = 15 WHERE id = ?")
      .run(itemId);
    const first = insertBatch(app.sqlite, {
      batchNumber: "FIRST",
      expiry: day(5),
      itemId,
      qty: 4,
    });

    const before = await admin.get<ExpiryRowDto[]>("/api/expiry", {
      class: "safe,near_expiry,urgent",
    });
    expect(
      Object.fromEntries(
        before.data.map((row) => [row.batchNumber, row.fefoRank])
      )
    ).toEqual({
      FIRST: 1,
      "IBU-1": 2,
    });

    expect(
      (await admin.post(`/api/batches/${first}/dispose`, { reason: "damaged" }))
        .status
    ).toBe(200);

    const after = await admin.get<ExpiryRowDto[]>("/api/expiry", {
      class: "safe,near_expiry,urgent",
    });
    expect(after.data.map((row) => [row.batchNumber, row.fefoRank])).toEqual([
      ["IBU-1", 1],
    ]);
    const low = await admin.get<{ available: number }[]>("/api/low-stock");
    expect(low.data[0].available).toBe(10);
  });
});

describe("GET /api/quarantine", () => {
  it("lists expired stock still on the shelf, oldest first, with days overdue", async () => {
    const { admin, app, itemId } = await arrange();
    insertBatch(app.sqlite, {
      batchNumber: "NEWER",
      expiry: day(-2),
      itemId,
      qty: 3,
    });
    insertBatch(app.sqlite, {
      batchNumber: "OLDER",
      expiry: day(-30),
      itemId,
      qty: 8,
    });
    insertBatch(app.sqlite, {
      batchNumber: "TODAY",
      expiry: day(0),
      itemId,
      qty: 1,
    });
    insertBatch(app.sqlite, {
      batchNumber: "EMPTY",
      expiry: day(-5),
      itemId,
      qty: 0,
    });
    insertBatch(app.sqlite, {
      batchNumber: "DONE",
      expiry: day(-5),
      itemId,
      qty: 0,
      status: "disposed",
    });
    insertBatch(app.sqlite, {
      batchNumber: "TRASHED",
      deleted: true,
      expiry: day(-5),
      itemId,
    });

    const response =
      await admin.get<
        {
          batchNumber: string;
          canDispose: boolean;
          daysOverdue: number;
          qty: number;
        }[]
      >("/api/quarantine");
    expect(response.status).toBe(200);
    expect(
      response.data.map((row) => [row.batchNumber, row.daysOverdue, row.qty])
    ).toEqual([
      ["OLDER", 30, 8],
      ["NEWER", 2, 3],
    ]);
    expect(response.data[0]).toMatchObject({
      canDispose: true,
      displayName: "Ibuprofen 200 mg",
      expiry: day(-30),
    });
    expect(response.body).toMatchObject({ meta: { total: 2 } });
  });

  it("tells the viewer whether they may dispose", async () => {
    const { app, itemId } = await arrange();
    insertBatch(app.sqlite, {
      batchNumber: "OLD",
      expiry: day(-3),
      itemId,
      qty: 3,
    });
    const expected = {
      admin: true,
      health_admin: false,
      inventory: true,
      nurse: false,
      pharmacist: true,
    } as const;
    for (const [role, canDispose] of Object.entries(expected)) {
      const client = await app.loginAs(role as keyof typeof expected);
      const response =
        await client.get<{ canDispose: boolean }[]>("/api/quarantine");
      expect(response.status, role).toBe(200);
      expect(response.data[0].canDispose, role).toBe(canDispose);
    }
  });

  it("filters by search and pages", async () => {
    const { admin, app, itemId } = await arrange();
    const other = insertItem(app.sqlite, { name: "Zinc" });
    insertBatch(app.sqlite, {
      batchNumber: "A",
      expiry: day(-3),
      itemId,
      qty: 1,
    });
    insertBatch(app.sqlite, {
      batchNumber: "B",
      expiry: day(-4),
      itemId: other,
      qty: 1,
    });
    const found = await admin.get<{ batchNumber: string }[]>(
      "/api/quarantine",
      { search: "zinc" }
    );
    expect(found.data.map((row) => row.batchNumber)).toEqual(["B"]);
    const paged = await admin.get<unknown[]>("/api/quarantine", { limit: 1 });
    expect(paged.data).toHaveLength(1);
    expect(paged.body).toMatchObject({ meta: { total: 2 } });
  });

  it("moves a batch out once it is disposed", async () => {
    const { admin, app, itemId } = await arrange();
    const batchId = insertBatch(app.sqlite, {
      batchNumber: "OLD",
      expiry: day(-3),
      itemId,
      qty: 3,
    });
    await admin.post(`/api/batches/${batchId}/dispose`, { reason: "expired" });
    const response = await admin.get<unknown[]>("/api/quarantine");
    expect(response.data).toHaveLength(0);
  });
});

describe("GET /api/disposals", () => {
  interface DisposalRow {
    batchNumber: string;
    disposedAt: string;
    qty: number;
    reason: string;
  }

  async function arrangeDisposals(): Promise<Arranged> {
    const arranged = await arrange();
    const { app, itemId } = arranged;
    const plan = [
      { batchNumber: "D-ONE", expiry: day(-3), qty: 1, reason: "expired" },
      { batchNumber: "D-TWO", expiry: day(40), qty: 2, reason: "damaged" },
      { batchNumber: "D-THREE", expiry: day(40), qty: 3, reason: "recalled" },
    ];
    for (const [index, entry] of plan.entries()) {
      const id = insertBatch(app.sqlite, {
        batchNumber: entry.batchNumber,
        expiry: entry.expiry,
        itemId,
        qty: entry.qty,
      });
      // A fresh session each day: the fake clock jumps past the idle timeout.
      const actor = await app.loginAs("admin");
      const response = await actor.post(`/api/batches/${id}/dispose`, {
        note: index === 2 ? "Supplier recall 77" : "",
        reason: entry.reason,
      });
      expect(response.status).toBe(200);
      // One day later each time (facility-local dates 12th, 13th, 14th).
      app.clock.advance(24 * 60 * 60 * 1000);
    }
    return { ...arranged, admin: await app.loginAs("admin") };
  }

  it("pages the log newest first", async () => {
    const { admin } = await arrangeDisposals();
    const response = await admin.get<DisposalRow[]>("/api/disposals");
    expect(response.status).toBe(200);
    expect(response.data.map((row) => row.batchNumber)).toEqual([
      "D-THREE",
      "D-TWO",
      "D-ONE",
    ]);
    expect(response.body).toMatchObject({ meta: { total: 3 } });
    const second = await admin.get<DisposalRow[]>("/api/disposals", {
      limit: 1,
      offset: 1,
    });
    expect(second.data.map((row) => row.batchNumber)).toEqual(["D-TWO"]);
  });

  it("filters by reason, facility-local date range and search", async () => {
    const { admin } = await arrangeDisposals();
    const byReason = await admin.get<DisposalRow[]>("/api/disposals", {
      reason: "damaged,recalled",
    });
    expect(byReason.data.map((row) => row.reason)).toEqual([
      "recalled",
      "damaged",
    ]);

    // Disposed at 10:00 Manila on 12, 13 and 14 November.
    const day13 = await admin.get<DisposalRow[]>("/api/disposals", {
      from: "2026-11-13",
      to: "2026-11-13",
    });
    expect(day13.data.map((row) => row.batchNumber)).toEqual(["D-TWO"]);
    const fromOnly = await admin.get<DisposalRow[]>("/api/disposals", {
      from: "2026-11-13",
    });
    expect(fromOnly.data).toHaveLength(2);
    const toOnly = await admin.get<DisposalRow[]>("/api/disposals", {
      to: "2026-11-12",
    });
    expect(toOnly.data.map((row) => row.batchNumber)).toEqual(["D-ONE"]);

    const byNote = await admin.get<DisposalRow[]>("/api/disposals", {
      search: "recall 77",
    });
    expect(byNote.data.map((row) => row.batchNumber)).toEqual(["D-THREE"]);
    const byBatch = await admin.get<DisposalRow[]>("/api/disposals", {
      search: "d-tw",
    });
    expect(byBatch.data.map((row) => row.batchNumber)).toEqual(["D-TWO"]);
  });

  it("puts a disposal at 00:30 Manila on the Manila date, not the UTC date", async () => {
    const app = await createTestApp({ now: "2026-11-11T16:30:00.000Z" });
    const admin = await app.loginAs("admin");
    const itemId = insertItem(app.sqlite, { name: "Late" });
    const batchId = insertBatch(app.sqlite, {
      expiry: day(-1),
      itemId,
      qty: 2,
    });
    await admin.post(`/api/batches/${batchId}/dispose`, { reason: "expired" });

    const onTwelfth = await admin.get<unknown[]>("/api/disposals", {
      from: "2026-11-12",
      to: "2026-11-12",
    });
    expect(onTwelfth.data).toHaveLength(1);
    const onEleventh = await admin.get<unknown[]>("/api/disposals", {
      from: "2026-11-11",
      to: "2026-11-11",
    });
    expect(onEleventh.data).toHaveLength(0);
  });

  it("is readable by admin, inventory, pharmacist and health admin, not by nurses", async () => {
    const { app } = await arrangeDisposals();
    for (const role of [
      "admin",
      "inventory",
      "pharmacist",
      "health_admin",
    ] as const) {
      const client = await app.loginAs(role);
      expect((await client.get("/api/disposals")).status, role).toBe(200);
    }
    const nurse = await app.loginAs("nurse");
    const denied = await nurse.get("/api/disposals");
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe("forbidden");
  });

  it("rejects unknown reasons", async () => {
    const { admin } = await arrange();
    expect(
      (await admin.get("/api/disposals", { reason: "theft" })).status
    ).toBe(400);
  });
});
