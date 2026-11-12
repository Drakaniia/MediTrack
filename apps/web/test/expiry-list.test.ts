import { describe, expect, it } from "vitest";

import type { ExpiryClass } from "../shared/expiry";
import type { ExpiryRowDto, ExpirySummaryDto } from "../shared/schemas/expiry";
import { createTestApp, type TestApp, type TestClient } from "./app";
import { day } from "./expiry-helpers";
import {
  insertBatch,
  insertCategory,
  insertItem,
  setSetting,
} from "./fixtures";

const ALL_CLASSES = "safe,near_expiry,urgent,expired";
const BOUNDARY_DAYS = [-1, 0, 7, 8, 10, 11, 20, 21, 30, 31] as const;

interface Arranged {
  admin: TestClient;
  app: TestApp;
}

async function arrange(now?: string): Promise<Arranged> {
  const app = await createTestApp(now ? { now } : {});
  return { admin: await app.loginAs("admin"), app };
}

/** One batch per boundary day, batch number `D<offset>`, on one item. */
function insertBoundaryBatches(app: TestApp): void {
  const itemId = insertItem(app.sqlite, { name: "Boundary" });
  for (const offset of BOUNDARY_DAYS) {
    insertBatch(app.sqlite, {
      batchNumber: `D${offset}`,
      expiry: day(offset),
      itemId,
      qty: 3,
    });
  }
}

function classesByBatch(rows: ExpiryRowDto[]): Record<string, ExpiryClass> {
  return Object.fromEntries(
    rows.map((row) => [row.batchNumber, row.expiryClass])
  );
}

async function listAll(
  client: TestClient,
  query: Record<string, string | number> = {}
): Promise<ExpiryRowDto[]> {
  const response = await client.get<ExpiryRowDto[]>("/api/expiry", {
    class: ALL_CLASSES,
    limit: 200,
    ...query,
  });
  expect(response.status).toBe(200);
  return response.data;
}

