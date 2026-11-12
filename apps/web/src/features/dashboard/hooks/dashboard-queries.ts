import type { DashboardDto } from "@shared/schemas/dashboard";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";

/** Re-read the dashboard every 5 minutes while the tab is visible. */
export const DASHBOARD_REFETCH_MS = 300_000;

/** Root `dashboard`: `invalidateStockQueries` refreshes it after any stock change. */
export const dashboardKeys = {
  overview: (month: string) => ["dashboard", "overview", month] as const,
};

export function useDashboard(month: string) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiGet<DashboardDto>("/dashboard", { month }, { signal }),
    queryKey: dashboardKeys.overview(month),
    refetchInterval: DASHBOARD_REFETCH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
