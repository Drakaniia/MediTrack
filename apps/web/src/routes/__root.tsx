import { Toaster } from "@cmis/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { type ReactElement, useEffect } from "react";
import { toast } from "sonner";

import {
  RouteError,
  RouteNotFound,
  RoutePending,
} from "@/components/route-fallbacks";
import { AppLayout } from "@/components/shell/app-layout";
import { ThemeProvider } from "@/components/theme-provider";
import { DensityProvider } from "@/hooks/use-density";
import { useFacility } from "@/lib/auth/guards";
import { documentTitleFor } from "@/lib/document-title";
import { setFlashHandler } from "@/lib/flash";

export interface RouterContext {
  queryClient: QueryClient;
}

/** Pages that render without the sidebar and header (nobody is signed in yet). */
const BARE_PATHS: ReadonlySet<string> = new Set(["/login", "/change-password"]);

function RootComponent(): ReactElement {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const facility = useFacility();

  useEffect(() => {
    document.title = documentTitleFor(pathname, facility.name);
  }, [facility.name, pathname]);

  // Guards run before the Toaster exists; their messages are queued in `flash.ts`.
  useEffect(() => {
    setFlashHandler((message) => {
      toast.error(message);
    });
    return () => setFlashHandler(null);
  }, []);

  return (
    <ThemeProvider>
      <DensityProvider>
        {BARE_PATHS.has(pathname) ? (
          <Outlet />
        ) : (
          <AppLayout>
            <Outlet />
          </AppLayout>
        )}
        <Toaster position="bottom-right" richColors />
      </DensityProvider>
    </ThemeProvider>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
  pendingComponent: RoutePending,
});
