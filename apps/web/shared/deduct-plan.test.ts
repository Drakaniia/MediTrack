import { describe, expect, it } from "vitest";

import { planDeduct, revalidatePlan } from "./deduct-plan";
import type { FefoBatchLike } from "./fefo";

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

function plan(
  batches: FefoBatchLike[],
  requested: number,
  allowPartial = false,
  unit?: string
): ReturnType<typeof planDeduct> {
  return planDeduct({ allowPartial, batches, requested, today: TODAY, unit });
}

describe("planDeduct", () => {
  it("takes from a single batch", () => {
    const result = plan([batch({ id: "a" })], 4);
    expect(result).toEqual({
      ok: true,
      plan: {
        remaining: 0,
        take: 4,
        takes: [
          { batchId: "a", batchNumber: "A", expiry: "2027-06-30", qty: 4 },
        ],
      },
    });
  });

  it("splits across batches, earliest expiry first", () => {
    const result = plan(
      [
        batch({ expiry: "2027-03-01", id: "late", qty: 5 }),
        batch({ expiry: "2026-12-01", id: "early", qty: 3 }),
        batch({ expiry: null, id: "none", qty: 50 }),
      ],
      7
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.takes.map((t) => [t.batchId, t.qty])).toEqual([
      ["early", 3],
      ["late", 4],
    ]);
    expect(result.plan.take).toBe(7);
    expect(result.plan.remaining).toBe(0);
  });

  it("falls through to a batch with no expiry last", () => {
    const result = plan(
      [
        batch({ expiry: null, id: "none", qty: 50 }),
        batch({ expiry: "2026-12-01", id: "dated", qty: 2 }),
      ],
      5
    );
    expect(result.ok && result.plan.takes.map((t) => t.batchId)).toEqual([
      "dated",
      "none",
    ]);
  });

  it("can take exactly the total available", () => {
    const result = plan(
      [
        batch({ id: "a", qty: 3 }),
        batch({ expiry: "2028-01-01", id: "b", qty: 4 }),
      ],
      7
    );
    expect(result.ok && result.plan).toMatchObject({ remaining: 0, take: 7 });
    expect(result.ok && result.plan.takes).toHaveLength(2);
  });

  it("does not leave an empty take on a batch it never reaches", () => {
    const result = plan(
      [
        batch({ id: "a", qty: 5 }),
        batch({ expiry: "2028-01-01", id: "b", qty: 5 }),
      ],
      5
    );
    expect(result.ok && result.plan.takes.map((t) => t.batchId)).toEqual(["a"]);
  });

  it("refuses a short quantity when partial is not allowed", () => {
    const result = plan([batch({ id: "a", qty: 3 })], 5, false, "tabs");
    expect(result).toEqual({
      available: 3,
      code: "insufficient",
      message: "Only 3 tabs in stock.",
      ok: false,
    });
  });

  it("words a refusal without a unit", () => {
    const result = plan([batch({ id: "a", qty: 3 })], 5);
    expect(!result.ok && result.message).toBe("Only 3 in stock.");
  });

  it("hands over what exists when partial is allowed", () => {
    const result = plan(
      [
        batch({ id: "a", qty: 3 }),
        batch({ expiry: "2028-01-01", id: "b", qty: 2 }),
      ],
      9,
      true
    );
    expect(result.ok && result.plan).toMatchObject({ remaining: 4, take: 5 });
    expect(result.ok && result.plan.takes.map((t) => t.qty)).toEqual([3, 2]);
  });

  it("excludes expired, empty, disposed and deleted batches", () => {
    const result = plan(
      [
        batch({ expiry: "2026-11-11", id: "expired", qty: 100 }),
        batch({ id: "empty", qty: 0 }),
        batch({ id: "disposed", qty: 100, status: "disposed" }),
        batch({ deleted: true, id: "deleted", qty: 100 }),
        batch({ id: "ok", qty: 2 }),
      ],
      5
    );
    expect(!result.ok && result.available).toBe(2);
    expect(!result.ok && result.code).toBe("insufficient");
  });

  it("counts a batch expiring today as available", () => {
    const result = plan([batch({ expiry: TODAY, id: "today", qty: 4 })], 4);
    expect(result.ok && result.plan.takes[0].batchId).toBe("today");
  });

  it("reports nothing_available with the expired wording when only expired stock remains", () => {
    const result = plan([batch({ expiry: "2026-11-01", id: "x" })], 1, true);
    expect(result).toEqual({
      available: 0,
      code: "nothing_available",
      message:
        "Every batch of this item is expired or empty — dispose of it or stock in.",
      ok: false,
    });
  });

  it("reports nothing_available with the stock-in wording when there is no stock at all", () => {
    for (const batches of [[], [batch({ id: "z", qty: 0 })]]) {
      const result = plan(batches, 1);
      expect(!result.ok && result.code).toBe("nothing_available");
      expect(!result.ok && result.message).toBe(
        "Nothing is in stock for this item. Stock in first."
      );
    }
  });

  it("rejects quantities that are not positive integers", () => {
    for (const requested of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const result = plan([batch({ id: "a" })], requested, true);
      expect(result).toMatchObject({
        available: 0,
        code: "invalid_quantity",
        ok: false,
      });
    }
  });

  it("does not mutate the batches", () => {
    const batches = [
      batch({ expiry: "2027-03-01", id: "late", qty: 5 }),
      batch({ expiry: "2026-12-01", id: "early", qty: 3 }),
    ];
    const snapshot = structuredClone(batches);
    plan(batches, 6);
    expect(batches).toEqual(snapshot);
  });
});