describe("GET /api/expiry classification", () => {
  it("uses the default thresholds (urgent ≤ 7, near ≤ 30) on the boundary days", async () => {
    const { admin, app } = await arrange();
    insertBoundaryBatches(app);

    const rows = await listAll(admin);
    expect(classesByBatch(rows)).toEqual({
      "D-1": "expired",
      D0: "urgent",
      D7: "urgent",
      D8: "near_expiry",
      D10: "near_expiry",
      D11: "near_expiry",
      D20: "near_expiry",
      D21: "near_expiry",
      D30: "near_expiry",
      D31: "safe",
    });
    const byNumber = Object.fromEntries(
      rows.map((row) => [row.batchNumber, row.daysUntil])
    );
    expect(byNumber).toMatchObject({ "D-1": -1, D0: 0, D31: 31 });
  });

  it("follows thresholds changed in settings (urgent ≤ 10, near ≤ 20)", async () => {
    const { admin, app } = await arrange();
    insertBoundaryBatches(app);
    await app.setSettings({ expiry: { nearDays: 20, urgentDays: 10 } });

    expect(classesByBatch(await listAll(admin))).toEqual({
      "D-1": "expired",
      D0: "urgent",
      D7: "urgent",
      D8: "urgent",
      D10: "urgent",
      D11: "near_expiry",
      D20: "near_expiry",
      D21: "safe",
      D30: "safe",
      D31: "safe",
    });
  });

  it("filters by class with the same boundaries as the classification", async () => {
    const { admin, app } = await arrange();
    insertBoundaryBatches(app);

    const urgent = await listAll(admin, { class: "urgent" });
    expect(urgent.map((row) => row.batchNumber).sort()).toEqual(["D0", "D7"]);
    const near = await listAll(admin, { class: "near_expiry" });
    expect(near.map((row) => row.batchNumber).sort()).toEqual([
      "D10",
      "D11",
      "D20",
      "D21",
      "D30",
      "D8",
    ]);
    const expired = await listAll(admin, { class: "expired" });
    expect(expired.map((row) => row.batchNumber)).toEqual(["D-1"]);
    const safe = await listAll(admin, { class: "safe" });
    expect(safe.map((row) => row.batchNumber)).toEqual(["D31"]);
  });

  it("reads 'today' in the facility timezone (Manila midnight boundary)", async () => {
    // 16:30Z on the 11th is 00:30 on the 12th in Manila; in UTC it is still the 11th.
    const { admin, app } = await arrange("2026-11-11T16:30:00.000Z");
    const itemId = insertItem(app.sqlite, { name: "Midnight" });
    insertBatch(app.sqlite, {
      batchNumber: "YESTERDAY",
      expiry: "2026-11-11",
      itemId,
    });
    insertBatch(app.sqlite, {
      batchNumber: "TODAY",
      expiry: "2026-11-12",
      itemId,
    });

    const summary = await admin.get<ExpirySummaryDto>("/api/expiry/summary");
    expect(summary.data.today).toBe("2026-11-12");
    expect(classesByBatch(await listAll(admin))).toEqual({
      TODAY: "urgent",
      YESTERDAY: "expired",
    });

    // Same instant, a UTC facility: the 11th is still today.
    await app.setSettings({ facility: { timezone: "UTC" } });
    expect(classesByBatch(await listAll(admin))).toEqual({
      TODAY: "urgent",
      YESTERDAY: "urgent",
    });
  });

  it("treats batches without an expiry as safe and leaves them out of the default list", async () => {
    const { admin, app } = await arrange();
    const supplies = insertItem(app.sqlite, {
      hasExpiry: false,
      name: "Bed",
    });
    insertBatch(app.sqlite, {
      batchNumber: "NOEXP",
      expiry: null,
      itemId: supplies,
    });
    const drug = insertItem(app.sqlite, { name: "Drug" });
    insertBatch(app.sqlite, {
      batchNumber: "SOON",
      expiry: day(3),
      itemId: drug,
    });

    const defaults = await admin.get<ExpiryRowDto[]>("/api/expiry");
    expect(defaults.data.map((row) => row.batchNumber)).toEqual(["SOON"]);

    const safe = await listAll(admin, { class: "safe" });
    expect(safe).toHaveLength(1);
    expect(safe[0]).toMatchObject({
      batchNumber: "NOEXP",
      daysUntil: null,
      expiry: null,
      expiryClass: "safe",
      quarantined: false,
    });
  });

  it("only lists batches that hold stock on live items", async () => {
    const { admin, app } = await arrange();
    const itemId = insertItem(app.sqlite, { name: "Live" });
    insertBatch(app.sqlite, { batchNumber: "OK", expiry: day(2), itemId });
    insertBatch(app.sqlite, {
      batchNumber: "EMPTY",
      expiry: day(2),
      itemId,
      qty: 0,
    });
    insertBatch(app.sqlite, {
      batchNumber: "DISPOSED",
      expiry: day(2),
      itemId,
      qty: 0,
      status: "disposed",
    });
    insertBatch(app.sqlite, {
      batchNumber: "TRASHED",
      deleted: true,
      expiry: day(2),
      itemId,
    });
    const gone = insertItem(app.sqlite, { name: "Gone" });
    insertBatch(app.sqlite, {
      batchNumber: "ORPHAN",
      expiry: day(2),
      itemId: gone,
    });
    app.sqlite
      .prepare(
        "UPDATE items SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?"
      )
      .run(gone);

    const rows = await listAll(admin);
    expect(rows.map((row) => row.batchNumber)).toEqual(["OK"]);
  });
});

