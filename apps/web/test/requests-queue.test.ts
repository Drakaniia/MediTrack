import { describe, expect, it } from "vitest";

import type { ArchiveResultDto, RequestDto } from "../shared/schemas/requests";
import { insertBatch } from "./fixtures";
import {
  count,
  createRequest,
  createWorld,
  readyRequest,
  relogin,
  rows,
  stockItem,
  type World,
} from "./requests-helpers";

async function listAll(world: World, query: Record<string, string> = {}) {
  const response = await world.admin.client.get<RequestDto[]>(
    "/api/requests",
    query
  );
  expect(response.status).toBe(200);
  return response.data;
}

describe("creating requests", () => {
  it("creates one request per line, all or nothing, with REQ-year-NNNN codes", async () => {
    const world = await createWorld();
    const a = stockItem(world.app, [{ qty: 10 }], "Aspirin");
    const b = stockItem(world.app, [{ qty: 4 }], "Ibuprofen");

    const response = await world.nurse.client.post<RequestDto[]>(
      "/api/requests",
      {
        lines: [
          { itemId: a.itemId, qty: 3 },
          { itemId: b.itemId, qty: 2, unit: "strip" },
        ],
        reason: "Ward 4",
        requestor: { name: "Ana", ref: "STU-1" },
      }
    );

    expect(response.status).toBe(201);
    expect(response.data.map((request) => request.code)).toEqual([
      "REQ-2026-0001",
      "REQ-2026-0002",
    ]);
    const [first, second] = response.data;
    expect(first).toMatchObject({
      itemName: "Aspirin 500 mg",
      qty: 3,
      reason: "Ward 4",
      remaining: 3,
      requestedByName: world.nurse.user.displayName,
      requestor: { name: "Ana", ref: "STU-1" },
      source: "queue",
      status: "pending",
      unit: "tab",
    });
    expect(second.unit).toBe("strip");
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({
      fromStatus: null,
      toStatus: "pending",
    });
    expect(count(world.app, "audit_log", "action = 'request.create'")).toBe(2);
  });

  it("validates quantity, item and lines without creating anything", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const post = (body: unknown) =>
      world.nurse.client.post("/api/requests", body);

    for (const qty of [0, -1, 1.5, "3"]) {
      const bad = await post({ lines: [{ itemId, qty }] });
      expect(bad.status, String(qty)).toBe(400);
      expect(bad.error?.code).toBe("validation_error");
    }
    expect((await post({ lines: [] })).status).toBe(400);
    expect((await post({ lines: [{ itemId: "nope", qty: 1 }] })).status).toBe(
      404
    );
    // One bad line rejects the whole submission.
    const mixed = await post({
      lines: [
        { itemId, qty: 1 },
        { itemId: "missing", qty: 1 },
      ],
    });
    expect(mixed.status).toBe(404);
    expect(count(world.app, "requests")).toBe(0);
    expect(count(world.app, "counters")).toBe(0);
  });

  it("refuses a trashed item", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    world.app.sqlite
      .prepare("UPDATE items SET deleted_at = ? WHERE id = ?")
      .run("2026-11-12T00:00:00.000Z", itemId);
    const response = await world.nurse.client.post("/api/requests", {
      lines: [{ itemId, qty: 1 }],
    });
    expect(response.status).toBe(404);
  });

  it("allows a quantity above availability (it only warns in the UI)", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 2 }]);
    const request = await createRequest(world.nurse.client, itemId, 50);
    expect(request.qty).toBe(50);
    expect(request.availableNow).toBe(2);
  });
});

describe("request codes", () => {
  it("rolls over to a new sequence on the facility new year", async () => {
    // 2026-12-31 23:00 in Manila, then two hours later it is 2027-01-01 01:00.
    const world = await createWorld("2026-12-31T15:00:00.000Z");
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const first = await createRequest(world.nurse.client, itemId, 1);
    world.app.clock.advance(2 * 3_600_000);
    const second = await createRequest(world.nurse.client, itemId, 1);
    const third = await createRequest(world.nurse.client, itemId, 1);
    expect([first.code, second.code, third.code]).toEqual([
      "REQ-2026-0001",
      "REQ-2027-0001",
      "REQ-2027-0002",
    ]);
  });

  it("never hands out the same number twice under concurrent creates", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        createRequest(world.nurse.client, itemId, 1)
      )
    );
    const codes = results.map((request) => request.code);
    expect(new Set(codes).size).toBe(12);
    expect(codes.toSorted()).toEqual(
      Array.from(
        { length: 12 },
        (_, index) => `REQ-2026-${String(index + 1).padStart(4, "0")}`
      )
    );
  });
});

