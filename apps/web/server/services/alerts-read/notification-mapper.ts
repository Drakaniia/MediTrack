/** Row → DTO mapping for notifications (the generator writes them; this slice only reads). */

import type {
  NotificationData,
  NotificationDto,
  NotificationKind,
  NotificationSeverity,
} from "../../../shared/schemas/alerts";

export interface NotificationRow {
  batch_id: string | null;
  body: string;
  created_at: string;
  data: string;
  dismissed_at: string | null;
  id: string;
  item_id: string | null;
  kind: NotificationKind;
  read_at: string | null;
  resolved_at: string | null;
  severity: NotificationSeverity;
  title: string;
}

/** Selected by every query that returns `NotificationRow`s (`s` = the caller's state row). */
export const NOTIFICATION_COLUMNS =
  "n.id, n.kind, n.severity, n.item_id, n.batch_id, n.title, n.body, n.data, n.created_at, n.resolved_at, s.read_at, s.dismissed_at";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Only same-origin paths may be linked to: `/inventory/expiry` yes, `//evil.test` and `https://…` no. */
export function isLocalPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

/**
 * Reads the free-form `data` column defensively: a corrupt or hand-edited value
 * yields `{}` (or just the valid fields) instead of failing the whole list.
 */
export function parseNotificationData(text: string): NotificationData {
  const raw = parseJson(text);
  if (!isRecord(raw)) {
    return {};
  }
  const data: NotificationData = {};
  if (typeof raw.itemName === "string") {
    data.itemName = raw.itemName;
  }
  if (typeof raw.batchNumber === "string") {
    data.batchNumber = raw.batchNumber;
  }
  if (typeof raw.expiry === "string") {
    data.expiry = raw.expiry;
  }
  if (typeof raw.unit === "string") {
    data.unit = raw.unit;
  }
  if (typeof raw.url === "string" && isLocalPath(raw.url)) {
    data.url = raw.url;
  }
  for (const key of ["daysUntil", "onHand", "threshold"] as const) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      data[key] = value;
    }
  }
  return data;
}

export function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    batchId: row.batch_id,
    body: row.body,
    createdAt: row.created_at,
    data: parseNotificationData(row.data),
    dismissed: row.dismissed_at !== null,
    id: row.id,
    itemId: row.item_id,
    kind: row.kind,
    read: row.read_at !== null,
    resolvedAt: row.resolved_at,
    severity: row.severity,
    title: row.title,
  };
}