describe("GET /api/expiry rows, filters and paging", () => {
  it("ranks eligible batches FEFO per item and gives expired ones no rank", async () => {
    const { admin, app } = await arrange();
    const itemId = insertItem(app.sqlite, { name: "Ranked", unit: "tab" });
    insertBatch(app.sqlite, { batchNumber: "OLD", expiry: day(-5), itemId });
    insertBatch(app.sqlite, { batchNumber: "LATE", expiry: day(40), itemId });
    insertBatch(app.sqlite, { batchNumber: "SOON", expiry: day(10), itemId });
    const other = insertItem(app.sqlite, { name: "Other" });
    insertBatch(app.sqlite, {
      batchNumber: "ONLY",
      expiry: day(4),
      itemId: other,
    });

    const rows = await listAll(admin);
    const ranks = Object.fromEntries(
      rows.map((row) => [row.batchNumber, row.fefoRank])
    );
    expect(ranks).toEqual({ LATE: 2, OLD: null, ONLY: 1, SOON: 1 });
    expect(rows.find((row) => row.batchNumber === "OLD")?.quarantined).toBe(
      true
    );
    expect(rows[0]).toMatchObject({
      displayName: expect.any(String),
      status: "active",
      unit: expect.any(String),
    });
  });

  it("filters by category, search and expiry date range", async () => {
    const { admin, app } = await arrange();
    const antibiotics = insertCategory(app.sqlite, "Antibiotics");
    const analgesics = insertCategory(app.sqlite, "Analgesics");
    const amox = insertItem(app.sqlite, {
      categoryId: antibiotics,
      name: "Amoxicillin",
      strength: "500 mg",
    });
    const para = insertItem(app.sqlite, {
      categoryId: analgesics,
      name: "Paracetamol",
    });
    insertBatch(app.sqlite, {
      batchNumber: "AMX-1",
      expiry: day(3),
      itemId: amox,
    });
    insertBatch(app.sqlite, {
      batchNumber: "AMX-2",
      expiry: day(20),
      itemId: amox,
    });
    insertBatch(app.sqlite, {
      batchNumber: "PCM-1",
      expiry: day(5),
      itemId: para,
    });

    const byCategory = await listAll(admin, { categoryId: analgesics });
    expect(byCategory.map((row) => row.batchNumber)).toEqual(["PCM-1"]);
    expect(byCategory[0].categoryName).toBe("Analgesics");

    const byName = await listAll(admin, { search: "amoxi 500" });
    expect(byName).toHaveLength(0);
    const byNameAndStrength = await listAll(admin, {
      search: "amoxicillin 500",
    });
    expect(byNameAndStrength).toHaveLength(2);
    const byBatch = await listAll(admin, { search: "pcm" });
    expect(byBatch.map((row) => row.batchNumber)).toEqual(["PCM-1"]);

    const inRange = await listAll(admin, { from: day(4), to: day(20) });
    expect(inRange.map((row) => row.batchNumber)).toEqual(["PCM-1", "AMX-2"]);
  });

  it("treats LIKE wildcards in the search as plain text", async () => {
    const { admin, app } = await arrange();
    const itemId = insertItem(app.sqlite, { name: "Plain" });
    insertBatch(app.sqlite, { batchNumber: "A1", expiry: day(2), itemId });

    expect(await listAll(admin, { search: "%" })).toHaveLength(0);
    expect(await listAll(admin, { search: "_" })).toHaveLength(0);
  });

  it("sorts and pages with meta.total", async () => {
    const { admin, app } = await arrange();
    const zed = insertItem(app.sqlite, { name: "Zed" });
    const abe = insertItem(app.sqlite, { name: "Abe" });
    insertBatch(app.sqlite, {
      batchNumber: "Z1",
      expiry: day(2),
      itemId: zed,
      qty: 50,
    });
    insertBatch(app.sqlite, {
      batchNumber: "A1",
      expiry: day(9),
      itemId: abe,
      qty: 5,
    });
    insertBatch(app.sqlite, {
      batchNumber: "A2",
      expiry: day(25),
      itemId: abe,
      qty: 20,
    });

    const byExpiry = await listAll(admin);
    expect(byExpiry.map((row) => row.batchNumber)).toEqual(["Z1", "A1", "A2"]);
    const byExpiryDesc = await listAll(admin, { dir: "desc", sort: "expiry" });
    expect(byExpiryDesc.map((row) => row.batchNumber)).toEqual([
      "A2",
      "A1",
      "Z1",
    ]);
    const byItem = await listAll(admin, { sort: "item" });
    expect(byItem.map((row) => row.batchNumber)).toEqual(["A1", "A2", "Z1"]);
    const byQty = await listAll(admin, { dir: "desc", sort: "qty" });
    expect(byQty.map((row) => row.batchNumber)).toEqual(["Z1", "A2", "A1"]);
    const byClass = await listAll(admin, { sort: "class" });
    expect(byClass.map((row) => row.batchNumber)).toEqual(["Z1", "A1", "A2"]);

    const page = await admin.get<ExpiryRowDto[]>("/api/expiry", {
      class: ALL_CLASSES,
      limit: 2,
      offset: 2,
    });
    expect(page.data.map((row) => row.batchNumber)).toEqual(["A2"]);
    expect(page.body).toMatchObject({
      meta: { limit: 2, offset: 2, total: 3 },
    });
  });

  it("rejects unknown classes, sorts and malformed dates", async () => {
    const { admin } = await arrange();
    for (const query of [
      { class: "bogus" },
      { sort: "colour" },
      { from: "2026-13-40" },
      { dir: "sideways" },
    ]) {
      const response = await admin.get("/api/expiry", query);
      expect(response.status).toBe(400);
      expect(response.error?.code).toBe("validation_error");
    }
  });

  it("is readable by every role and needs a session", async () => {
    const { app } = await arrange();
    for (const role of ["nurse", "health_admin", "pharmacist"] as const) {
      const client = await app.loginAs(role);
      expect((await client.get("/api/expiry")).status).toBe(200);
    }
    expect((await app.anonymous.get("/api/expiry")).status).toBe(401);
  });
});

