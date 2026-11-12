import { cn } from "@cmis/ui/lib/utils";
import type { NotificationDto } from "@shared/schemas/alerts";
import type { ReactElement } from "react";

import { formatDateTime } from "@/lib/format";

import { SeverityBadge } from "./severity-badge";

export interface BellPreviewProps {
  error: unknown;
  isPending: boolean;
  notifications: readonly NotificationDto[];
  onSelect: (notification: NotificationDto) => void;
  timezone: string;
}

/** The latest notifications inside the bell popover. */
export function BellPreview({
  error,
  isPending,
  notifications,
  onSelect,
  timezone,
}: BellPreviewProps): ReactElement {
  if (isPending) {
    return <p className="p-4 text-muted-foreground text-sm">Loading…</p>;
  }
  if (error) {
    return (
      <p className="p-4 text-destructive text-sm" role="alert">
        Could not load notifications.
      </p>
    );
  }
  if (notifications.length === 0) {
    return (
      <p className="p-4 text-muted-foreground text-sm">No notifications yet.</p>
    );
  }
  return (
    <ul
      aria-label="Latest notifications"
      className="max-h-96 divide-y overflow-y-auto"
    >
      {notifications.map((notification) => (
        <li key={notification.id}>
          <button
            className={cn(
              "flex w-full flex-col items-start gap-1 px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted",
              notification.read ? "text-muted-foreground" : "text-foreground"
            )}
            onClick={() => onSelect(notification)}
            type="button"
          >
            <span className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={notification.severity} />
              {notification.read ? null : (
                <span className="font-medium text-xs">Unread</span>
              )}
            </span>
            <span
              className={cn(
                "text-sm",
                notification.read ? "font-normal" : "font-semibold"
              )}
            >
              {notification.title}
            </span>
            <span className="text-xs">
              {formatDateTime(notification.createdAt, timezone)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
