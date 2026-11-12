import { describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../../../test/app";
import {
  insertBatch,
  insertCategory,
  insertItem,
} from "../../../test/fixtures";
import type { D1DatabaseLike } from "../../env";
import {
  loadBatchDto,
  loadFefoList,
  loadItemDetail,
  loadItemSummaries,
  readContextFor,
} from "./read-models";

const MANILA_LAST_MINUTE = "2026-11-12T15:59:00.000Z";
const MANILA_MIDNIGHT = "2026-11-12T16:00:00.000Z";
const BULK_ITEMS = 300;
const MAX_CONSTANT_QUERIES = 4;

async function contextAt(app: TestApp, iso?: string) {
  return await readContextFor(app.db, iso ? new Date(iso) : app.clock.now());
}

function countingDb(app: TestApp): { count: () => number; db: D1DatabaseLike } {
  let queries = 0;
  const db: D1DatabaseLike = {
    batch: (statements) => app.db.batch(statements),
    exec: (query) => app.db.exec(query),
    prepare: (sql) => {
      queries += 1;
      return app.db.prepare(sql);
    },
  };
  return { count: () => queries, db };
}

describe("derived item fields", () => {
  it("separates available from on-hand and finds the worst class", async () => {
    const app = await createTestApp();
    const item = insertItem(app.sqlite, {
      name: "Amoxicillin",
      strength: "500 mg",
    });
    insertBatch(app.sqlite, { expiry: "2026-11-01", itemId: item, qty: 7 });
    insertBatch(app.sqlite, { expiry: "2026-11-15", itemId: item, qty: 5 });
    insertBatch(app.sqlite, { expiry: "2027-06-01", itemId: item, qty: 20 });
    insertBatch(app.sqlite, {
      deleted: true,
      expiry: "2026-11-14",
      itemId: item,
      qty: 99,
    });
    insertBatch(app.sqlite, { itemId: item, qty: 0 });

    const rc = await contextAt(app);
    const { items, total } = await loadItemSummaries(app.db, rc);

    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      available: 25,
      batchCount: 3,
      displayName: "Amoxicillin 500 mg",
      nearestExpiry: "2026-11-15",
      onHand: 32,
      worstClass: "expired",
    });
  });

  it("reads thresholds from settings", async () => {
    const app = await createTestApp();
    const item = insertItem(app.sqlite);
    insertBatch(app.sqlite, { expiry: "2026-12-20", itemId: item });

    expect(
      (await loadItemSummaries(app.db, await contextAt(app))).items[0]
        .worstClass
    ).toBe("safe");
    await app.setSettings({ expiry: { nearDays: 60 } });
    expect(
      (await loadItemSummaries(app.db, await contextAt(app))).items[0]
        .worstClass
    ).toBe("near_expiry");
    await app.setSettings({ expiry: { nearDays: 90, urgentDays: 40 } });
    expect(
      (await loadItemSummaries(app.db, await contextAt(app))).items[0]
        .worstClass
    ).toBe("urgent");
  });

  it("flips at facility midnight, not UTC midnight", async () => {
    const app = await createTestApp();
    const item = insertItem(app.sqlite);
    const batch = insertBatch(app.sqlite, {
      expiry: "2026-11-12",
      itemId: item,
      qty: 4,
    });

    const before = await contextAt(app, MANILA_LAST_MINUTE);
    expect(before.today).toBe("2026-11-12");
    const beforeDto = await loadBatchDto(app.db, before, batch);
    expect(beforeDto).toMatchObject({
      daysUntil: 0,
      expiryClass: "urgent",
      fefoRank: 1,
      quarantined: false,
    });
    expect((await loadItemSummaries(app.db, before)).items[0].available).toBe(
      4
    );

    const after = await contextAt(app, MANILA_MIDNIGHT);
    expect(after.today).toBe("2026-11-13");
    const afterDto = await loadBatchDto(app.db, after, batch);
    expect(afterDto).toMatchObject({
      daysUntil: -1,
      expiryClass: "expired",
      fefoRank: null,
      quarantined: true,
    });
    const {
      items: [summary],
    } = await loadItemSummaries(app.db, after);
    expect(summary).toMatchObject({
      available: 0,
      onHand: 4,
      worstClass: "expired",
    });
  });

  it("honours a different facility timezone", async () => {
    const app = await createTestApp();
    await app.setSettings({ facility: { timezone: "America/Los_Angeles" } });
    const rc = await contextAt(app, MANILA_MIDNIGHT);
    expect(rc.today).toBe("2026-11-12");
    expect(rc.timezone).toBe("America/Los_Angeles");
  });
});