describe("GET /api/expiry/summary", () => {
  it("counts batches and units per class and echoes the thresholds", async () => {
    const { admin, app } = await arrange();
    insertBoundaryBatches(app);
    const noExpiry = insertItem(app.sqlite, {
      hasExpiry: false,
      name: "Gauze",
    });
    insertBatch(app.sqlite, {
      batchNumber: "N",
      expiry: null,
      itemId: noExpiry,
      qty: 9,
    });
    const empty = insertItem(app.sqlite, { name: "Empty" });
    insertBatch(app.sqlite, {
      batchNumber: "E",
      expiry: day(1),
      itemId: empty,
      qty: 0,
    });

    const { data, status } = await admin.get<ExpirySummaryDto>(
      "/api/expiry/summary"
    );
    expect(status).toBe(200);
    expect(data.counts).toEqual({
      expired: { batches: 1, units: 3 },
      near_expiry: { batches: 6, units: 18 },
      safe: { batches: 2, units: 12 },
      urgent: { batches: 2, units: 6 },
    });
    expect(data.thresholds).toEqual({ nearDays: 30, urgentDays: 7 });
    expect(data.today).toBe("2026-11-12");
    expect(data.month).toBe("2026-11");
  });

  it("counts what expires in the facility-local calendar month", async () => {
    const { admin, app } = await arrange();
    const itemId = insertItem(app.sqlite, { name: "Monthly" });
    insertBatch(app.sqlite, {
      batchNumber: "NOV-END",
      expiry: "2026-11-30",
      itemId,
      qty: 4,
    });
    insertBatch(app.sqlite, {
      batchNumber: "NOV-EARLY",
      expiry: "2026-11-02",
      itemId,
      qty: 6,
    });
    insertBatch(app.sqlite, {
      batchNumber: "DEC",
      expiry: "2026-12-01",
      itemId,
      qty: 100,
    });
    insertBatch(app.sqlite, {
      batchNumber: "OCT",
      expiry: "2026-10-31",
      itemId,
      qty: 100,
    });

    const { data } = await admin.get<ExpirySummaryDto>("/api/expiry/summary");
    expect(data.expiringThisMonth).toEqual({ batches: 2, units: 10 });
  });

  it("changes with the settings thresholds", async () => {
    const { admin, app } = await arrange();
    insertBoundaryBatches(app);
    setSetting(app.sqlite, "expiry.urgentDays", 10);
    setSetting(app.sqlite, "expiry.nearDays", 20);

    const { data } = await admin.get<ExpirySummaryDto>("/api/expiry/summary");
    expect(data.thresholds).toEqual({ nearDays: 20, urgentDays: 10 });
    expect(data.counts.urgent.batches).toBe(4);
    expect(data.counts.near_expiry.batches).toBe(2);
    expect(data.counts.safe.batches).toBe(3);
  });
});
