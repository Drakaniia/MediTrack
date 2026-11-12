import { Button } from "@cmis/ui/components/button";
import { cn } from "@cmis/ui/lib/utils";
import type { NotificationDto } from "@shared/schemas/alerts";
import { Check, ExternalLink, X } from "lucide-react";
import type { ReactElement } from "react";

import { formatDateTime } from "@/lib/format";

import { KIND_LABELS } from "../lib/notification-view";
import { SeverityBadge } from "./severity-badge";

export interface NotificationRowProps {
  /** An action on this row is in flight. */
  busy: boolean;
  notification: NotificationDto;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
  onOpenItem: (notification: NotificationDto) => void;
  timezone: string;
}

/** One notification on the notifications page, with its three actions. */
export function NotificationRow({
  busy,
  notification,
  onDismiss,
  onMarkRead,
  onOpenItem,
  timezone,
}: NotificationRowProps): ReactElement {
  const { id, read, title } = notification;
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-start sm:gap-4",
        read ? "text-muted-foreground" : "border-primary/30"
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={notification.severity} />
          <span className="text-muted-foreground text-xs">
            {KIND_LABELS[notification.kind]}
          </span>
          {read ? null : (
            <span className="rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground text-xs">
              Unread
            </span>
          )}
          {notification.resolvedAt ? (
            <span className="text-muted-foreground text-xs">
              Resolved {formatDateTime(notification.resolvedAt, timezone)}
            </span>
          ) : null}
        </div>
        <h3
          className={cn(
            "text-sm",
            read ? "font-normal" : "font-semibold text-foreground"
          )}
        >
          {title}
        </h3>
        <p className="text-sm">{notification.body}</p>
        <p className="text-muted-foreground text-xs">
          <time dateTime={notification.createdAt}>
            {formatDateTime(notification.createdAt, timezone)}
          </time>
        </p>
      </div>
      <div className="flex flex-wrap gap-2 sm:shrink-0">
        {notification.itemId ? (
          <Button
            aria-label={`View item for ${title}`}
            onClick={() => onOpenItem(notification)}
            size="sm"
            variant="outline"
          >
            <ExternalLink aria-hidden />
            View item
          </Button>
        ) : null}
        {read ? null : (
          <Button
            aria-label={`Mark ${title} as read`}
            disabled={busy}
            onClick={() => onMarkRead(id)}
            size="sm"
            variant="outline"
          >
            <Check aria-hidden />
            Mark read
          </Button>
        )}
        <Button
          aria-label={`Dismiss ${title}`}
          disabled={busy}
          onClick={() => onDismiss(id)}
          size="sm"
          variant="ghost"
        >
          <X aria-hidden />
          Dismiss
        </Button>
      </div>
    </li>
  );
}
