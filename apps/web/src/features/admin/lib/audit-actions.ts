/** Action-prefix chips: the server matches `action LIKE '<prefix>.%'`. */
export const AUDIT_ACTION_PREFIXES = [
  { label: "Auth", value: "auth" },
  { label: "Users", value: "user" },
  { label: "Settings", value: "settings" },
  { label: "Items", value: "item" },
  { label: "Batches", value: "batch" },
  { label: "Stock", value: "stock" },
  { label: "Requests", value: "request" },
  { label: "Quick deduct", value: "quick_deduct" },
  { label: "Alerts", value: "alerts" },
] as const;

export type AuditActionPrefix = (typeof AUDIT_ACTION_PREFIXES)[number]["value"];

/** `entity_type` values the services write. */
export const AUDIT_ENTITY_TYPES = [
  { label: "User", value: "user" },
  { label: "Settings", value: "settings" },
  { label: "Item", value: "item" },
  { label: "Batch", value: "batch" },
  { label: "Category", value: "category" },
  { label: "Inventory import", value: "inventory" },
  { label: "Request", value: "request" },
  { label: "Dispensing record", value: "dispensing_record" },
  { label: "Alerts", value: "alerts" },
] as const;