describe("revalidatePlan", () => {
  const takes = [
    { batchId: "a", batchNumber: "A", expiry: "2026-12-01", qty: 3 },
    { batchId: "b", batchNumber: "B", expiry: "2027-03-01", qty: 4 },
  ];

  it("is valid when every batch still covers its take", () => {
    const current = [batch({ id: "a", qty: 3 }), batch({ id: "b", qty: 9 })];
    expect(revalidatePlan({ takes }, current, TODAY)).toEqual({
      problems: [],
      valid: true,
    });
  });

  it("flags a batch that expired since planning", () => {
    const current = [
      batch({ expiry: "2026-11-11", id: "a", qty: 3 }),
      batch({ id: "b", qty: 9 }),
    ];
    expect(revalidatePlan({ takes }, current, TODAY)).toEqual({
      problems: [{ available: 0, batchId: "a", reason: "expired" }],
      valid: false,
    });
  });

  it("flags a batch that now holds less than the take", () => {
    const current = [batch({ id: "a", qty: 3 }), batch({ id: "b", qty: 1 })];
    expect(revalidatePlan({ takes }, current, TODAY).problems).toEqual([
      { available: 1, batchId: "b", reason: "short" },
    ]);
  });

  it("flags disposed and emptied batches as short with nothing available", () => {
    const current = [
      batch({ id: "a", qty: 3, status: "disposed" }),
      batch({ id: "b", qty: 0 }),
    ];
    expect(revalidatePlan({ takes }, current, TODAY).problems).toEqual([
      { available: 0, batchId: "a", reason: "short" },
      { available: 0, batchId: "b", reason: "short" },
    ]);
  });

  it("flags missing and deleted batches", () => {
    const current = [batch({ deleted: true, id: "a", qty: 3 })];
    expect(revalidatePlan({ takes }, current, TODAY).problems).toEqual([
      { available: 0, batchId: "a", reason: "missing" },
      { available: 0, batchId: "b", reason: "missing" },
    ]);
  });

  it("accepts a batch expiring today", () => {
    const current = [
      batch({ expiry: TODAY, id: "a", qty: 3 }),
      batch({ id: "b", qty: 4 }),
    ];
    expect(revalidatePlan({ takes }, current, TODAY).valid).toBe(true);
  });

  it("is valid for an empty plan and does not mutate its inputs", () => {
    expect(revalidatePlan({ takes: [] }, [], TODAY).valid).toBe(true);
    const current = [batch({ id: "a", qty: 1 })];
    const snapshot = structuredClone({ current, takes });
    revalidatePlan({ takes }, current, TODAY);
    expect({ current, takes }).toEqual(snapshot);
  });
});
