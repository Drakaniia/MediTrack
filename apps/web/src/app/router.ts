import type { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { RoutePending } from "@/components/route-fallbacks";
import { installSessionRedirects } from "@/lib/api/session-redirects";
import { redirectSearch } from "@/lib/auth/redirect";
import { routeTree } from "@/routeTree.gen";

/** The app's router: file-route tree, `queryClient` in the route context, hover preloading, scroll restoration. */
export function createAppRouter(queryClient: QueryClient) {
  const router = createRouter({
    context: { queryClient },
    defaultPendingComponent: RoutePending,
    defaultPreload: "intent",
    routeTree,
    scrollRestoration: true,
  });

  // The API client's 401 / password_change_required handling needs to navigate.
  installSessionRedirects(queryClient, {
    getLocation: () => {
      const { href, pathname } = router.state.location;
      return { href, pathname };
    },
    goToChangePassword: (redirectTo) =>
      router.navigate({
        search: redirectSearch(redirectTo),
        to: "/change-password",
      }),
    goToLogin: (redirectTo) =>
      router.navigate({ search: redirectSearch(redirectTo), to: "/login" }),
  });

  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
