import { describe, expect, it } from "vitest";

import {
  filterTimeZones,
  formatUtcOffset,
  listTimeZones,
  localTimePreview,
} from "./timezones";

const NOON_UTC = new Date("2026-11-12T12:00:00.000Z");

describe("time zones", () => {
  it("lists the browser's zones plus UTC and the current value, sorted", () => {
    const zones = listTimeZones(["Custom/Zone"]);
    expect(zones).toContain("Asia/Manila");
    expect(zones).toContain("UTC");
    expect(zones).toContain("Custom/Zone");
    expect(zones).toEqual([...zones].sort());
  });

  it("matches every word, ignoring case and the underscore", () => {
    const zones = ["America/New_York", "Asia/Manila", "Asia/Tokyo"];
    expect(filterTimeZones(zones, "new york")).toEqual(["America/New_York"]);
    expect(filterTimeZones(zones, "ASIA")).toEqual([
      "Asia/Manila",
      "Asia/Tokyo",
    ]);
    expect(filterTimeZones(zones, "asia man")).toEqual(["Asia/Manila"]);
    expect(filterTimeZones(zones, "nowhere")).toEqual([]);
    expect(filterTimeZones(zones, "", 2)).toEqual([
      "America/New_York",
      "Asia/Manila",
    ]);
  });

  it("formats the UTC offset", () => {
    expect(formatUtcOffset(NOON_UTC, "Asia/Manila")).toBe("UTC+08:00");
    expect(formatUtcOffset(NOON_UTC, "America/New_York")).toBe("UTC-05:00");
    expect(formatUtcOffset(NOON_UTC, "Asia/Kolkata")).toBe("UTC+05:30");
    expect(formatUtcOffset(NOON_UTC, "UTC")).toBe("UTC+00:00");
  });

  it("previews the wall clock in the zone", () => {
    expect(localTimePreview(NOON_UTC, "Asia/Manila")).toBe(
      "12 Nov 2026, 20:00 · UTC+08:00"
    );
  });
});
