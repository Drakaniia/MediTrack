/**
 * The role → permission matrix (spec §4). One table, two enforcers:
 *
 *  - the API checks it on EVERY route (`server/router.ts` refuses to register a
 *    route without an `access` rule), so the UI is never the only gate;
 *  - the SPA reads it to hide what a role cannot do (`useCan()`).
 *
 * `permissions.test.ts` re-states the spec's table row by row and fails if this
 * file drifts from it. Rows flagged "my defaults" in the spec (§4 notes) are
 * marked below so a reviewer can find them.
 */

import type { Role } from "./roles";

export const PERMISSIONS = [
  /** Dashboard cards. */
  "dashboard.view",
  /** Items, batches, status, FEFO lists, quarantine view. Read-only. */
  "inventory.view",
  /** Register / edit items and batches, labels, bulk import. */
  "inventory.write",
  /** Soft-delete items and batches. */
  "inventory.delete",
  /** Scan page, global scan field, code lookup. */
  "scan.use",
  /** See the request queue. (Default: every role; health admin is read-only.) */
  "requests.view",
  /** Create requests. */
  "requests.create",
  /** Approve / prepare / dispense / deny requests. */
  "requests.process",
  /** Ctrl+D one-step deduction. */
  "stock.quick_deduct",
  /** Count correction on a batch. */
  "stock.adjust",
  /** Dispose / write off a batch with a reason. */
  "stock.dispose",
  /** Dispensing log. (Default: not nurses.) */
  "dispensing.view",
  /** Analytics dashboard. */
  "analytics.view",
  /** Stock and expiry reports on screen. */
  "reports.view",
  /** PDF / XLSX export of reports. */
  "reports.export",
  /** Audit log. */
  "audit.view",
  /** Own notification centre and push opt-in. */
  "alerts.view",
  /** Trash: list, restore, permanent purge. */
  "trash.manage",
  /** Users: create, disable, reset password, change role. */
  "users.manage",
  /** Facility name, timezone, thresholds, alert channels, digest. */
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EVERYONE: readonly Role[] = [
  "admin",
  "inventory",
  "pharmacist",
  "nurse",
  "health_admin",
];

/** Roles allowed per permission. Read this table side by side with spec §4. */
const ALLOWED_ROLES: Record<Permission, readonly Role[]> = {
  "alerts.view": EVERYONE,
  "analytics.view": ["admin", "inventory", "pharmacist", "health_admin"],
  "audit.view": ["admin", "health_admin"],
  "dashboard.view": EVERYONE,
  "dispensing.view": ["admin", "inventory", "pharmacist", "health_admin"],
  "inventory.delete": ["admin", "inventory"],
  "inventory.view": EVERYONE,
  "inventory.write": ["admin", "inventory"],
  "reports.export": ["admin", "health_admin"],
  "reports.view": ["admin", "inventory", "pharmacist", "health_admin"],
  "requests.create": ["admin", "inventory", "pharmacist", "nurse"],
  "requests.process": ["admin", "pharmacist"],
  "requests.view": EVERYONE,
  "scan.use": EVERYONE,
  "settings.manage": ["admin"],
  "stock.adjust": ["admin", "inventory", "pharmacist"],
  "stock.dispose": ["admin", "inventory", "pharmacist"],
  "stock.quick_deduct": ["admin", "inventory", "pharmacist", "nurse"],
  "trash.manage": ["admin"],
  "users.manage": ["admin"],
};

export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === "string" &&
    (PERMISSIONS as readonly string[]).includes(value)
  );
}

/** True when `role` holds `permission`. Unknown roles hold nothing. */
export function can(
  role: Role | null | undefined,
  permission: Permission
): boolean {
  if (!role) {
    return false;
  }
  return ALLOWED_ROLES[permission].includes(role);
}

/** Every permission a role holds, in declaration order. Sent to the SPA in `/api/auth/me`. */
export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => can(role, permission));
}

/** Roles that hold a permission — used by tests and the "who can do this" help text. */
export function rolesWith(permission: Permission): readonly Role[] {
  return ALLOWED_ROLES[permission];
}
