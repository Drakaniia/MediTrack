import type { NotificationDto } from "@shared/schemas/alerts";
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { apiDelete, apiPost } from "@/lib/api/client";

import { alertKeys } from "./alert-queries";

/** Refreshes everything that shows notification state; leaves push device queries alone. */
export function invalidateNotificationQueries(
  queryClient: QueryClient
): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === alertKeys.all[0] && query.queryKey[1] !== "push",
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost<NotificationDto>(`/alerts/${encodeURIComponent(id)}/read`),
    onSuccess: () => invalidateNotificationQueries(queryClient),
  });
}

export function useDismiss() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost<NotificationDto>(`/alerts/${encodeURIComponent(id)}/dismiss`),
    onSuccess: () => invalidateNotificationQueries(queryClient),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ marked: number }>("/alerts/read-all"),
    onSuccess: () => invalidateNotificationQueries(queryClient),
  });
}

export function useRemovePushDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/push/subscriptions/${encodeURIComponent(id)}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: alertKeys.pushDevices }),
  });
}
