import { describe, expect, it } from "vitest";

import { makeSettings } from "../test-data";
import { buildSettingsPatch, isEmptyPatch } from "./settings-patch";

describe("buildSettingsPatch", () => {
  it("is empty when nothing changed", () => {
    const base = makeSettings();
    const patch = buildSettingsPatch(base, makeSettings());
    expect(patch).toEqual({});
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it("contains only the fields that differ", () => {
    const base = makeSettings();
    const next = makeSettings({
      alerts: { ...base.alerts, push: false },
      facility: { ...base.facility, name: "Clinic X" },
    });
    expect(buildSettingsPatch(base, next)).toEqual({
      alerts: { push: false },
      facility: { name: "Clinic X" },
    });
  });

  it("compares recipient lists by value and order", () => {
    const base = makeSettings({
      digest: { recipients: ["a@x.org", "b@x.org"], skipWhenQuiet: true },
    });
    const same = makeSettings({
      digest: { recipients: ["a@x.org", "b@x.org"], skipWhenQuiet: true },
    });
    expect(buildSettingsPatch(base, same)).toEqual({});

    const removed = makeSettings({
      digest: { recipients: ["a@x.org"], skipWhenQuiet: true },
    });
    expect(buildSettingsPatch(base, removed)).toEqual({
      digest: { recipients: ["a@x.org"] },
    });

    const quiet = makeSettings({
      digest: { recipients: ["a@x.org", "b@x.org"], skipWhenQuiet: false },
    });
    expect(buildSettingsPatch(base, quiet)).toEqual({
      digest: { skipWhenQuiet: false },
    });
  });

  it("sends one threshold when only one moved", () => {
    const base = makeSettings();
    const next = makeSettings({ expiry: { nearDays: 30, urgentDays: 10 } });
    expect(buildSettingsPatch(base, next)).toEqual({
      expiry: { urgentDays: 10 },
    });
  });
});