describe("low stock", () => {
  it("is judged on available stock, not on-hand", async () => {
    const app = await createTestApp();
    const item = insertItem(app.sqlite, { lowStockThreshold: 10 });
    insertBatch(app.sqlite, { expiry: "2026-10-01", itemId: item, qty: 50 });
    insertBatch(app.sqlite, { expiry: "2027-05-01", itemId: item, qty: 5 });

    const { items } = await loadItemSummaries(app.db, await contextAt(app));
    expect(items[0]).toMatchObject({
      available: 5,
      lowStock: "low",
      onHand: 55,
    });
  });

  it("is out when only expired stock remains, and ignored without a threshold", async () => {
    const app = await createTestApp();
    const watched = insertItem(app.sqlite, {
      lowStockThreshold: 10,
      name: "Watched",
    });
    insertBatch(app.sqlite, { expiry: "2026-10-01", itemId: watched, qty: 50 });
    const unwatched = insertItem(app.sqlite, { name: "Unwatched" });
    insertBatch(app.sqlite, {
      expiry: "2026-10-01",
      itemId: unwatched,
      qty: 50,
    });

    const rc = await contextAt(app);
    const byName = Object.fromEntries(
      (await loadItemSummaries(app.db, rc)).items.map((i) => [
        i.name,
        i.lowStock,
      ])
    );
    expect(byName).toEqual({ Unwatched: "in_stock", Watched: "out" });
    expect(
      (await loadItemSummaries(app.db, rc, { stock: ["out"] })).items.map(
        (i) => i.name
      )
    ).toEqual(["Watched"]);
    expect(
      (await loadItemSummaries(app.db, rc, { stock: ["low"] })).total
    ).toBe(0);
  });
});

