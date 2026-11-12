import { describe, expect, it } from "vitest";

import { can, PERMISSIONS, type Permission, permissionsFor } from "./permissions";
import { ROLES, type Role } from "./roles";

/**
 * Spec §4, restated row by row. If `permissions.ts` drifts from the spec this
 * file fails — change both on purpose, never one by accident.
 */
const SPEC_MATRIX: {
  capability: string;
  permissions: Permission[];
  roles: Role[];
}[] = [
  {
    capability: "Manage users, roles, system settings",
    permissions: ["users.manage", "settings.manage"],
    roles: ["admin"],
  },
  {
    capability: "Register / edit items and batches",
    permissions: ["inventory.write"],
    roles: ["admin", "inventory"],
  },
  {
    capability: "Scan and look up items",
    permissions: ["scan.use"],
    roles: ["admin", "inventory", "pharmacist", "nurse", "health_admin"],
  },
  {
    capability: "View inventory, status, FEFO list",
    permissions: ["inventory.view", "dashboard.view", "alerts.view"],
    roles: ["admin", "inventory", "pharmacist", "nurse", "health_admin"],
  },
  {
    capability: "Create requests",
    permissions: ["requests.create"],
    roles: ["admin", "inventory", "pharmacist", "nurse"],
  },
  {
    capability: "Approve / prepare / dispense requests",
    permissions: ["requests.process"],
    roles: ["admin", "pharmacist"],
  },
  {
    capability: "Quick Deduct",
    permissions: ["stock.quick_deduct"],
    roles: ["admin", "inventory", "pharmacist", "nurse"],
  },
  {
    capability: "Adjust stock (count correction)",
    permissions: ["stock.adjust"],
    roles: ["admin", "inventory", "pharmacist"],
  },
  {
    capability: "Dispose / write off expired stock",
    permissions: ["stock.dispose"],
    roles: ["admin", "inventory", "pharmacist"],
  },
  {
    capability: "Soft-delete items/batches",
    permissions: ["inventory.delete"],
    roles: ["admin", "inventory"],
  },
  {
    capability: "Restore from Trash / permanent purge",
    permissions: ["trash.manage"],
    roles: ["admin"],
  },
  {
    capability: "View analytics and reports",
    permissions: ["analytics.view", "reports.view"],
    roles: ["admin", "inventory", "pharmacist", "health_admin"],
  },
  {
    capability: "Export reports (PDF/XLSX)",
    permissions: ["reports.export"],
    roles: ["admin", "health_admin"],
  },
  {
    capability: "View audit log",
    permissions: ["audit.view"],
    roles: ["admin", "health_admin"],
  },
  {
    capability: "Configure thresholds and alert settings",
    permissions: ["settings.manage"],
    roles: ["admin"],
  },
];

/** Permissions the spec does not list; defaults documented in permissions.ts. */
const DEFAULTS: { permissions: Permission[]; roles: Role[] }[] = [
  {
    permissions: ["requests.view"],
    roles: ["admin", "inventory", "pharmacist", "nurse", "health_admin"],
  },
  {
    permissions: ["dispensing.view"],
    roles: ["admin", "inventory", "pharmacist", "health_admin"],
  },
];

describe("role permission matrix (spec §4)", () => {
  for (const row of SPEC_MATRIX) {
    it(row.capability, () => {
      for (const permission of row.permissions) {
        for (const role of ROLES) {
          expect(can(role, permission), `${role} / ${permission}`).toBe(
            row.roles.includes(role)
          );
        }
      }
    });
  }

  it("documents the defaults the spec leaves open", () => {
    for (const row of DEFAULTS) {
      for (const permission of row.permissions) {
        for (const role of ROLES) {
          expect(can(role, permission), `${role} / ${permission}`).toBe(
            row.roles.includes(role)
          );
        }
      }
    }
  });

  it("covers every permission in the spec or the defaults", () => {
    const covered = new Set<Permission>([
      ...SPEC_MATRIX.flatMap((row) => row.permissions),
      ...DEFAULTS.flatMap((row) => row.permissions),
    ]);
    expect([...covered].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("keeps the Healthcare Administrator read-only apart from export and audit", () => {
    const writes: Permission[] = [
      "inventory.write",
      "inventory.delete",
      "requests.create",
      "requests.process",
      "stock.quick_deduct",
      "stock.adjust",
      "stock.dispose",
      "trash.manage",
      "users.manage",
      "settings.manage",
    ];
    for (const permission of writes) {
      expect(can("health_admin", permission), permission).toBe(false);
    }
  });

  it("gives nurses availability but no analytics", () => {
    expect(can("nurse", "inventory.view")).toBe(true);
    expect(can("nurse", "analytics.view")).toBe(false);
    expect(can("nurse", "reports.view")).toBe(false);
  });

  it("holds nothing for a missing role and lists permissions per role", () => {
    expect(can(null, "inventory.view")).toBe(false);
    expect(can(undefined, "inventory.view")).toBe(false);
    expect(permissionsFor("admin")).toEqual([...PERMISSIONS]);
    expect(permissionsFor("nurse")).toContain("stock.quick_deduct");
    expect(permissionsFor("nurse")).not.toContain("audit.view");
  });
});
