import { describe, expect, it } from "vitest";

import { createMigratedD1 } from "../test/harness";
import { addDays } from "./dates";
import {
  assessExpiry,
  classBoundaries,
  classifyDays,
  DEFAULT_EXPIRY_THRESHOLDS,
  type ExpiryClass,
  expiryClassCase,
  expiryClassWhere,
  isExpired,
  relativeExpiryText,
  validateThresholds,
} from "./expiry";

const TODAY = "2026-11-12";

describe("classifyDays (spec §6.2 defaults 7 / 30)", () => {
  const cases: [number | null, ExpiryClass][] = [
    [-30, "expired"],
    [-1, "expired"],
    [0, "urgent"],
    [1, "urgent"],
    [7, "urgent"],
    [8, "near_expiry"],
    [30, "near_expiry"],
    [31, "safe"],
    [400, "safe"],
    [null, "safe"],
  ];
  for (const [days, expected] of cases) {
    it(`${days === null ? "no expiry" : `${days} days`} is ${expected}`, () => {
      expect(classifyDays(days)).toBe(expected);
    });
  }

  it("honours custom thresholds", () => {
    const custom = { nearDays: 60, urgentDays: 14 };
    expect(classifyDays(14, custom)).toBe("urgent");
    expect(classifyDays(15, custom)).toBe("near_expiry");
    expect(classifyDays(60, custom)).toBe("near_expiry");
    expect(classifyDays(61, custom)).toBe("safe");
  });

  it("classifies from calendar dates in the facility day", () => {
    expect(assessExpiry("2026-11-12", TODAY)).toEqual({
      daysUntil: 0,
      expiryClass: "urgent",
    });
    expect(assessExpiry("2026-11-11", TODAY).expiryClass).toBe("expired");
    expect(assessExpiry(null, TODAY)).toEqual({
      daysUntil: null,
      expiryClass: "safe",
    });
    expect(isExpired("2026-11-11", TODAY)).toBe(true);
    expect(isExpired("2026-11-12", TODAY)).toBe(false);
    expect(isExpired(null, TODAY)).toBe(false);
  });
});

describe("validateThresholds", () => {
  it("accepts 0 ≤ urgent < near", () => {
    expect(validateThresholds({ nearDays: 30, urgentDays: 7 }).ok).toBe(true);
    expect(validateThresholds({ nearDays: 1, urgentDays: 0 }).ok).toBe(true);
  });

  it("rejects bad pairs with a readable message", () => {
    const equal = validateThresholds({ nearDays: 7, urgentDays: 7 });
    expect(equal.ok).toBe(false);
    const negative = validateThresholds({ nearDays: 30, urgentDays: -1 });
    expect(negative.ok).toBe(false);
    const fractional = validateThresholds({ nearDays: 30.5, urgentDays: 7 });
    expect(fractional.ok).toBe(false);
    const huge = validateThresholds({ nearDays: 5000, urgentDays: 7 });
    expect(huge.ok).toBe(false);
    if (!equal.ok) {
      expect(equal.message).toMatch(/fewer/);
    }
  });
});

describe("relativeExpiryText", () => {
  it("words the day count", () => {
    expect(relativeExpiryText(null)).toBe("No expiry");
    expect(relativeExpiryText(-3)).toBe("Expired 3d ago");
    expect(relativeExpiryText(0)).toBe("Expires today");
    expect(relativeExpiryText(1)).toBe("Expires tomorrow");
    expect(relativeExpiryText(12)).toBe("In 12d");
  });
});

describe("SQL helpers agree with classifyDays on every day", () => {
  it("expiryClassCase and expiryClassWhere match the TypeScript rules", async () => {
    const d1 = createMigratedD1();
    const boundaries = classBoundaries(TODAY, DEFAULT_EXPIRY_THRESHOLDS);
    const dates: (string | null)[] = [null];
    for (let offset = -45; offset <= 45; offset += 1) {
      dates.push(addDays(TODAY, offset));
    }

    const caseFragment = expiryClassCase("d", boundaries);
    for (const date of dates) {
      const row = await d1
        .prepare(`SELECT ${caseFragment.sql} AS cls FROM (SELECT ? AS d)`)
        .bind(...caseFragment.params, date)
        .first<{ cls: ExpiryClass }>();
      const expected = assessExpiry(date, TODAY).expiryClass;
      expect(row?.cls, String(date)).toBe(expected);
    }

    for (const expiryClass of [
      "expired",
      "urgent",
      "near_expiry",
      "safe",
    ] as const) {
      const where = expiryClassWhere("d", expiryClass, boundaries);
      for (const date of dates) {
        const row = await d1
          .prepare(`SELECT 1 AS hit FROM (SELECT ? AS d) WHERE ${where.sql}`)
          .bind(date, ...where.params)
          .first<{ hit: number }>();
        const expected = assessExpiry(date, TODAY).expiryClass === expiryClass;
        expect(Boolean(row), `${expiryClass} ${String(date)}`).toBe(expected);
      }
    }
  });
});
