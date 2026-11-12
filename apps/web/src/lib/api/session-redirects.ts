import type { QueryClient } from "@tanstack/react-query";

import { redirectSearch } from "@/lib/auth/redirect";

import { setApiClientHooks } from "./client";

/**
 * The API client's global session handling (ARCHITECTURE §3):
 *
 *  - 401 `unauthenticated`        → forget the session and go to
 *                                   /login?redirect=<where the user was>
 *  - 403 `password_change_required` → go to /change-password
 *
 * Several queries usually fail together when a session expires, so each
 * redirect is issued ONCE, and never from the auth pages themselves.
 */

export interface SessionLocation {
  /** Path + search + hash. */
  href: string;
  pathname: string;
}

export interface SessionNavigator {
  /** The location being navigated to (or the current one when idle). */
  getLocation: () => SessionLocation;
  goToChangePassword: (redirectTo?: string) => Promise<void> | void;
  goToLogin: (redirectTo?: string) => Promise<void> | void;
}

const AUTH_PATHS: ReadonlySet<string> = new Set(["/login", "/change-password"]);

/** Wires the API client's hooks to `navigator`. Call once at startup. */
export function installSessionRedirects(
  queryClient: QueryClient,
  navigator: SessionNavigator
): void {
  let loginRedirectPending = false;
  let passwordRedirectPending = false;

  const handleUnauthenticated = (): void => {
    const location = navigator.getLocation();
    if (loginRedirectPending || AUTH_PATHS.has(location.pathname)) {
      return;
    }
    loginRedirectPending = true;
    const finish = (): void => {
      loginRedirectPending = false;
      // Navigate first, then drop the expired session's data: clearing first
      // would make the still-mounted pages refetch and 401 all over again.
      queryClient.removeQueries();
    };
    Promise.resolve(navigator.goToLogin(location.href)).then(finish, finish);
  };

  const handlePasswordChangeRequired = (): void => {
    const location = navigator.getLocation();
    if (passwordRedirectPending || AUTH_PATHS.has(location.pathname)) {
      return;
    }
    passwordRedirectPending = true;
    const finish = (): void => {
      passwordRedirectPending = false;
    };
    Promise.resolve(navigator.goToChangePassword(location.href)).then(
      finish,
      finish
    );
  };

  setApiClientHooks({
    onPasswordChangeRequired: handlePasswordChangeRequired,
    onUnauthenticated: handleUnauthenticated,
  });
}

/** The `search` for a login/change-password redirect that should return to `href`. */
export function searchFor(href: string | undefined): { redirect?: string } {
  return redirectSearch(href);
}