describe("availability", () => {
  it("counts only FEFO-eligible batches", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [
      { qty: 5 },
      { expiry: "2026-11-01", qty: 7 },
      { expiry: null, qty: 2 },
    ]);
    insertBatch(world.app.sqlite, { itemId, qty: 9, status: "disposed" });
    insertBatch(world.app.sqlite, { deleted: true, itemId, qty: 11 });
    insertBatch(world.app.sqlite, { itemId, qty: 0 });
    const request = await createRequest(world.nurse.client, itemId, 1);
    // 5 (future) + 2 (no expiry); expired 7, disposed 9, deleted 11 and empty are excluded.
    expect(request.availableNow).toBe(7);
  });

  it("treats a batch expiring today as still available", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ expiry: "2026-11-12", qty: 4 }]);
    const request = await createRequest(world.nurse.client, itemId, 1);
    expect(request.availableNow).toBe(4);
  });
});

describe("transitions", () => {
  it("walks pending → approved → ready and records history, audit and a board position", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const request = await createRequest(world.nurse.client, itemId, 2);

    const approved = await world.pharmacist.client.post<RequestDto>(
      `/api/requests/${request.id}/transition`,
      { note: "ok", to: "approved" }
    );
    expect(approved.status).toBe(200);
    expect(approved.data.status).toBe("approved");
    const ready = await world.pharmacist.client.post<RequestDto>(
      `/api/requests/${request.id}/transition`,
      { to: "ready" }
    );
    expect(ready.data.events.map((event) => event.toStatus)).toEqual([
      "pending",
      "approved",
      "ready",
    ]);
    expect(ready.data.events[1]).toMatchObject({
      actorName: world.pharmacist.user.displayName,
      fromStatus: "pending",
      note: "ok",
    });
    expect(count(world.app, "audit_log", "action = 'request.transition'")).toBe(
      2
    );
  });

  it("refuses moves the table forbids and claimed/cancelled through /transition", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const request = await createRequest(world.nurse.client, itemId, 2);
    const move = (to: string) =>
      world.pharmacist.client.post(`/api/requests/${request.id}/transition`, {
        to,
      });

    for (const to of ["claimed", "cancelled", "pending"]) {
      const refused = await move(to);
      expect(refused.status, to).toBe(409);
      expect(refused.error?.code).toBe("invalid_transition");
    }
    expect((await move("approved")).status).toBe(200);
    expect((await move("bogus")).status).toBe(400);
  });

  it("requires a deny reason from the enum and supports re-opening", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const request = await createRequest(world.nurse.client, itemId, 2);
    const url = `/api/requests/${request.id}/transition`;

    const missing = await world.pharmacist.client.post(url, { to: "denied" });
    expect(missing.status).toBe(400);
    const wrong = await world.pharmacist.client.post(url, {
      deniedReason: "Because",
      to: "denied",
    });
    expect(wrong.status).toBe(400);

    const denied = await world.pharmacist.client.post<RequestDto>(url, {
      deniedNote: "none left",
      deniedReason: "Out of Stock",
      to: "denied",
    });
    expect(denied.data).toMatchObject({
      deniedNote: "none left",
      deniedReason: "Out of Stock",
      status: "denied",
    });

    const reopened = await world.pharmacist.client.post<RequestDto>(url, {
      to: "pending",
    });
    expect(reopened.data).toMatchObject({
      deniedNote: "",
      deniedReason: null,
      status: "pending",
    });
  });

  it("only staff with requests.process may move a request", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const request = await createRequest(world.nurse.client, itemId, 2);
    const url = `/api/requests/${request.id}/transition`;
    for (const who of [world.nurse, world.inventory, world.healthAdmin]) {
      const refused = await who.client.post(url, { to: "approved" });
      expect(refused.status).toBe(403);
    }
    expect(
      (await world.admin.client.post(url, { to: "approved" })).status
    ).toBe(200);
  });
});

