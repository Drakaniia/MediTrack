import type { AnalyticsDto } from "@shared/schemas/analytics";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";

export interface AnalyticsFilters {
  categoryId: string;
  from: string;
  to: string;
}

export function useAnalytics(filters: AnalyticsFilters) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiGet<AnalyticsDto>(
        "/analytics",
        { ...filters },
        { signal }
      ),
    queryKey: ["analytics", filters] as const,
  });
}

