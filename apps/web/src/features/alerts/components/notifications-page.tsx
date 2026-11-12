import { Button } from "@cmis/ui/components/button";
import type { NotificationDto } from "@shared/schemas/alerts";
import { BellOff, CheckCheck } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";
import { toast } from "sonner";

import { DataState, type DataStateEmpty } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { errorMessage } from "@/lib/api/errors";
import { useFacility } from "@/lib/auth/guards";

import {
  useDismiss,
  useMarkAllRead,
  useMarkRead,
} from "../hooks/alert-mutations";
import {
  flattenNotifications,
  NO_FILTERS,
  type NotificationFilters,
  totalNotifications,
  useNotificationList,
} from "../hooks/alert-queries";
import {
  NOTIFICATIONS_PANEL_ID,
  NotificationFilterBar,
} from "./notification-filters";
import { NotificationRow } from "./notification-row";
import { PushOptInCard } from "./push-opt-in-card";

function isFiltered(filters: NotificationFilters): boolean {
  return filters.kind !== "" || filters.severity !== "";
}

function emptyState(
  filters: NotificationFilters,
  clear: () => void
): DataStateEmpty {
  if (isFiltered(filters)) {
    return {
      action: (
        <Button onClick={clear} variant="outline">
          Clear filters
        </Button>
      ),
      title: "No notifications match these filters",
    };
  }
  if (filters.unreadOnly) {
    return {
      description: "You have read everything. New alerts will show up here.",
      icon: CheckCheck,
      title: "You're all caught up",
    };
  }
  return {
    description:
      "Expiry and low-stock alerts will appear here as they are raised.",
    icon: BellOff,
    title: "No notifications yet",
  };
}

/** `/notifications`: every alert addressed to the facility, with per-user read/dismiss state. */
export function NotificationsPage(): ReactElement {
  const { timezone } = useFacility();
  const { openItemDetail } = useStockItemDetailDialog();
  const [filters, setFilters] = useState<NotificationFilters>(NO_FILTERS);
  const list = useNotificationList(filters);
  const markRead = useMarkRead();
  const dismiss = useDismiss();
  const markAllRead = useMarkAllRead();

  const rows = flattenNotifications(list.data?.pages);
  const total = totalNotifications(list.data?.pages);
  const unread = list.data?.pages.at(0)?.unread ?? 0;
  const busy = markRead.isPending || dismiss.isPending;

  const handleFailure = useCallback((failure: unknown) => {
    toast.error(errorMessage(failure, "That did not work. Try again."));
  }, []);
  const handleMarkRead = useCallback(
    (id: string) => markRead.mutate(id, { onError: handleFailure }),
    [handleFailure, markRead]
  );
  const handleDismiss = useCallback(
    (id: string) => dismiss.mutate(id, { onError: handleFailure }),
    [dismiss, handleFailure]
  );
  const handleOpenItem = useCallback(
    (notification: NotificationDto) => {
      if (notification.itemId) {
        openItemDetail(notification.itemId, {
          batchId: notification.batchId ?? undefined,
        });
      }
    },
    [openItemDetail]
  );
  const clearFilters = useCallback(() => setFilters(NO_FILTERS), []);

  return (
    <div>
      <PageHeader
        actions={
          <Button
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() =>
              markAllRead.mutate(undefined, { onError: handleFailure })
            }
            variant="outline"
          >
            <CheckCheck aria-hidden />
            Mark all read
          </Button>
        }
        description="Expiry and low-stock alerts. Read and dismissed states are yours alone."
        title="Notifications"
      />
      <PushOptInCard />
      <NotificationFilterBar
        filters={filters}
        onChange={setFilters}
        unread={unread}
      />
      <p aria-live="polite" className="pb-2 text-muted-foreground text-xs">
        {list.isPending
          ? "Loading…"
          : `${total} ${total === 1 ? "notification" : "notifications"}`}
      </p>
      <div id={NOTIFICATIONS_PANEL_ID} role="tabpanel">
        <DataState
          empty={emptyState(filters, clearFilters)}
          error={list.error}
          isEmpty={rows.length === 0}
          isLoading={list.isPending}
          onRetry={() => list.refetch()}
        >
          <ul aria-label="Notifications" className="space-y-2">
            {rows.map((notification) => (
              <NotificationRow
                busy={busy}
                key={notification.id}
                notification={notification}
                onDismiss={handleDismiss}
                onMarkRead={handleMarkRead}
                onOpenItem={handleOpenItem}
                timezone={timezone}
              />
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="flex justify-center pt-3">
              <Button
                disabled={list.isFetchingNextPage}
                onClick={() => list.fetchNextPage()}
                variant="outline"
              >
                {list.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </DataState>
      </div>
    </div>
  );
}
