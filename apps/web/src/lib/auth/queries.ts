import type {
  ChangePasswordInput,
  LoginInput,
  MeResponse,
} from "@shared/session";
import {
  mutationOptions,
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";

import { apiGet, apiPost, type RequestOptions } from "@/lib/api/client";

/** Query key of the signed-in user. Everything auth-related lives under the `auth` root. */
export const ME_QUERY_KEY = ["auth", "me"] as const;

const ME_STALE_TIME_MS = 60_000;

/** `GET /api/auth/me`: who am I, what may I do, the facility settings and "today". */
export function fetchMe(options?: RequestOptions): Promise<MeResponse> {
  return apiGet<MeResponse>("/auth/me", undefined, options);
}

export function meQueryOptions() {
  return queryOptions({
    queryFn: ({ signal }) => fetchMe({ signal }),
    queryKey: ME_QUERY_KEY,
    refetchOnWindowFocus: true,
    staleTime: ME_STALE_TIME_MS,
  });
}

/**
 * The signed-in user, loading it when it is not cached. Route guards already put
 * it in the cache before a protected page renders, so inside a page
 * `useMe().data` is defined; use `useCan` / `useFacility` for the common reads.
 */
export function useMe() {
  return useQuery(meQueryOptions());
}

/**
 * Like `useMe()` but NEVER fetches: it only reads (and subscribes to) what is in
 * the cache. For hooks that may run on the public pages (login), where an
 * `/auth/me` request would just be a 401.
 */
export function useCachedMe() {
  return useQuery({ ...meQueryOptions(), enabled: false });
}

/** Signing in replaces the whole session: drop whatever the previous user's session cached. */
export function loginMutation(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: LoginInput) =>
      apiPost<MeResponse>("/auth/login", input),
    onSuccess: (me) => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== ME_QUERY_KEY[0],
      });
      queryClient.setQueryData(ME_QUERY_KEY, me);
    },
  });
}

export interface LogoutVariables {
  /** Also end the user's sessions on every other device. */
  everywhere?: boolean;
}

/**
 * `POST /auth/logout` (or `/auth/logout-all`). It only talks to the server; use
 * `useSignOut()` (`./use-sign-out.ts`) in components, which also navigates to
 * /login and clears the cache in the right order.
 */
export function logoutMutation() {
  return mutationOptions({
    mutationFn: (variables?: LogoutVariables) =>
      apiPost(variables?.everywhere ? "/auth/logout-all" : "/auth/logout"),
  });
}

/** The server answers with a fresh `MeResponse` (`mustChangePassword` now false). */
export function changePasswordMutation(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (input: ChangePasswordInput) =>
      apiPost<MeResponse>("/auth/change-password", input),
    onSuccess: async (me) => {
      queryClient.setQueryData(ME_QUERY_KEY, me);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