describe("cancel and edit", () => {
  it("lets the requester or staff cancel before hand-over, nobody else", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const mine = await createRequest(world.nurse.client, itemId, 2);
    const other = await world.inventory.client.post<RequestDto[]>(
      "/api/requests",
      {
        lines: [{ itemId, qty: 1 }],
      }
    );

    const stranger = await world.nurse.client.post(
      `/api/requests/${other.data[0].id}/cancel`,
      {}
    );
    expect(stranger.status).toBe(403);

    const own = await world.nurse.client.post<RequestDto>(
      `/api/requests/${mine.id}/cancel`,
      { note: "not needed" }
    );
    expect(own.data.status).toBe("cancelled");
    expect(own.data.events.at(-1)).toMatchObject({
      note: "not needed",
      toStatus: "cancelled",
    });

    const staff = await world.pharmacist.client.post<RequestDto>(
      `/api/requests/${other.data[0].id}/cancel`,
      {}
    );
    expect(staff.data.status).toBe("cancelled");
    expect(count(world.app, "audit_log", "action = 'request.cancel'")).toBe(2);

    const again = await world.pharmacist.client.post(
      `/api/requests/${mine.id}/cancel`,
      {}
    );
    expect(again.status).toBe(409);
    expect(again.error?.code).toBe("invalid_transition");
  });

  it("edits reason and requestor only while pending or approved", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const request = await createRequest(world.nurse.client, itemId, 2);
    const url = `/api/requests/${request.id}`;

    const edited = await world.nurse.client.patch<RequestDto>(url, {
      reason: "Updated",
      requestor: { name: "Ben" },
    });
    expect(edited.data).toMatchObject({
      reason: "Updated",
      requestor: { name: "Ben", ref: "" },
    });
    expect((await world.nurse.client.patch(url, {})).status).toBe(400);
    expect(
      (await world.inventory.client.patch(url, { reason: "x" })).status
    ).toBe(403);

    await world.pharmacist.client.post(`${url}/transition`, { to: "ready" });
    const late = await world.pharmacist.client.patch(url, { reason: "Late" });
    expect(late.status).toBe(409);
  });
});