describe("filters, sort and paging", () => {
  async function seed() {
    const app = await createTestApp();
    const pain = insertCategory(app.sqlite, "Analgesic");
    const anti = insertCategory(app.sqlite, "Antibiotic");
    const a = insertItem(app.sqlite, {
      barcode: "4800001",
      categoryId: pain,
      name: "Paracetamol",
      sku: "PCM-1",
      strength: "500 mg",
    });
    const b = insertItem(app.sqlite, {
      categoryId: anti,
      name: "Amoxicillin",
      strength: "250 mg",
    });
    const c = insertItem(app.sqlite, { name: "100% Saline" });
    insertBatch(app.sqlite, { expiry: "2026-11-15", itemId: a, qty: 30 });
    insertBatch(app.sqlite, { expiry: "2027-09-01", itemId: b, qty: 10 });
    insertBatch(app.sqlite, { expiry: "2026-10-01", itemId: c, qty: 1 });
    return { a, anti, app, b, c, pain, rc: await contextAt(app) };
  }

  it("filters by search over name, strength, sku and barcode with LIKE escaping", async () => {
    const { app, rc } = await seed();
    const names = async (search: string) =>
      (await loadItemSummaries(app.db, rc, { search })).items.map(
        (i) => i.name
      );
    expect(await names("paracet")).toEqual(["Paracetamol"]);
    expect(await names("250 MG")).toEqual(["Amoxicillin"]);
    expect(await names("pcm-1")).toEqual(["Paracetamol"]);
    expect(await names("4800001")).toEqual(["Paracetamol"]);
    expect(await names("100%")).toEqual(["100% Saline"]);
    expect(await names("%")).toEqual(["100% Saline"]);
    expect(await names("500 mg")).toEqual(["Paracetamol"]);
  });

  it("filters by category, status and ids", async () => {
    const { a, anti, app, b, rc } = await seed();
    expect(
      (await loadItemSummaries(app.db, rc, { categoryId: anti })).items.map(
        (i) => i.id
      )
    ).toEqual([b]);
    expect(
      (await loadItemSummaries(app.db, rc, { status: ["expired"] })).items.map(
        (i) => i.name
      )
    ).toEqual(["100% Saline"]);
    expect(
      (await loadItemSummaries(app.db, rc, { status: ["urgent", "safe"] }))
        .total
    ).toBe(2);
    expect((await loadItemSummaries(app.db, rc, { ids: [a, b] })).total).toBe(
      2
    );
    expect((await loadItemSummaries(app.db, rc, { ids: [] })).total).toBe(0);
  });

  it("sorts, pages and reports the total", async () => {
    const { app, rc } = await seed();
    const order = async (q: Parameters<typeof loadItemSummaries>[2]) =>
      (await loadItemSummaries(app.db, rc, q)).items.map((i) => i.name);
    expect(await order({ sort: "name" })).toEqual([
      "100% Saline",
      "Amoxicillin",
      "Paracetamol",
    ]);
    expect(await order({ dir: "desc", sort: "name" })).toEqual([
      "Paracetamol",
      "Amoxicillin",
      "100% Saline",
    ]);
    expect(await order({ sort: "nearestExpiry" })).toEqual([
      "Paracetamol",
      "Amoxicillin",
      "100% Saline",
    ]);
    expect(await order({ dir: "desc", sort: "onHand" })).toEqual([
      "Paracetamol",
      "Amoxicillin",
      "100% Saline",
    ]);
    expect(await order({ sort: "category" })).toEqual([
      "Paracetamol",
      "Amoxicillin",
      "100% Saline",
    ]);
    const page = await loadItemSummaries(app.db, rc, {
      limit: 1,
      offset: 1,
      sort: "name",
    });
    expect(page.total).toBe(3);
    expect(page.items.map((i) => i.name)).toEqual(["Amoxicillin"]);
  });

  it("hides trashed items", async () => {
    const { app, c, rc } = await seed();
    app.sqlite
      .prepare(
        "UPDATE items SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?"
      )
      .run(c);
    expect((await loadItemSummaries(app.db, rc)).total).toBe(2);
    expect(await loadItemDetail(app.db, rc, c)).toBeNull();
  });
});

describe("FEFO", () => {
  it("orders detail batches FEFO first, then quarantined, then inactive, with ranks", async () => {
    const app = await createTestApp();
    const item = insertItem(app.sqlite);
    const noExpiry = insertBatch(app.sqlite, {
      batchNumber: "N",
      expiry: null,
      itemId: item,
    });
    const late = insertBatch(app.sqlite, {
      batchNumber: "L",
      expiry: "2027-06-01",
      itemId: item,
    });
    const tieB = insertBatch(app.sqlite, {
      batchNumber: "b",
      expiry: "2027-01-01",
      itemId: item,
      receivedOn: "2026-10-05",
    });
    const tieA = insertBatch(app.sqlite, {
      batchNumber: "A",
      expiry: "2027-01-01",
      itemId: item,
      receivedOn: "2026-10-05",
    });
    const tieOlder = insertBatch(app.sqlite, {
      batchNumber: "Z",
      expiry: "2027-01-01",
      itemId: item,
      receivedOn: "2026-09-01",
    });
    const expired = insertBatch(app.sqlite, {
      batchNumber: "E",
      expiry: "2026-10-01",
      itemId: item,
    });
    const empty = insertBatch(app.sqlite, {
      batchNumber: "Q",
      expiry: "2026-12-01",
      itemId: item,
      qty: 0,
    });
    const disposed = insertBatch(app.sqlite, {
      batchNumber: "D",
      expiry: "2026-12-02",
      itemId: item,
      status: "disposed",
    });

    const detail = await loadItemDetail(app.db, await contextAt(app), item);
    const order = detail?.batches.map((b) => b.id);
    expect(order?.slice(0, 5)).toEqual([tieOlder, tieA, tieB, late, noExpiry]);
    expect(order?.[5]).toBe(expired);
    expect(new Set(order?.slice(6))).toEqual(new Set([empty, disposed]));
    expect(detail?.batches.map((b) => b.fefoRank)).toEqual([
      1,
      2,
      3,
      4,
      5,
      null,
      null,
      null,
    ]);
    expect(detail?.batches[5]).toMatchObject({
      expiryClass: "expired",
      quarantined: true,
    });
    expect(detail?.batches[7]).toMatchObject({ quarantined: false });
  });

  it("lists each item's next eligible batch, earliest expiry first", async () => {
    const app = await createTestApp();
    const cat = insertCategory(app.sqlite, "Cat");
    const a = insertItem(app.sqlite, { categoryId: cat, name: "Aspirin" });
    const b = insertItem(app.sqlite, { name: "Bandage" });
    const c = insertItem(app.sqlite, { name: "Only expired" });
    const aNext = insertBatch(app.sqlite, { expiry: "2027-02-01", itemId: a });
    insertBatch(app.sqlite, { expiry: "2027-05-01", itemId: a });
    insertBatch(app.sqlite, { expiry: "2026-09-01", itemId: a });
    const bNext = insertBatch(app.sqlite, { expiry: "2026-12-01", itemId: b });
    insertBatch(app.sqlite, { expiry: null, itemId: b });
    insertBatch(app.sqlite, { expiry: "2026-09-01", itemId: c });

    const rc = await contextAt(app);
    const entries = await loadFefoList(app.db, rc);
    expect(entries.map((e) => e.batch.id)).toEqual([bNext, aNext]);
    expect(entries[0]).toMatchObject({
      batch: { fefoRank: 1 },
      item: { displayName: "Bandage" },
    });
    expect(entries[1].item.categoryName).toBe("Cat");
    expect(
      (await loadFefoList(app.db, rc, { categoryId: cat })).map(
        (e) => e.batch.id
      )
    ).toEqual([aNext]);
    expect(await loadFefoList(app.db, rc, { limit: 1 })).toHaveLength(1);
  });
});

