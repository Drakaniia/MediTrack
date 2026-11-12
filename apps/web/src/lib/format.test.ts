import { describe, expect, it } from "vitest";

import {
  EMPTY_VALUE,
  formatDate,
  formatDateTime,
  formatQuantity,
  formatRelativeDay,
  formatTime,
} from "./format";

describe("formatDate", () => {
  it("formats a calendar date without any timezone shift", () => {
    expect(formatDate("2026-11-12")).toBe("12 Nov 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2028-02-29")).toBe("29 Feb 2028");
  });

  it("is not affected by the process timezone", () => {
    const original = process.env.TZ;
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      process.env.TZ = zone;
      expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
    }
    process.env.TZ = original;
  });

  it("shows a dash for missing values and passes malformed ones through", () => {
    expect(formatDate(null)).toBe(EMPTY_VALUE);
    expect(formatDate(undefined)).toBe(EMPTY_VALUE);
    expect(formatDate("")).toBe(EMPTY_VALUE);
    expect(formatDate("soon")).toBe("soon");
  });
});

describe("formatDateTime / formatTime", () => {
  // 2026-11-12T23:30Z is already 13 Nov in Manila (UTC+8) but still 12 Nov in Pago Pago (UTC-11).
  const instant = "2026-11-12T23:30:00.000Z";

  it("reads the instant on the facility's clock", () => {
    expect(formatDateTime(instant, "Asia/Manila")).toBe("13 Nov 2026, 07:30");
    expect(formatDateTime(instant, "Pacific/Pago_Pago")).toBe(
      "12 Nov 2026, 12:30"
    );
    expect(formatDateTime(instant, "UTC")).toBe("12 Nov 2026, 23:30");
  });

  it("formats the time alone, 24-hour, zero-padded", () => {
    expect(formatTime("2026-11-12T01:05:00.000Z", "UTC")).toBe("01:05");
    expect(formatTime(instant, "Asia/Manila")).toBe("07:30");
  });

  it("does not depend on the browser's timezone", () => {
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    expect(formatDateTime(instant, "Asia/Manila")).toBe("13 Nov 2026, 07:30");
    process.env.TZ = original;
  });

  it("handles missing and invalid values", () => {
    expect(formatDateTime(null, "UTC")).toBe(EMPTY_VALUE);
    expect(formatTime(undefined, "UTC")).toBe(EMPTY_VALUE);
    expect(formatDateTime("garbage", "UTC")).toBe("garbage");
  });
});

describe("formatRelativeDay", () => {
  const today = "2026-11-12";

  it("names today, tomorrow and yesterday", () => {
    expect(formatRelativeDay("2026-11-12", today)).toBe("Today");
    expect(formatRelativeDay("2026-11-13", today)).toBe("Tomorrow");
    expect(formatRelativeDay("2026-11-11", today)).toBe("Yesterday");
  });

  it("counts days either side, across month and year ends", () => {
    expect(formatRelativeDay("2026-11-17", today)).toBe("In 5 days");
    expect(formatRelativeDay("2026-11-09", today)).toBe("3 days ago");
    expect(formatRelativeDay("2027-01-01", "2026-12-31")).toBe("Tomorrow");
  });

  it("handles missing values", () => {
    expect(formatRelativeDay(null, today)).toBe(EMPTY_VALUE);
  });
});

describe("formatQuantity", () => {
  it("groups thousands and pluralises ordinary units", () => {
    expect(formatQuantity(1250, "tablet")).toBe("1,250 tablets");
    expect(formatQuantity(1, "box")).toBe("1 box");
    expect(formatQuantity(2, "box")).toBe("2 boxes");
    expect(formatQuantity(3, "bottle")).toBe("3 bottles");
    expect(formatQuantity(2, "ampoule")).toBe("2 ampoules");
    expect(formatQuantity(2, "supply")).toBe("2 supplies");
  });

  it("leaves symbols and measures alone", () => {
    expect(formatQuantity(5, "ml")).toBe("5 ml");
    expect(formatQuantity(2, "mg")).toBe("2 mg");
    expect(formatQuantity(4, "pcs")).toBe("4 pcs");
  });

  it("works without a unit, with decimals, and with a bad number", () => {
    expect(formatQuantity(12, "")).toBe("12");
    expect(formatQuantity(1.5, "L")).toBe("1.5 L");
    expect(formatQuantity(Number.NaN, "box")).toBe(EMPTY_VALUE);
  });
});
