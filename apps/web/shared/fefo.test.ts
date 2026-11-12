import { describe, expect, it } from "vitest";

import {
  compareFefo,
  FEFO_ORDER_SQL,
  type FefoBatchLike,
  fefoOrder,
  fefoOrderSql,
  fefoRanks,
  isFefoEligible,
  isQuarantined,
  nextFefoBatch,
  splitBatchesForDisplay,
} from "./fefo";

const TODAY = "2026-11-12";

function batch(
  overrides: Partial<FefoBatchLike> & { id: string }
): FefoBatchLike {
  return {
    batchNumber: overrides.id.toUpperCase(),
    deleted: false,
    expiry: "2027-06-30",
    qty: 10,
    receivedOn: "2026-01-01",
    status: "active",
    ...overrides,
  };
}

function ids(batches: readonly FefoBatchLike[]): string[] {
  return batches.map((entry) => entry.id);
}

describe("isFefoEligible", () => {
  it("accepts an active, stocked, unexpired batch", () => {
    expect(isFefoEligible(batch({ id: "a" }), TODAY)).toBe(true);
  });

  it("accepts a batch without an expiry", () => {
    expect(isFefoEligible(batch({ expiry: null, id: "a" }), TODAY)).toBe(true);
  });

  it("treats a batch expiring today as still eligible", () => {
    expect(isFefoEligible(batch({ expiry: TODAY, id: "a" }), TODAY)).toBe(true);
    expect(isQuarantined(batch({ expiry: TODAY, id: "a" }), TODAY)).toBe(false);
  });

  it("excludes expired, empty, disposed and deleted batches", () => {
    expect(
      isFefoEligible(batch({ expiry: "2026-11-11", id: "a" }), TODAY)
    ).toBe(false);
    expect(isFefoEligible(batch({ id: "a", qty: 0 }), TODAY)).toBe(false);
    expect(isFefoEligible(batch({ id: "a", qty: -1 }), TODAY)).toBe(false);
    expect(isFefoEligible(batch({ id: "a", qty: Number.NaN }), TODAY)).toBe(
      false
    );
    expect(isFefoEligible(batch({ id: "a", status: "disposed" }), TODAY)).toBe(
      false
    );
    expect(isFefoEligible(batch({ deleted: true, id: "a" }), TODAY)).toBe(
      false
    );
  });

  it("treats a missing deleted flag as not deleted", () => {
    const { deleted: _deleted, ...rest } = batch({ id: "a" });
    expect(isFefoEligible(rest, TODAY)).toBe(true);
  });
});

describe("isQuarantined", () => {
  it("flags active, stocked, expired batches", () => {
    expect(isQuarantined(batch({ expiry: "2026-11-11", id: "a" }), TODAY)).toBe(
      true
    );
  });

  it("does not flag empty, disposed, deleted, undated or unexpired batches", () => {
    const expired = "2026-01-01";
    expect(
      isQuarantined(batch({ expiry: expired, id: "a", qty: 0 }), TODAY)
    ).toBe(false);
    expect(
      isQuarantined(
        batch({ expiry: expired, id: "a", status: "disposed" }),
        TODAY
      )
    ).toBe(false);
    expect(
      isQuarantined(batch({ deleted: true, expiry: expired, id: "a" }), TODAY)
    ).toBe(false);
    expect(isQuarantined(batch({ expiry: null, id: "a" }), TODAY)).toBe(false);
    expect(isQuarantined(batch({ id: "a" }), TODAY)).toBe(false);
  });
});

