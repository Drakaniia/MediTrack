import { describe, expect, it } from "vitest";

import { donutSegments } from "./donut";
import {
  formatMonthLabel,
  joinMonth,
  splitMonth,
  yearOptions,
} from "./months";

describe("month helpers", () => {
  it("splits and joins YYYY-MM without a day", () => {
    expect(splitMonth("2026-03")).toEqual({ month: 3, year: 2026 });
    expect(joinMonth(2026, 3)).toBe("2026-03");
    expect(joinMonth(2027, 12)).toBe("2027-12");
  });

  it("rejects anything that is not a month", () => {
    expect(() => splitMonth("2026-13")).toThrow(RangeError);
    expect(() => splitMonth("2026-03-01")).toThrow(RangeError);
  });

  it("formats a month label", () => {
    expect(formatMonthLabel("2026-11")).toBe("November 2026");
  });

  it("offers a window of years that always contains the selection", () => {
    const years = yearOptions(2026, 2026);
    expect(years[0]).toBe(2021);
    expect(years.at(-1)).toBe(2031);
    expect(yearOptions(2040, 2026)).toContain(2040);
    expect(yearOptions(2010, 2026)).toContain(2010);
  });
});

describe("donutSegments", () => {
  it("lays arcs end to end in proportion to their values", () => {
    const [a, b, c] = donutSegments([1, 1, 2], 100);
    expect(a).toEqual({ dash: 25, offset: -0, value: 1 });
    expect(b.dash).toBe(25);
    expect(b.offset).toBe(-25);
    expect(c.dash).toBe(50);
    expect(c.offset).toBe(-50);
  });

  it("draws nothing when there is nothing to show", () => {
    expect(donutSegments([0, 0, 0])).toEqual([]);
  });

  it("gives a zero value an empty arc", () => {
    expect(donutSegments([0, 4], 100)[0].dash).toBe(0);
  });
});
