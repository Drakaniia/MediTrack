import { todayInZone } from "@shared/dates";
import type { Permission } from "@shared/permissions";
import type { MeResponse } from "@shared/session";
import { DEFAULT_SETTINGS } from "@shared/settings";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { useMemo } from "react";

import { isApiError } from "@/lib/api/errors";
import { useMinuteClock } from "@/lib/clock";
import { flashError } from "@/lib/flash";

import { fetchMe, ME_QUERY_KEY, meQueryOptions, useCachedMe } from "./queries";
import { redirectSearch, sanitizeRedirect } from "./redirect";

/**
 * Route guards and the permission/facility hooks.
 *
 * The SPA only HIDES what a role cannot do (the API enforces it): a guard turns
 * "you cannot open this" into a redirect before the page renders, and `useCan`
 * / `<Can>` hide controls inside pages.
 */

export type GuardRequirement = Permission | "authenticated";

export interface GuardContext {
  queryClient: QueryClient;
}

/** The location being navigated TO (TanStack's `beforeLoad` passes it as `location`). */
export interface GuardLocation {
  href?: string;
}

export interface GuardOptions {
  /** `/change-password` itself: a user who must change their password may open it. */
  allowPasswordChangePending?: boolean;
  location?: GuardLocation;
  /** `beforeLoad`'s `preload` flag: hovering a link must not toast. */
  preload?: boolean;
}

const FORBIDDEN_MESSAGE = "You don't have access to that page.";

function currentHref(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  const { hash, pathname, search } = window.location;
  return `${pathname}${search}${hash}`;
}

function targetOf(location: GuardLocation | undefined): string | undefined {
  return sanitizeRedirect(location?.href ?? currentHref());
}

/**
 * Loads `me` for a guard. Uses the cache when it has a value (and revalidates a
 * stale one in the background); a 401 turns into a redirect to /login. The
 * request is `quiet`, so the client's global 401 handler does not ALSO navigate.
 */
async function loadMe(
  queryClient: QueryClient,
  location: GuardLocation | undefined
): Promise<MeResponse> {
  try {
    return await queryClient.ensureQueryData({
      ...meQueryOptions(),
      queryFn: ({ signal }) => fetchMe({ quiet: true, signal }),
      revalidateIfStale: true,
    });
  } catch (error) {
    if (isApiError(error) && error.code === "unauthenticated") {
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
      throw redirect({
        search: redirectSearch(targetOf(location)),
        to: "/login",
      });
    }
    throw error;
  }
}

/**
 * `beforeLoad` guard for every route:
 *
 *   beforeLoad: ({ context, location, preload }) =>
 *     requirePermission(context, "inventory.view", { location, preload }),
 *
 *  - not signed in (401)             → /login?redirect=<where they were going>
 *  - must change their password      → /change-password
 *  - role lacks the permission       → / with a toast ("You don't have access…")
 *  - `"authenticated"`               → any signed-in user
 */
export async function requirePermission(
  context: GuardContext,
  requirement: GuardRequirement,
  options: GuardOptions = {}
): Promise<void> {
  const me = await loadMe(context.queryClient, options.location);

  if (me.user.mustChangePassword && !options.allowPasswordChangePending) {
    throw redirect({
      search: redirectSearch(targetOf(options.location)),
      to: "/change-password",
    });
  }

  if (
    requirement !== "authenticated" &&
    !me.permissions.includes(requirement)
  ) {
    if (!options.preload) {
      flashError(FORBIDDEN_MESSAGE);
    }
    throw redirect({ to: "/" });
  }
}

export interface BeforeLoadArgs {
  context: GuardContext;
  location: GuardLocation;
  preload: boolean;
}

/**
 * The usual route guard, ready to plug into `beforeLoad`:
 *
 *   beforeLoad: guardFor("inventory.view"),
 *
 * Equivalent to calling `requirePermission(context, requirement, { location, preload })`.
 */
export function guardFor(
  requirement: GuardRequirement,
  options: Pick<GuardOptions, "allowPasswordChangePending"> = {}
): (args: BeforeLoadArgs) => Promise<void> {
  return ({ context, location, preload }) =>
    requirePermission(context, requirement, { ...options, location, preload });
}

/** The signed-in user right now, asked of the server (never trusts a stale cache), or `null`. */
async function fetchSignedInUser(
  queryClient: QueryClient
): Promise<MeResponse | null> {
  try {
    return await queryClient.fetchQuery({
      ...meQueryOptions(),
      queryFn: ({ signal }) => fetchMe({ quiet: true, signal }),
      staleTime: 0,
    });
  } catch {
    // Not signed in (401), or the server cannot be reached: show the form.
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    return null;
  }
}

/**
 * `beforeLoad` for /login: someone who already has a session goes straight in
 * (to /change-password when they still must pick a password).
 */
export async function redirectIfSignedIn(context: GuardContext): Promise<void> {
  const me = await fetchSignedInUser(context.queryClient);
  if (!me) {
    return;
  }
  throw redirect({
    to: me.user.mustChangePassword ? "/change-password" : "/",
  });
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

const NO_PERMISSIONS: readonly Permission[] = [];

/** Every permission of the signed-in role (empty before sign-in). */
export function usePermissions(): readonly Permission[] {
  return useCachedMe().data?.permissions ?? NO_PERMISSIONS;
}

/** True when the signed-in role holds `permission`. Hides controls; the API still enforces. */
export function useCan(permission: Permission): boolean {
  return usePermissions().includes(permission);
}

export interface Facility {
  name: string;
  /** Last day count (inclusive) that is still "Near Expiry". */
  nearDays: number;
  /** IANA zone every date on screen is read in. */
  timezone: string;
  /** Facility-local calendar date, `YYYY-MM-DD`. Rolls over at facility midnight. */
  today: string;
  /** Last day count (inclusive) that is "Urgent". */
  urgentDays: number;
}

function clockSkewMs(serverTime: string, receivedAt: number): number {
  const server = Date.parse(serverTime);
  return Number.isNaN(server) ? 0 : server - receivedAt;
}

/**
 * The facility context from `/auth/me`: name, timezone, thresholds and "today".
 *
 * `today` is recomputed in the facility timezone every 60 s, from the browser
 * clock corrected by the server's clock at the time `me` was fetched — so a
 * laptop set to the wrong time or zone still agrees with the server about
 * which day it is. Before sign-in it falls back to the shipped defaults.
 */
export function useFacility(): Facility {
  const { data: me, dataUpdatedAt } = useCachedMe();
  const clock = useMinuteClock();

  const name = me?.settings.facilityName ?? DEFAULT_SETTINGS.facility.name;
  const timezone = me?.settings.timezone ?? DEFAULT_SETTINGS.facility.timezone;
  const urgentDays =
    me?.settings.urgentDays ?? DEFAULT_SETTINGS.expiry.urgentDays;
  const nearDays = me?.settings.nearDays ?? DEFAULT_SETTINGS.expiry.nearDays;
  const skew = me ? clockSkewMs(me.serverTime, dataUpdatedAt) : 0;
  const today = todayInZone(new Date(clock + skew), timezone);

  return useMemo(
    () => ({ name, nearDays, timezone, today, urgentDays }),
    [name, nearDays, timezone, today, urgentDays]
  );
}