describe("compareFefo / fefoOrder", () => {
  it("orders by expiry ascending with no-expiry last", () => {
    const list = [
      batch({ expiry: null, id: "none" }),
      batch({ expiry: "2027-03-01", id: "late" }),
      batch({ expiry: "2026-12-01", id: "early" }),
    ];
    expect(ids(fefoOrder(list, TODAY))).toEqual(["early", "late", "none"]);
  });

  it("breaks same-expiry ties by received date", () => {
    const list = [
      batch({ id: "newer", receivedOn: "2026-05-01" }),
      batch({ id: "older", receivedOn: "2026-02-01" }),
    ];
    expect(ids(fefoOrder(list, TODAY))).toEqual(["older", "newer"]);
  });

  it("breaks received-date ties by batch number, ignoring case", () => {
    const list = [
      batch({ batchNumber: "beta", id: "1" }),
      batch({ batchNumber: "Alpha", id: "2" }),
      batch({ batchNumber: "ALPHB", id: "3" }),
    ];
    expect(ids(fefoOrder(list, TODAY))).toEqual(["2", "3", "1"]);
  });

  it("compares batch numbers lexicographically, not naturally ('B10' before 'b2')", () => {
    // Matches the SQL index on batch_number_lower: 'b10' < 'b2'.
    const list = [
      batch({ batchNumber: "b2", id: "two" }),
      batch({ batchNumber: "B10", id: "ten" }),
    ];
    expect(ids(fefoOrder(list, TODAY))).toEqual(["ten", "two"]);
  });

  it("falls back to id so the order is total", () => {
    const list = [
      batch({ batchNumber: "same", id: "b" }),
      batch({ batchNumber: "SAME", id: "a" }),
    ];
    expect(ids(fefoOrder(list, TODAY))).toEqual(["a", "b"]);
  });

  it("returns 0 only for identical sort keys", () => {
    const one = batch({ id: "a" });
    expect(compareFefo(one, { ...one })).toBe(0);
    expect(compareFefo(one, batch({ id: "b" }))).toBeLessThan(0);
  });

  it("orders two undated batches by the remaining keys", () => {
    const list = [
      batch({ expiry: null, id: "b", receivedOn: "2026-03-01" }),
      batch({ expiry: null, id: "a", receivedOn: "2026-02-01" }),
    ];
    expect(ids(fefoOrder(list, TODAY))).toEqual(["a", "b"]);
  });

  it("keeps only eligible batches", () => {
    const list = [
      batch({ expiry: "2026-11-01", id: "expired" }),
      batch({ id: "empty", qty: 0 }),
      batch({ id: "disposed", status: "disposed" }),
      batch({ deleted: true, id: "deleted" }),
      batch({ expiry: TODAY, id: "today" }),
      batch({ id: "ok" }),
    ];
    expect(ids(fefoOrder(list, TODAY))).toEqual(["today", "ok"]);
  });

  it("is stable and returns the same order for any input permutation", () => {
    const list = [
      batch({ batchNumber: "x", id: "1" }),
      batch({ batchNumber: "x", id: "2", receivedOn: "2025-12-31" }),
      batch({ expiry: null, id: "3" }),
      batch({ expiry: "2026-12-12", id: "4" }),
    ];
    const forward = ids(fefoOrder(list, TODAY));
    const backward = ids(fefoOrder([...list].reverse(), TODAY));
    expect(backward).toEqual(forward);
    expect(forward).toEqual(["4", "2", "1", "3"]);
  });

  it("does not mutate the input and returns a new array", () => {
    const list = [
      batch({ expiry: "2027-01-01", id: "b" }),
      batch({ expiry: "2026-12-01", id: "a" }),
      batch({ expiry: "2026-01-01", id: "expired" }),
    ];
    const snapshot = structuredClone(list);
    const result = fefoOrder(list, TODAY);
    expect(list).toEqual(snapshot);
    expect(result).not.toBe(list);
    expect(result[0]).toBe(list[1]);
  });
});

describe("fefoRanks / nextFefoBatch", () => {
  const list = [
    batch({ expiry: null, id: "none" }),
    batch({ expiry: "2027-01-01", id: "second" }),
    batch({ expiry: "2026-12-01", id: "first" }),
    batch({ expiry: "2026-01-01", id: "expired" }),
  ];

  it("ranks eligible batches from 1 and omits the rest", () => {
    const ranks = fefoRanks(list, TODAY);
    expect(ranks.get("first")).toBe(1);
    expect(ranks.get("second")).toBe(2);
    expect(ranks.get("none")).toBe(3);
    expect(ranks.has("expired")).toBe(false);
    expect(ranks.size).toBe(3);
  });

  it("returns the first batch to pull, or undefined", () => {
    expect(nextFefoBatch(list, TODAY)?.id).toBe("first");
    expect(nextFefoBatch([], TODAY)).toBeUndefined();
    expect(
      nextFefoBatch([batch({ expiry: "2026-01-01", id: "x" })], TODAY)
    ).toBeUndefined();
  });
});

describe("splitBatchesForDisplay", () => {
  it("groups into eligible (FEFO order), quarantined and inactive", () => {
    const list = [
      batch({ expiry: "2027-01-01", id: "later" }),
      batch({ expiry: "2026-10-01", id: "q2" }),
      batch({ expiry: "2026-09-01", id: "q1" }),
      batch({ id: "empty", qty: 0 }),
      batch({ id: "disposed", status: "disposed" }),
      batch({ expiry: "2026-12-01", id: "sooner" }),
      batch({ deleted: true, id: "gone" }),
    ];
    const groups = splitBatchesForDisplay(list, TODAY);
    expect(ids(groups.eligible)).toEqual(["sooner", "later"]);
    expect(ids(groups.quarantined)).toEqual(["q1", "q2"]);
    expect(ids(groups.inactive).sort()).toEqual(["disposed", "empty"]);
  });

  it("does not mutate its input", () => {
    const list = [
      batch({ expiry: "2027-01-01", id: "b" }),
      batch({ expiry: "2026-12-01", id: "a" }),
    ];
    const snapshot = structuredClone(list);
    splitBatchesForDisplay(list, TODAY);
    expect(list).toEqual(snapshot);
  });
});

describe("SQL order", () => {
  it("exports the unqualified ORDER BY fragment", () => {
    expect(FEFO_ORDER_SQL).toBe(
      "expiry IS NULL, expiry, received_on, batch_number_lower, id"
    );
    expect(fefoOrderSql()).toBe(FEFO_ORDER_SQL);
  });

  it("qualifies every column with a safe alias", () => {
    expect(fefoOrderSql("b")).toBe(
      "b.expiry IS NULL, b.expiry, b.received_on, b.batch_number_lower, b.id"
    );
    expect(fefoOrderSql("_Batches2")).toContain("_Batches2.id");
  });

  it("rejects aliases that could inject SQL", () => {
    for (const alias of ["b; DROP TABLE x", "1b", "b.c", "b c", "b-c", "'"]) {
      expect(() => fefoOrderSql(alias)).toThrow(/Invalid SQL alias/);
    }
  });
});
