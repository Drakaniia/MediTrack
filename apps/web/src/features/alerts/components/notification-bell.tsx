import { Button } from "@cmis/ui/components/button";
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from "@cmis/ui/components/popover";
import type { NotificationDto } from "@shared/schemas/alerts";
import { Link } from "@tanstack/react-router";
import { Bell, CheckCheck } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";
import { toast } from "sonner";

import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { errorMessage } from "@/lib/api/errors";
import { useFacility } from "@/lib/auth/guards";

import { useMarkAllRead, useMarkRead } from "../hooks/alert-mutations";
import { useBellPreview, useUnreadCount } from "../hooks/alert-queries";
import { useUnreadAnnouncement } from "../hooks/use-unread-announcement";
import { badgeText, bellLabel } from "../lib/notification-view";
import { BellPreview } from "./bell-preview";

/**
 * The header bell: unread badge, a popover with the latest notifications and a path to
 * `/notifications`. The unread count refreshes every minute while the tab is visible and
 * whenever the window regains focus; a rise is announced once, politely, to screen readers.
 */
export function NotificationBell(): ReactElement {
  const { timezone } = useFacility();
  const { openItemDetail } = useStockItemDetailDialog();
  const [open, setOpen] = useState(false);
  const unreadQuery = useUnreadCount();
  const preview = useBellPreview(open);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const unread = unreadQuery.data ?? 0;
  const announcement = useUnreadAnnouncement(unreadQuery.data);

  const handleFailure = useCallback((failure: unknown) => {
    toast.error(errorMessage(failure, "That did not work. Try again."));
  }, []);
  const handleSelect = useCallback(
    (notification: NotificationDto) => {
      if (!notification.read) {
        markRead.mutate(notification.id, { onError: handleFailure });
      }
      if (notification.itemId) {
        setOpen(false);
        openItemDetail(notification.itemId, {
          batchId: notification.batchId ?? undefined,
        });
      }
    },
    [handleFailure, markRead, openItemDetail]
  );
  const handleMarkAll = useCallback(
    () => markAllRead.mutate(undefined, { onError: handleFailure }),
    [handleFailure, markAllRead]
  );
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          render={
            <Button
              aria-label={bellLabel(unread)}
              className="tap-target relative"
              size="icon"
              variant="ghost"
            />
          }
        >
          <Bell aria-hidden />
          {unread > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-semibold text-[0.625rem] text-white tabular-nums leading-4">
              {badgeText(unread)}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverPositioner align="end" sideOffset={8}>
            <PopoverPopup className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <h2 className="font-semibold text-sm">Notifications</h2>
                <Button
                  disabled={unread === 0 || markAllRead.isPending}
                  onClick={handleMarkAll}
                  size="sm"
                  variant="ghost"
                >
                  <CheckCheck aria-hidden />
                  Mark all read
                </Button>
              </div>
              <BellPreview
                error={preview.error}
                isPending={preview.isPending}
                notifications={preview.data ?? []}
                onSelect={handleSelect}
                timezone={timezone}
              />
              <div className="border-t px-3 py-2">
                <Link
                  className="font-medium text-primary text-sm underline-offset-4 hover:underline"
                  onClick={close}
                  to="/notifications"
                >
                  View all notifications
                </Link>
              </div>
            </PopoverPopup>
          </PopoverPositioner>
        </PopoverPortal>
      </Popover>
      <span aria-live="polite" className="sr-only" role="status">
        {announcement}
      </span>
    </>
  );
}
