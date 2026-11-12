import { permissionsFor } from "@shared/permissions";
import { ROLES, type Role } from "@shared/roles";
import { describe, expect, it } from "vitest";

import { activeNavPath, NAV_ITEMS, visibleNav } from "./nav-config";

function labelsFor(role: Role): string[] {
  return visibleNav(permissionsFor(role)).flatMap((section) =>
    section.items.map((item) => item.label)
  );
}

describe("visibleNav", () => {
  it("shows an admin every entry, in the specified sections", () => {
    const sections = visibleNav(permissionsFor("admin"));
    expect(sections.map((section) => section.title)).toEqual([
      "Overview",
      "Inventory",
      "Requests",
      "Insights",
      "Administration",
      "Help",
    ]);
    expect(labelsFor("admin")).toHaveLength(NAV_ITEMS.length);
    expect(labelsFor("admin")).toEqual(
      expect.arrayContaining([
        "Dashboard",
        "Inventory",
        "Add stock",
        "Use first (FEFO)",
        "Expiry",
        "Low stock",
        "Quarantine",
        "Scan",
        "Labels",
        "Requests",
        "Dispensing log",
        "Notifications",
        "Analytics",
        "Reports",
        "Audit log",
        "Trash",
        "Users",
        "Settings",
        "Docs",
      ])
    );
  });

  it("hides Audit log and Users from a nurse", () => {
    const labels = labelsFor("nurse");
    expect(labels).not.toContain("Audit log");
    expect(labels).not.toContain("Users");
    expect(labels).not.toContain("Dispensing log");
    expect(labels).toContain("Requests");
    expect(labels).toContain("Use first (FEFO)");
  });

  it("gives a healthcare admin Audit log and Reports but not Add stock", () => {
    const labels = labelsFor("health_admin");
    expect(labels).toContain("Audit log");
    expect(labels).toContain("Reports");
    expect(labels).not.toContain("Add stock");
    expect(labels).not.toContain("Labels");
    expect(labels).not.toContain("Users");
  });

  it("keeps Trash and Users for the system administrator only", () => {
    for (const role of ROLES) {
      const labels = labelsFor(role);
      expect(labels.includes("Trash")).toBe(role === "admin");
      expect(labels.includes("Users")).toBe(role === "admin");
    }
  });

  it("shows only authenticated entries when the role has no permissions", () => {
    expect(
      visibleNav([]).flatMap((section) => section.items.map((i) => i.label))
    ).toEqual(["Settings", "Docs"]);
  });

  it("never returns an empty section", () => {
    for (const role of ROLES) {
      for (const section of visibleNav(permissionsFor(role))) {
        expect(section.items.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("activeNavPath", () => {
  it("prefers the most specific entry", () => {
    expect(activeNavPath("/inventory")).toBe("/inventory");
    expect(activeNavPath("/inventory/add")).toBe("/inventory/add");
    expect(activeNavPath("/inventory/fefo/")).toBe("/inventory/fefo");
  });

  it("matches only the home page for /", () => {
    expect(activeNavPath("/")).toBe("/");
    expect(activeNavPath("/nowhere")).toBeNull();
  });

  it("keeps a parent active for deeper paths", () => {
    expect(activeNavPath("/docs/getting-started")).toBe("/docs");
  });
});
