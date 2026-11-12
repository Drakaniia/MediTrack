import { describe, expect, it } from "vitest";

import { createMigratedD1, type FakeD1 } from "../test/harness";
import {
  batchOrConflict,
  guardChanged,
  isCheckViolation,
  isGuardFailure,
  isUniqueViolation,
} from "./guards";
import { HttpError } from "./http";

const NOW = "2026-11-12T02:00:00.000Z";

function seedBatch(db: FakeD1, qty: number): void {
  db.sqlite
    .prepare(
      "INSERT INTO items (id, name, created_at, updated_at) VALUES ('item-1', 'Paracetamol', ?, ?)"
    )
    .run(NOW, NOW);
  db.sqlite
    .prepare(
      "INSERT INTO batches (id, item_id, code, batch_number, batch_number_lower, expiry, qty, initial_qty, received_on) VALUES ('batch-1', 'item-1', 'ABCDEFGHJK', 'B1', 'b1', '2027-01-31', ?, ?, '2026-11-01')"
    )
    .run(qty, qty);
}

function batchQty(db: FakeD1): number {
  const row = db.sqlite
    .prepare("SELECT qty FROM batches WHERE id = 'batch-1'")
    .get() as { qty: number };
  return row.qty;
}

function categoryCount(db: FakeD1): number {
  const row = db.sqlite
    .prepare("SELECT COUNT(*) AS n FROM categories")
    .get() as { n: number };
  return row.n;
}

function insertCategory(db: FakeD1, id: string, name: string) {
  return db
    .prepare("INSERT INTO categories (id, name, name_lower) VALUES (?, ?, ?)")
    .bind(id, name, name.toLowerCase());
}

async function errorOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return null;
  } catch (error) {
    return error;
  }
}

describe("guardChanged", () => {
  it("lets the batch commit when the previous write changed the expected rows", async () => {
    const db = createMigratedD1();
    await db.batch([
      insertCategory(db, "c1", "Analgesics"),
      db.prepare("UPDATE categories SET sort_order = 1 WHERE id = 'c1'"),
      guardChanged(db, 1),
      insertCategory(db, "c2", "Antibiotics"),
    ]);
    expect(categoryCount(db)).toBe(2);
  });

  it("aborts and rolls back EVERYTHING when a different number of rows changed", async () => {
    const db = createMigratedD1();
    const error = await errorOf(
      db.batch([
        insertCategory(db, "c1", "Analgesics"),
        db.prepare("UPDATE categories SET sort_order = 1 WHERE id = 'missing'"),
        guardChanged(db, 1),
        insertCategory(db, "c2", "Antibiotics"),
      ])
    );
    expect(isGuardFailure(error)).toBe(true);
    expect(categoryCount(db)).toBe(0);
  });

  it("checks other expected counts, including zero", async () => {
    const db = createMigratedD1();
    await db.batch([
      insertCategory(db, "c1", "A"),
      db.prepare("UPDATE categories SET sort_order = 1 WHERE id = 'nothing'"),
      guardChanged(db, 0),
    ]);

    await db.batch([
      insertCategory(db, "c2", "B"),
      db.prepare("UPDATE categories SET sort_order = 2"),
      guardChanged(db, 2),
    ]);

    const error = await errorOf(
      db.batch([
        db.prepare("UPDATE categories SET sort_order = 3"),
        guardChanged(db, 1),
      ])
    );
    expect(isGuardFailure(error)).toBe(true);
    expect(categoryCount(db)).toBe(2);
  });
});

describe("error classification", () => {
  it("recognises a guard failure through wrappers and plain messages", () => {
    expect(
      isGuardFailure(new Error("D1_ERROR: integer overflow: SQLITE_ERROR"))
    ).toBe(true);
    expect(
      isGuardFailure(
        new Error("outer", { cause: new Error("integer overflow") })
      )
    ).toBe(true);
    expect(isGuardFailure({ message: "integer overflow" })).toBe(true);
    expect(isGuardFailure("integer overflow")).toBe(true);
    expect(isGuardFailure(new Error("CHECK constraint failed: qty >= 0"))).toBe(
      false
    );
    expect(isGuardFailure(null)).toBe(false);
    expect(isGuardFailure(undefined)).toBe(false);
    expect(isGuardFailure(42)).toBe(false);
  });

  it("recognises real CHECK and UNIQUE violations", async () => {
    const db = createMigratedD1();
    seedBatch(db, 5);
    await insertCategory(db, "c1", "Analgesics").run();

    const check = await errorOf(
      db.prepare("UPDATE batches SET qty = qty - 6 WHERE id = 'batch-1'").run()
    );
    expect(isCheckViolation(check)).toBe(true);
    expect(isUniqueViolation(check)).toBe(false);
    expect(isGuardFailure(check)).toBe(false);

    const unique = await errorOf(insertCategory(db, "c2", "ANALGESICS").run());
    expect(isUniqueViolation(unique)).toBe(true);
    expect(isUniqueViolation(unique, "categories.name_lower")).toBe(true);
    expect(isUniqueViolation(unique, "users.username_lower")).toBe(false);
    expect(isCheckViolation(unique)).toBe(false);
  });
});

describe("batchOrConflict", () => {
  it("returns the batch results when everything succeeds", async () => {
    const db = createMigratedD1();
    const results = await batchOrConflict(
      db,
      [insertCategory(db, "c1", "A"), insertCategory(db, "c2", "B")],
      new HttpError("conflict", "nope")
    );
    expect(results).toHaveLength(2);
    expect(categoryCount(db)).toBe(2);
  });

  it("turns a CHECK violation into the supplied conflict and rolls back", async () => {
    const db = createMigratedD1();
    seedBatch(db, 5);
    const conflict = new HttpError("stock_conflict", "Stock changed.");

    const error = await errorOf(
      batchOrConflict(
        db,
        [
          db.prepare("UPDATE batches SET qty = qty - 3 WHERE id = 'batch-1'"),
          db.prepare("UPDATE batches SET qty = qty - 3 WHERE id = 'batch-1'"),
        ],
        conflict
      )
    );
    expect(error).toBe(conflict);
    expect(batchQty(db)).toBe(5);
  });

  it("turns a failed guard into the supplied conflict and rolls back", async () => {
    const db = createMigratedD1();
    const conflict = new HttpError("conflict", "Someone else got there first.");

    const error = await errorOf(
      batchOrConflict(
        db,
        [
          insertCategory(db, "c1", "A"),
          db.prepare("UPDATE categories SET sort_order = 1 WHERE id = 'gone'"),
          guardChanged(db, 1),
        ],
        conflict
      )
    );
    expect(error).toBe(conflict);
    expect(categoryCount(db)).toBe(0);
  });

  it("rethrows everything else untouched", async () => {
    const db = createMigratedD1();
    await insertCategory(db, "c1", "A").run();
    const conflict = new HttpError("conflict", "nope");

    const error = await errorOf(
      batchOrConflict(db, [insertCategory(db, "c2", "a")], conflict)
    );
    expect(error).not.toBe(conflict);
    expect(isUniqueViolation(error)).toBe(true);
  });
});