describe("listing, ordering and archive", () => {
  it("filters by status, search, mine and date, and orders by status then board position", async () => {
    const world = await createWorld();
    const aspirin = stockItem(world.app, [{ qty: 10 }], "Aspirin");
    const gauze = stockItem(world.app, [{ qty: 10 }], "Gauze");
    const first = await createRequest(world.nurse.client, aspirin.itemId, 1);
    const second = await createRequest(world.nurse.client, gauze.itemId, 1);
    const third = await createRequest(
      world.inventory.client,
      aspirin.itemId,
      1
    );
    await world.pharmacist.client.post(
      `/api/requests/${second.id}/transition`,
      {
        to: "approved",
      }
    );

    const all = await listAll(world);
    expect(all.map((request) => request.id)).toEqual([
      second.id, // approved
      first.id, // pending, position 0
      third.id, // pending, position 2
    ]);
    expect(
      (await listAll(world, { status: "approved,denied" })).map((r) => r.id)
    ).toEqual([second.id]);
    expect(
      (await listAll(world, { search: "gauze" })).map((r) => r.id)
    ).toEqual([second.id]);
    expect(
      (await listAll(world, { search: first.code.toLowerCase() })).map(
        (r) => r.id
      )
    ).toEqual([first.id]);
    const mine = await world.inventory.client.get<RequestDto[]>(
      "/api/requests",
      {
        mine: 1,
      }
    );
    expect(mine.data.map((request) => request.id)).toEqual([third.id]);
    expect(await listAll(world, { datePreset: "today" })).toHaveLength(3);
    expect(
      await listAll(world, { datePreset: "custom", from: "2026-11-13" })
    ).toHaveLength(0);
    expect(
      await listAll(world, {
        datePreset: "custom",
        from: "2026-11-12",
        to: "2026-11-12",
      })
    ).toHaveLength(3);
  });

  it("reorders a column and ignores ids of other columns", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const a = await createRequest(world.nurse.client, itemId, 1);
    const b = await createRequest(world.nurse.client, itemId, 1);
    const c = await createRequest(world.nurse.client, itemId, 1);
    await world.pharmacist.client.post(`/api/requests/${c.id}/transition`, {
      to: "approved",
    });

    const reorder = await world.pharmacist.client.post(
      "/api/requests/reorder",
      {
        orderedIds: [b.id, a.id, c.id],
        status: "pending",
      }
    );
    expect(reorder.status).toBe(200);
    const pending = await listAll(world, { status: "pending" });
    expect(pending.map((request) => request.id)).toEqual([b.id, a.id]);
    const approved = await listAll(world, { status: "approved" });
    expect(approved[0].boardPosition).toBe(0);
    expect(count(world.app, "audit_log", "action = 'request.reorder'")).toBe(1);

    const forbidden = await world.nurse.client.post("/api/requests/reorder", {
      orderedIds: [a.id],
      status: "pending",
    });
    expect(forbidden.status).toBe(403);
  });

  it("hides claimed requests older than 24 h from the board but keeps them reachable", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const claimed = await readyRequest(world, itemId, 1);
    await world.pharmacist.client.post(
      `/api/requests/${claimed.id}/dispense`,
      {}
    );
    expect(
      (await listAll(world, { status: "claimed" })).map((r) => r.id)
    ).toEqual([claimed.id]);

    world.app.clock.advance(25 * 3_600_000);
    await relogin(world);
    expect(await listAll(world, { status: "claimed" })).toHaveLength(0);
    expect(
      await listAll(world, { includeArchived: "1", status: "claimed" })
    ).toHaveLength(1);
  });

  it("archives claimed rows on demand; they stay in the dispensing log", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const claimed = await readyRequest(world, itemId, 1);
    await world.pharmacist.client.post(
      `/api/requests/${claimed.id}/dispense`,
      {}
    );

    const archived = await world.pharmacist.client.post<ArchiveResultDto>(
      "/api/requests/archive-claimed",
      {}
    );
    expect(archived.data.archived).toBe(1);
    expect(await listAll(world, { status: "claimed" })).toHaveLength(0);
    const rowsLeft = rows<{ archived_at: string | null }>(
      world.app,
      "SELECT archived_at FROM requests"
    );
    expect(rowsLeft[0].archived_at).not.toBeNull();
    expect(count(world.app, "dispensing_records")).toBe(1);
    expect(count(world.app, "audit_log", "action = 'request.archive'")).toBe(1);

    const nothing = await world.pharmacist.client.post<ArchiveResultDto>(
      "/api/requests/archive-claimed",
      {}
    );
    expect(nothing.data.archived).toBe(0);
    expect(
      (await world.nurse.client.post("/api/requests/archive-claimed", {}))
        .status
    ).toBe(403);
  });

  it("returns one request with history by id and 404s for an unknown id", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);
    const request = await createRequest(world.nurse.client, itemId, 1);
    const found = await world.healthAdmin.client.get<RequestDto>(
      `/api/requests/${request.id}`
    );
    expect(found.data.events).toHaveLength(1);
    expect((await world.nurse.client.get("/api/requests/nope")).status).toBe(
      404
    );
  });
});

describe("role matrix", () => {
  it("nurse creates but cannot process; health admin only reads; pharmacist processes", async () => {
    const world = await createWorld();
    const { itemId } = stockItem(world.app, [{ qty: 10 }]);

    const healthCreate = await world.healthAdmin.client.post("/api/requests", {
      lines: [{ itemId, qty: 1 }],
    });
    expect(healthCreate.status).toBe(403);
    expect((await world.healthAdmin.client.get("/api/requests")).status).toBe(
      200
    );

    const request = await createRequest(world.nurse.client, itemId, 1);
    const url = `/api/requests/${request.id}`;
    expect(
      (await world.nurse.client.post(`${url}/transition`, { to: "approved" }))
        .status
    ).toBe(403);
    expect((await world.nurse.client.post(`${url}/dispense`, {})).status).toBe(
      403
    );
    expect(
      (
        await world.healthAdmin.client.post(`${url}/transition`, {
          to: "approved",
        })
      ).status
    ).toBe(403);
    expect(
      (
        await world.pharmacist.client.post(`${url}/transition`, {
          to: "approved",
        })
      ).status
    ).toBe(200);
  });
});
