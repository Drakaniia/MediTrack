import type {
  NotificationDto,
  NotificationKind,
  NotificationSeverity,
} from "@shared/schemas/alerts";

export const KIND_LABELS: Record<NotificationKind, string> = {
  expired: "Expired",
  low_stock: "Low stock",
  near_expiry: "Near expiry",
  urgent: "Urgent",
};

export const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  critical: "Critical",
  info: "Info",
  warning: "Warning",
};

const MAX_BADGE_COUNT = 99;

/** "99+" keeps the badge a fixed width. */
export function badgeText(unread: number): string {
  return unread > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(unread);
}

export function bellLabel(unread: number): string {
  return `Notifications, ${unread} unread`;
}

/** The polite live-region message when the unread count rises, or "" when it did not. */
export function unreadAnnouncement(
  previous: number | null,
  current: number
): string {
  if (previous === null || current <= previous) {
    return "";
  }
  const added = current - previous;
  return added === 1 ? "1 new notification" : `${added} new notifications`;
}

/** Reads the unread total the list endpoint puts in `meta` (it is not part of `ApiMeta`). */
export function unreadFromMeta(meta: object): number {
  const { unread } = meta as { unread?: unknown };
  return typeof unread === "number" ? unread : 0;
}

/** The item a notification is about, as `data` names it (falls back to the title). */
export function notificationSubject(notification: NotificationDto): string {
  return notification.data.itemName ?? notification.title;
}
