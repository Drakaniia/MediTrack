import { describe, expect, it } from "vitest";

import {
  addDays,
  daysBetween,
  isIsoDate,
  isIsoMonth,
  isTimeOfDay,
  isValidTimeZone,
  localDateOf,
  monthRange,
  startOfDayUtc,
  timeInZone,
  todayInZone,
  utcRangeForMonth,
  zonedDateTimeToUtc,
} from "./dates";

describe("ISO calendar dates", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isIsoDate("2026-11-12")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-11-12T00:00:00Z")).toBe(false);
    expect(isIsoDate("12/11/2026")).toBe(false);
    expect(isIsoDate(20_261_112)).toBe(false);
  });

  it("validates months and times of day", () => {
    expect(isIsoMonth("2026-11")).toBe(true);
    expect(isIsoMonth("2026-00")).toBe(false);
    expect(isIsoMonth("2026-13")).toBe(false);
    expect(isTimeOfDay("06:00")).toBe(true);
    expect(isTimeOfDay("23:59")).toBe(true);
    expect(isTimeOfDay("24:00")).toBe(false);
    expect(isTimeOfDay("6:00")).toBe(false);
  });

  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-11-12", 7)).toBe("2026-11-19");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-11-12", -12)).toBe("2026-10-31");
  });

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-11-12", "2026-11-12")).toBe(0);
    expect(daysBetween("2026-11-12", "2026-11-19")).toBe(7);
    expect(daysBetween("2026-11-12", "2026-11-11")).toBe(-1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("throws on an invalid date instead of returning NaN", () => {
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });
});

describe("month ranges", () => {
  it("returns first day, exclusive end and length", () => {
    expect(monthRange("2026-11")).toEqual({
      days: 30,
      endExclusive: "2026-12-01",
      month: "2026-11",
      start: "2026-11-01",
    });
    expect(monthRange("2026-02").days).toBe(28);
    expect(monthRange("2028-02").days).toBe(29);
    expect(monthRange("2026-12").endExclusive).toBe("2027-01-01");
  });
});

describe("facility timezone", () => {
  it("reads 'today' in the facility zone, not UTC", () => {
    const instant = new Date("2026-11-11T17:30:00.000Z");
    expect(todayInZone(instant, "Asia/Manila")).toBe("2026-11-12");
    expect(todayInZone(instant, "UTC")).toBe("2026-11-11");
    expect(todayInZone(instant, "America/Los_Angeles")).toBe("2026-11-11");
    expect(timeInZone(instant, "Asia/Manila")).toBe("01:30");
  });

  it("recognises valid and invalid zone names", () => {
    expect(isValidTimeZone("Asia/Manila")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it("converts facility wall time to the right UTC instant", () => {
    expect(
      zonedDateTimeToUtc("2026-11-12", "06:00", "Asia/Manila").toISOString()
    ).toBe("2026-11-11T22:00:00.000Z");
  });

  it("follows daylight saving time on both sides of the change", () => {
    expect(
      zonedDateTimeToUtc("2026-07-01", "06:00", "America/New_York").toISOString()
    ).toBe("2026-07-01T10:00:00.000Z");
    expect(
      zonedDateTimeToUtc("2026-12-01", "06:00", "America/New_York").toISOString()
    ).toBe("2026-12-01T11:00:00.000Z");
    // Spring-forward day: 06:00 is already EDT (UTC-4).
    expect(
      zonedDateTimeToUtc("2026-03-08", "06:00", "America/New_York").toISOString()
    ).toBe("2026-03-08T10:00:00.000Z");
  });

  it("resolves a wall time inside the spring-forward gap to a real instant", () => {
    const resolved = zonedDateTimeToUtc(
      "2026-03-08",
      "02:30",
      "America/New_York"
    );
    expect(Number.isNaN(resolved.getTime())).toBe(false);
    expect(todayInZone(resolved, "America/New_York")).toBe("2026-03-08");
  });

  it("finds local midnight and month bounds in UTC", () => {
    expect(startOfDayUtc("2026-11-12", "Asia/Manila").toISOString()).toBe(
      "2026-11-11T16:00:00.000Z"
    );
    expect(utcRangeForMonth("2026-11", "Asia/Manila")).toEqual({
      endUtc: "2026-11-30T16:00:00.000Z",
      startUtc: "2026-10-31T16:00:00.000Z",
    });
  });

  it("maps a stored UTC timestamp back to the facility-local date", () => {
    expect(localDateOf("2026-11-11T16:30:00.000Z", "Asia/Manila")).toBe(
      "2026-11-12"
    );
    expect(localDateOf("2026-11-11T15:59:59.000Z", "Asia/Manila")).toBe(
      "2026-11-11"
    );
  });
});
