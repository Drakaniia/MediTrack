import type {
  AlertRunBody,
  DailyJobReport,
  JobRunDto,
} from "@shared/schemas/alert-run";
import type { MeResponse } from "@shared/session";
import {
  type AppSettings,
  type SettingsPatch,
  toPublicSettings,
} from "@shared/settings";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiGet, apiPost, apiPut } from "@/lib/api/client";
import { ME_QUERY_KEY, meQueryOptions } from "@/lib/auth/queries";

export const settingsKeys = {
  all: ["settings"] as const,
  detail: ["settings", "detail"] as const,
  runStatus: ["settings", "alert-runs"] as const,
};

/** `GET /api/settings` needs `settings.manage`; callers pass `enabled: false` for everyone else. */
export function useSettings(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: ({ signal }) =>
      apiGet<AppSettings>("/settings", undefined, { signal }),
    queryKey: settingsKeys.detail,
  });
}

/**
 * `/auth/me` carries the facility name, timezone and thresholds that the header, the
 * tab title and every date on screen read. Components only ever READ it from the
 * cache (`useCachedMe` is never enabled), so marking it stale would refetch nothing:
 * patch the public settings in place for an instant update, then fetch the truth.
 */
async function refreshMe(
  queryClient: QueryClient,
  settings: AppSettings
): Promise<void> {
  queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, (me) =>
    me ? { ...me, settings: toPublicSettings(settings) } : me
  );
  await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  try {
    await queryClient.fetchQuery({ ...meQueryOptions(), staleTime: 0 });
  } catch {
    // The save itself worked; the next navigation revalidates `me`.
  }
}

/**
 * `PUT /api/settings`. The response is the full new settings object, so the cache
 * is replaced directly, and `/auth/me` is refreshed so the header and title follow.
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) =>
      apiPut<AppSettings>("/settings", patch),
    onSuccess: async (settings) => {
      queryClient.setQueryData(settingsKeys.detail, settings);
      await Promise.all([
        refreshMe(queryClient, settings),
        queryClient.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });
}

/** `GET /api/alerts/run/status`: the last runs of the daily job, newest first. */
export function useAlertRunStatus(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: ({ signal }) =>
      apiGet<JobRunDto[]>("/alerts/run/status", undefined, { signal }),
    queryKey: settingsKeys.runStatus,
  });
}

/** `POST /api/alerts/run`: runs the daily job now (admin). */
export function useRunAlertJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AlertRunBody) =>
      apiPost<DailyJobReport>("/alerts/run", body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsKeys.runStatus }),
        queryClient.invalidateQueries({ queryKey: ["alerts"] }),
        queryClient.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });
}
