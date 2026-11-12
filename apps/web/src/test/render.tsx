import { todayInZone } from "@shared/dates";
import { permissionsFor } from "@shared/permissions";
import { ROLE_LABELS, type Role } from "@shared/roles";
import type { MeResponse, SessionUser } from "@shared/session";
import {
  DEFAULT_SETTINGS,
  type PublicSettings,
  toPublicSettings,
} from "@shared/settings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { DensityProvider } from "@/hooks/use-density";
import { ME_QUERY_KEY } from "@/lib/auth/queries";

import { type MockApi, type MockHandlers, mockApi } from "./mock-api";

export interface MakeMeOptions {
  settings?: Partial<PublicSettings>;
  user?: Partial<SessionUser>;
}

/** A `/auth/me` payload for `role`, with the permissions the real matrix gives it. */
export function makeMe(
  role: Role = "admin",
  options: MakeMeOptions = {}
): MeResponse {
  const now = new Date();
  const settings: PublicSettings = {
    ...toPublicSettings(DEFAULT_SETTINGS),
    ...options.settings,
  };
  return {
    permissions: permissionsFor(role),
    serverTime: now.toISOString(),
    settings,
    today: todayInZone(now, settings.timezone),
    user: {
      displayName: `Test ${ROLE_LABELS[role]}`,
      email: null,
      id: `user-${role}`,
      mustChangePassword: false,
      role,
      username: role,
      ...options.user,
    },
  };
}

export interface RenderOptions {
  /** `fetch` handlers (see `mock-api.ts`). `GET /api/auth/me` is answered for you when `me` is set. */
  handlers?: MockHandlers;
  /** The signed-in user, pre-loaded into the cache. Default: an admin. `null` = signed out. */
  me?: MeResponse | null;
  /** Reuse a client (e.g. to inspect its cache). */
  queryClient?: QueryClient;
  /** Initial URL, default `/`. */
  route?: string;
}

export interface RenderWithProvidersResult extends RenderResult {
  api: MockApi;
  queryClient: QueryClient;
  router: ReturnType<typeof buildRouter>;
}

function buildRouter(
  ui: ReactElement,
  queryClient: QueryClient,
  route: string
) {
  const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: () => (
      <ThemeProvider>
        <DensityProvider>{ui}</DensityProvider>
      </ThemeProvider>
    ),
  });
  // Every path matches something, so `ui` always renders and `<Link>`s resolve.
  const index = createRoute({
    component: () => null,
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const splat = createRoute({
    component: () => null,
    getParentRoute: () => rootRoute,
    path: "$",
  });
  return createRouter({
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [route] }),
    routeTree: rootRoute.addChildren([index, splat]),
  });
}

/**
 * Renders `ui` the way the app does: a QueryClient (no retries), the signed-in
 * user in the cache, a memory router (so `<Link>`, `useNavigate`, `useRouter`
 * work; `router.state.location.pathname` tells where navigation went), theme
 * and density providers, and a stubbed `fetch`.
 *
 *   const { api, router } = await renderWithProviders(<Page />, {
 *     me: makeMe("nurse"),
 *     route: "/inventory",
 *     handlers: { "GET /api/items": () => [] },
 *   });
 */
export async function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {}
): Promise<RenderWithProvidersResult> {
  const me = options.me === undefined ? makeMe("admin") : options.me;
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
      },
    });

  if (me) {
    queryClient.setQueryData(ME_QUERY_KEY, me);
  }
  const api = mockApi({
    ...(me ? { "GET /api/auth/me": () => me } : {}),
    ...options.handlers,
  });

  const router = buildRouter(ui, queryClient, options.route ?? "/");
  await router.load();

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { ...result, api, queryClient, router };
}
