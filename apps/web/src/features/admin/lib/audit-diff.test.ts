import { describe, expect, it } from "vitest";
import { makeAuditEntry } from "../test-data";
import { buildAuditCsv } from "./audit-csv";
import { diffSnapshots, hasSnapshot } from "./audit-diff";

describe("diffSnapshots", () => {
  it("flattens nested objects and labels each path", () => {
    const rows = diffSnapshots(
      { expiry: { nearDays: 30, urgentDays: 7 }, name: "A" },
      { expiry: { nearDays: 30, urgentDays: 10 }, extra: true, name: "A" }
    );
    expect(rows).toEqual([
      {
        after: "30",
        before: "30",
        path: "expiry.nearDays",
        status: "unchanged",
      },
      {
        after: "10",
        before: "7",
        path: "expiry.urgentDays",
        status: "changed",
      },
      { after: '"A"', before: '"A"', path: "name", status: "unchanged" },
      { after: "true", before: "", path: "extra", status: "added" },
    ]);
  });

  it("marks fields that disappeared, and handles a missing side", () => {
    expect(diffSnapshots({ a: 1 }, null)).toEqual([
      { after: "", before: "1", path: "a", status: "removed" },
    ]);
    expect(diffSnapshots(null, { a: [1, 2] })).toEqual([
      { after: "[1,2]", before: "", path: "a", status: "added" },
    ]);
    expect(diffSnapshots(null, null)).toEqual([]);
    expect(hasSnapshot(null, undefined)).toBe(false);
    expect(hasSnapshot(null, { a: 1 })).toBe(true);
  });

  it("treats a primitive snapshot as a single value", () => {
    expect(diffSnapshots("x", "y")).toEqual([
      { after: '"y"', before: '"x"', path: "(value)", status: "changed" },
    ]);
  });
});

describe("buildAuditCsv", () => {
  it("writes facility and UTC time, quotes cells and defuses formulas", () => {
    const csv = buildAuditCsv(
      [
        makeAuditEntry({
          actorName: '=HYPERLINK("x")',
          summary: 'Said "hi", left',
        }),
        makeAuditEntry({ actorId: null, actorRole: null, id: 2, ip: null }),
      ],
      "Asia/Manila"
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      '"Time (facility)","Time (UTC)","Actor","Role","Action","Entity type","Entity ID","Summary","IP"'
    );
    expect(lines[1]).toBe(
      `"12 Nov 2026, 00:30","2026-11-11T16:30:00.000Z","'=HYPERLINK(""x"")","System Administrator","user.update","user","user-maria","Said ""hi"", left","203.0.113.7"`
    );
    expect(lines[2]).toContain('"Test System Administrator","","user.update"');
    expect(lines[2].endsWith(',""')).toBe(true);
  });
});
