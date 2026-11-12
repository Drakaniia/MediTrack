import { describe, expect, it } from "vitest";

import {
  adjustInputSchema,
  disposalsQuerySchema,
  expiryQuerySchema,
  lowStockQuerySchema,
} from "../../../shared/schemas/expiry";
import { HttpError } from "../../http";
import { planAdjustment } from "./adjust-service";
import type { StockBatchRow } from "./stock-batch";

const ROW: StockBatchRow = {
  batch_deleted_at: null,
  batch_number: "B1",
  code: "ABCDEFGHJK",
  expiry: "2027-01-01",
  id: "b1",
  item_deleted_at: null,
  item_id: "i1",
  item_name: "Item",
  qty: 10,
  status: "active",
  strength: "",
};

describe("expiryQuerySchema", () => {
  it("defaults to the classes that need attention, sorted by expiry", () => {
    const query = expiryQuerySchema.parse({});
    expect(query.class).toEqual(["urgent", "near_expiry", "expired"]);
    expect(query.sort).toBe("expiry");
    expect(query.dir).toBe("asc");
  });

  it("splits, trims and de-duplicates the class list; blank falls back to the default", () => {
    expect(
      expiryQuerySchema.parse({ class: "safe, urgent,safe" }).class
    ).toEqual(["safe", "urgent"]);
    expect(expiryQuerySchema.parse({ class: "" }).class).toHaveLength(3);
  });

  it("treats blank text and dates as absent and rejects bad ones", () => {
    const query = expiryQuerySchema.parse({ from: "", search: "  ", to: "" });
    expect(query).toMatchObject({
      from: undefined,
      search: undefined,
      to: undefined,
    });
    expect(expiryQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(
      false
    );
    expect(expiryQuerySchema.safeParse({ class: "safe,nope" }).success).toBe(
      false
    );
  });
});

describe("low-stock and disposals queries", () => {
  it("default to everything", () => {
    expect(lowStockQuerySchema.parse({}).status).toEqual(["low", "out"]);
    expect(disposalsQuerySchema.parse({}).reason).toEqual([
      "expired",
      "damaged",
      "recalled",
      "other",
    ]);
  });
});

describe("adjustInputSchema", () => {
  it("needs exactly one of newQty or delta", () => {
    expect(
      adjustInputSchema.safeParse({ newQty: 3, reason: "other" }).success
    ).toBe(true);
    expect(
      adjustInputSchema.safeParse({ delta: -2, reason: "other" }).success
    ).toBe(true);
    expect(adjustInputSchema.safeParse({ reason: "other" }).success).toBe(
      false
    );
    expect(
      adjustInputSchema.safeParse({ delta: 1, newQty: 3, reason: "other" })
        .success
    ).toBe(false);
  });

  it("rejects zero deltas, fractions, negatives and a missing reason", () => {
    for (const body of [
      { delta: 0, reason: "other" },
      { newQty: 1.5, reason: "other" },
      { newQty: -1, reason: "other" },
      { newQty: 1 },
    ]) {
      expect(adjustInputSchema.safeParse(body).success).toBe(false);
    }
  });

  it("trims the note and defaults it to empty", () => {
    expect(adjustInputSchema.parse({ newQty: 1, reason: "found" }).note).toBe(
      ""
    );
    expect(
      adjustInputSchema.parse({ newQty: 1, note: "  hi  ", reason: "found" })
        .note
    ).toBe("hi");
  });
});

describe("planAdjustment", () => {
  const adjust = (fields: { delta?: number; newQty?: number }) =>
    planAdjustment(ROW, { note: "", reason: "other", ...fields });

  it("computes the target quantity", () => {
    expect(adjust({ newQty: 4 })).toBe(4);
    expect(adjust({ delta: 5 })).toBe(15);
    expect(adjust({ delta: -10 })).toBe(0);
  });

  it("refuses negative results and no-ops with a field-level validation error", () => {
    for (const fields of [
      { delta: -11 },
      { newQty: 10 },
      { delta: 99_999_999 },
    ]) {
      try {
        adjust(fields);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).code).toBe("validation_error");
      }
    }
  });
});
