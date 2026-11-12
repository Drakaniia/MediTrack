import { describe, expect, it } from "vitest";

import {
  classifyLowStock,
  gap,
  gapPercent,
  LOW_STOCK_LABELS,
  suggestedReorderQty,
} from "./low-stock";

describe("classifyLowStock", () => {
  it("is out when nothing is available and a threshold is set", () => {
    expect(classifyLowStock({ available: 0, threshold: 10 })).toBe("out");
  });

  it("is low below the threshold", () => {
    expect(classifyLowStock({ available: 9, threshold: 10 })).toBe("low");
    expect(classifyLowStock({ available: 1, threshold: 10 })).toBe("low");
  });

  it("is in stock at or above the threshold", () => {
    expect(classifyLowStock({ available: 10, threshold: 10 })).toBe("in_stock");
    expect(classifyLowStock({ available: 50, threshold: 10 })).toBe("in_stock");
  });

  it("never alerts when the threshold is zero or negative", () => {
    expect(classifyLowStock({ available: 0, threshold: 0 })).toBe("in_stock");
    expect(classifyLowStock({ available: 3, threshold: 0 })).toBe("in_stock");
    expect(classifyLowStock({ available: 0, threshold: -5 })).toBe("in_stock");
  });
});

describe("gap", () => {
  it("is the shortfall against the threshold, never negative", () => {
    expect(gap({ available: 4, threshold: 10 })).toBe(6);
    expect(gap({ available: 10, threshold: 10 })).toBe(0);
    expect(gap({ available: 25, threshold: 10 })).toBe(0);
    expect(gap({ available: 0, threshold: 0 })).toBe(0);
  });
});

describe("gapPercent", () => {
  it("is stock as a percentage of the threshold, clamped to 0..100", () => {
    expect(gapPercent({ available: 5, threshold: 20 })).toBe(25);
    expect(gapPercent({ available: 0, threshold: 20 })).toBe(0);
    expect(gapPercent({ available: 40, threshold: 20 })).toBe(100);
    expect(gapPercent({ available: -3, threshold: 20 })).toBe(0);
  });

  it("handles a zero threshold", () => {
    expect(gapPercent({ available: 5, threshold: 0 })).toBe(100);
    expect(gapPercent({ available: 0, threshold: 0 })).toBe(0);
  });
});

describe("suggestedReorderQty", () => {
  it("tops up to twice the threshold", () => {
    expect(suggestedReorderQty({ available: 4, threshold: 10 })).toBe(16);
    expect(suggestedReorderQty({ available: 0, threshold: 10 })).toBe(20);
  });

  it("never suggests less than the threshold", () => {
    expect(suggestedReorderQty({ available: 15, threshold: 10 })).toBe(10);
    expect(suggestedReorderQty({ available: 100, threshold: 10 })).toBe(10);
  });

  it("is zero when there is no threshold", () => {
    expect(suggestedReorderQty({ available: 0, threshold: 0 })).toBe(0);
    expect(suggestedReorderQty({ available: 7, threshold: -1 })).toBe(0);
  });
});

describe("LOW_STOCK_LABELS", () => {
  it("labels every status", () => {
    expect(LOW_STOCK_LABELS).toEqual({
      in_stock: "In stock",
      low: "Low",
      out: "Out",
    });
  });
});
