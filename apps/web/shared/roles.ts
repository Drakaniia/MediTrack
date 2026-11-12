/**
 * The five roles from the brief (`all.md` §4), one role per user.
 *
 * Ids are stored in `users.role` (see the CHECK constraint in
 * `migrations/0001_init.sql`), so renaming one is a migration, not a refactor.
 */

export const ROLES = [
  "admin",
  "inventory",
  "pharmacist",
  "nurse",
  "health_admin",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "System Administrator",
  health_admin: "Healthcare Administrator",
  inventory: "Inventory Personnel",
  nurse: "Nurse / Healthcare Worker",
  pharmacist: "Pharmacist",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Manages accounts, roles and system settings. Full access.",
  health_admin:
    "Monitors inventory status, views reports and the audit log. Read-only apart from report export.",
  inventory:
    "Registers, scans and updates medical supply records. Can dispose of expired stock.",
  nurse:
    "Checks available and prioritised supplies, creates requests and uses Quick Deduct.",
  pharmacist:
    "Monitors expiry dates and FEFO priority; approves, prepares and dispenses requests.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
