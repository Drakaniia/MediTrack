import type {
  AlertBannerDto,
  NotificationDto,
  NotificationKind,
  NotificationSeverity,
  PushConfigDto,
  PushSubscriptionDto,
} from "@shared/schemas/alerts";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

import { apiGet, apiGetPage } from "@/lib/api/client";

import { unreadFromMeta } from "../lib/notification-view";

export const NOTIFICATION_PAGE_SIZE = 30;
export const BELL_PREVIEW_SIZE = 8;
/** The bell and banner poll while the tab is visible; focus also refreshes them (query-client). */
export const ALERTS_POLL_MS = 60_000;

export interface NotificationFilters {
  kind: NotificationKind | "";
  severity: NotificationSeverity | "";
  unreadOnly: boolean;
}

export const NO_FILTERS: NotificationFilters = {
  kind: "",
  severity: "",
  unreadOnly: false,
};

/** Every key starts with `alerts`, which `invalidateStockQueries` already refreshes. */
export const alertKeys = {
  all: ["alerts"] as const,
  banner: ["alerts", "banner"] as const,
  list: (filters: NotificationFilters) => ["alerts", "list", filters] as const,
  preview: ["alerts", "preview"] as const,
  pushConfig: ["alerts", "push", "config"] as const,
  pushDevices: ["alerts", "push", "devices"] as const,
  unread: ["alerts", "unread"] as const,
};

interface NotificationPage {
  offset: number;
  rows: NotificationDto[];
  total: number;
  unread: number;
}

async function fetchNotifications(
  filters: NotificationFilters,
  limit: number,
  offset: number
): Promise<NotificationPage> {
  const { data, meta } = await apiGetPage<NotificationDto[]>("/alerts", {
    kind: filters.kind,
    limit,
    offset,
    severity: filters.severity,
    unread: filters.unreadOnly ? 1 : undefined,
  });
  return {
    offset,
    rows: data,
    total: meta.total ?? data.length,
    unread: unreadFromMeta(meta),
  };
}

/** The notifications page: filtered, newest first, "load more" pages of 30. */
export function useNotificationList(filters: NotificationFilters) {
  return useInfiniteQuery({
    getNextPageParam: (last: NotificationPage) => {
      const next = last.offset + NOTIFICATION_PAGE_SIZE;
      return next < last.total ? next : undefined;
    },
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      fetchNotifications(filters, NOTIFICATION_PAGE_SIZE, pageParam),
    queryKey: alertKeys.list(filters),
  });
}

/** The bell's unread badge: one cheap row, the number is `meta.unread`. */
export function useUnreadCount() {
  return useQuery({
    queryFn: async () => {
      const { meta } = await apiGetPage<NotificationDto[]>("/alerts", {
        limit: 1,
        unread: 1,
      });
      return unreadFromMeta(meta);
    },
    queryKey: alertKeys.unread,
    refetchInterval: ALERTS_POLL_MS,
  });
}

/** The latest few notifications for the bell popover; only fetched while it is open. */
export function useBellPreview(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: async () => {
      const page = await fetchNotifications(NO_FILTERS, BELL_PREVIEW_SIZE, 0);
      return page.rows;
    },
    queryKey: alertKeys.preview,
  });
}

export function useAlertBannerData(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: () => apiGet<AlertBannerDto>("/alerts/banner"),
    queryKey: alertKeys.banner,
    refetchInterval: ALERTS_POLL_MS,
  });
}

export function usePushConfig() {
  return useQuery({
    queryFn: () => apiGet<PushConfigDto>("/push/config"),
    queryKey: alertKeys.pushConfig,
    staleTime: 5 * ALERTS_POLL_MS,
  });
}

export function usePushDevices() {
  return useQuery({
    queryFn: () => apiGet<PushSubscriptionDto[]>("/push/subscriptions"),
    queryKey: alertKeys.pushDevices,
  });
}

/** Rows of every loaded page, in order. */
export function flattenNotifications(
  pages: readonly NotificationPage[] | undefined
): NotificationDto[] {
  return pages?.flatMap((page) => page.rows) ?? [];
}

export function totalNotifications(
  pages: readonly NotificationPage[] | undefined
): number {
  return pages?.at(-1)?.total ?? 0;
}