describe("query budget", () => {
  function seedMany(app: TestApp, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const item = insertItem(app.sqlite, {
        lowStockThreshold: 5,
        name: `Item ${String(index).padStart(4, "0")}`,
      });
      insertBatch(app.sqlite, {
        expiry: `2027-0${(index % 9) + 1}-15`,
        itemId: item,
        qty: (index % 7) + 1,
      });
      insertBatch(app.sqlite, { expiry: "2026-10-01", itemId: item, qty: 2 });
    }
  }

  it("uses a constant number of queries for 300 items", async () => {
    const small = await createTestApp();
    seedMany(small, 3);
    const large = await createTestApp();
    seedMany(large, BULK_ITEMS);

    const smallRun = countingDb(small);
    const largeRun = countingDb(large);
    const smallRc = await contextAt(small);
    const largeRc = await contextAt(large);
    const baseline = smallRun.count();

    await loadItemSummaries(smallRun.db, smallRc, { limit: 200 });
    const smallQueries = smallRun.count() - baseline;
    const page = await loadItemSummaries(largeRun.db, largeRc, { limit: 200 });
    expect(largeRun.count()).toBe(smallQueries);
    expect(smallQueries).toBeLessThanOrEqual(MAX_CONSTANT_QUERIES);
    expect(page.items).toHaveLength(200);
    expect(page.total).toBe(BULK_ITEMS);

    const fefoRun = countingDb(large);
    const fefo = await loadFefoList(fefoRun.db, largeRc);
    expect(fefoRun.count()).toBe(1);
    expect(fefo).toHaveLength(BULK_ITEMS);

    const detailRun = countingDb(large);
    const first = page.items[0].id;
    await loadItemDetail(detailRun.db, largeRc, first);
    expect(detailRun.count()).toBeLessThanOrEqual(MAX_CONSTANT_QUERIES);

    const ids = (
      await loadItemSummaries(large.db, largeRc, { limit: BULK_ITEMS })
    ).items.map((i) => i.id);
    const idsRun = countingDb(large);
    const byIds = await loadItemSummaries(idsRun.db, largeRc, { ids });
    expect(byIds.total).toBe(BULK_ITEMS);
    expect(idsRun.count()).toBeLessThanOrEqual(MAX_CONSTANT_QUERIES);
  });
});
