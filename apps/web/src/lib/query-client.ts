import { QueryClient } from "@tanstack/react-query";

import { isNetworkError } from "./api/errors";

const STALE_TIME_MS = 30_000;
const GC_TIME_MS = 300_000;
const NETWORK_RETRIES = 1;

/** Retry ONLY network failures, once. A 4xx/5xx is an answer, not a glitch. */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  return failureCount < NETWORK_RETRIES && isNetworkError(error);
}

/** Notifications are the one thing worth refreshing every time the tab regains focus. */
function refetchAlertsOnFocus(query: {
  queryKey: readonly unknown[];
}): boolean {
  return query.queryKey[0] === "alerts";
}

/**
 * The app's QueryClient. Defaults (ARCHITECTURE §6): data is fresh for 30 s,
 * only network errors are retried (once), and only `alerts` queries refetch on
 * window focus.
 *
 * Mutations use `networkMode: "always"` and never retry: while offline a
 * dispense must fail immediately and visibly, not be queued by React Query and
 * silently replayed — on stale data — when the connection comes back.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always", retry: false },
      queries: {
        gcTime: GC_TIME_MS,
        refetchOnWindowFocus: refetchAlertsOnFocus,
        retry: shouldRetryQuery,
        staleTime: STALE_TIME_MS,
      },
    },
  });
}
