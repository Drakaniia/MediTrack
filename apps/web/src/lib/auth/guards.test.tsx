import type { MeResponse } from "@shared/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { act, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Can } from "@/components/can";
import { setFlashHandler } from "@/lib/flash";
import { failure, mockApi } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { guardFor, requirePermission, useCan, useFacility } from "./guards";
import { ME_QUERY_KEY } from "./queries";

function clientWith(me: MeResponse | null): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (me) {
    queryClient.setQueryData(ME_QUERY_KEY, me);
  }
  return queryClient;
}

async function redirectOf(promise: Promise<unknown>) {
  const thrown = await promise.then(
    () => null,
    (error: unknown) => error
  );
  if (!isRedirect(thrown)) {
    throw new Error("expected the guard to redirect");
  }
  return thrown.options;
}

afterEach(() => {
  setFlashHandler(null);
  vi.useRealTimers();
});

describe("requirePermission", () => {
  it("lets a role with the permission through", async () => {
    const queryClient = clientWith(makeMe("pharmacist"));
    await expect(
      requirePermission({ queryClient }, "requests.process")
    ).resolves.toBeUndefined();
  });

  it('lets any signed-in user through for "authenticated"', async () => {
    const queryClient = clientWith(makeMe("nurse"));
    await expect(
      requirePermission({ queryClient }, "authenticated")
    ).resolves.toBeUndefined();
  });

  it("sends an anonymous visitor to /login with ?redirect= set to where they were going", async () => {
    mockApi({
      "GET /api/auth/me": () => failure(401, "unauthenticated", "Sign in"),
    });
    const queryClient = clientWith(null);

    const options = await redirectOf(
      requirePermission({ queryClient }, "inventory.view", {
        location: { href: "/inventory?tab=expiry" },
      })
    );

    expect(options).toMatchObject({
      search: { redirect: "/inventory?tab=expiry" },
      to: "/login",
    });
  });

  it("omits ?redirect= when they were going home, and refuses unsafe targets", async () => {
    mockApi({
      "GET /api/auth/me": () => failure(401, "unauthenticated", "Sign in"),
    });

    const home = await redirectOf(
      requirePermission({ queryClient: clientWith(null) }, "authenticated", {
        location: { href: "/" },
      })
    );
    const evil = await redirectOf(
      requirePermission({ queryClient: clientWith(null) }, "authenticated", {
        location: { href: "//evil.example/x" },
      })
    );

    expect(home).toMatchObject({ search: {}, to: "/login" });
    expect(evil).toMatchObject({ search: {}, to: "/login" });
  });

  it("sends a user who must change their password to /change-password", async () => {
    const queryClient = clientWith(
      makeMe("nurse", { user: { mustChangePassword: true } })
    );

    const options = await redirectOf(
      requirePermission({ queryClient }, "inventory.view", {
        location: { href: "/inventory" },
      })
    );

    expect(options).toMatchObject({
      search: { redirect: "/inventory" },
      to: "/change-password",
    });
  });

  it("lets that user open /change-password itself", async () => {
    const queryClient = clientWith(
      makeMe("nurse", { user: { mustChangePassword: true } })
    );
    await expect(
      guardFor("authenticated", { allowPasswordChangePending: true })({
        context: { queryClient },
        location: { href: "/change-password" },
        preload: false,
      })
    ).resolves.toBeUndefined();
  });

  it("sends a forbidden role home with a toast", async () => {
    const flash = vi.fn();
    setFlashHandler(flash);
    const queryClient = clientWith(makeMe("nurse"));

    const options = await redirectOf(
      requirePermission({ queryClient }, "audit.view", {
        location: { href: "/audit" },
      })
    );

    expect(options).toMatchObject({ to: "/" });
    expect(flash).toHaveBeenCalledWith(expect.stringContaining("access"));
  });

  it("stays silent when the forbidden navigation is only a hover preload", async () => {
    const flash = vi.fn();
    setFlashHandler(flash);
    const queryClient = clientWith(makeMe("nurse"));

    await redirectOf(
      requirePermission({ queryClient }, "audit.view", { preload: true })
    );

    expect(flash).not.toHaveBeenCalled();
  });
});

describe("useCan / <Can>", () => {
  it("hides what the role cannot do and shows the fallback", async () => {
    await renderWithProviders(
      <>
        <Can fallback={<p>No audit</p>} permission="audit.view">
          <p>Audit log</p>
        </Can>
        <Can permission="requests.create">
          <p>New request</p>
        </Can>
      </>,
      { me: makeMe("nurse") }
    );

    expect(screen.getByText("No audit")).toBeInTheDocument();
    expect(screen.queryByText("Audit log")).not.toBeInTheDocument();
    expect(screen.getByText("New request")).toBeInTheDocument();
  });

  it("useCan is false for everything before sign-in", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={clientWith(null)}>
        {children}
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useCan("dashboard.view"), { wrapper });
    expect(result.current).toBe(false);
  });
});

describe("useFacility", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "clearInterval", "setInterval"] });
  });

  function facilityHook(me: MeResponse) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={clientWith(me)}>
        {children}
      </QueryClientProvider>
    );
    return renderHook(() => useFacility(), { wrapper });
  }

  it("returns the facility settings and today in the facility's zone", () => {
    vi.setSystemTime(new Date("2026-11-12T15:30:00.000Z"));
    const me = makeMe("admin", {
      settings: {
        facilityName: "Rizal Clinic",
        nearDays: 45,
        timezone: "Asia/Manila",
        urgentDays: 10,
      },
    });

    const { result } = facilityHook(me);

    expect(result.current).toEqual({
      name: "Rizal Clinic",
      nearDays: 45,
      timezone: "Asia/Manila",
      today: "2026-11-12",
      urgentDays: 10,
    });
  });

  it("uses the facility's timezone, not the browser's", () => {
    vi.setSystemTime(new Date("2026-11-12T23:30:00.000Z"));

    const east = facilityHook(
      makeMe("admin", { settings: { timezone: "Pacific/Kiritimati" } })
    );
    const west = facilityHook(
      makeMe("admin", { settings: { timezone: "Pacific/Pago_Pago" } })
    );

    expect(east.result.current.today).toBe("2026-11-13");
    expect(west.result.current.today).toBe("2026-11-12");
  });

  it("rolls today over at facility midnight without a reload (60 s ticker)", () => {
    vi.setSystemTime(new Date("2026-11-12T15:30:00.000Z")); // 23:30 in Manila
    const { result } = facilityHook(
      makeMe("admin", { settings: { timezone: "Asia/Manila" } })
    );
    expect(result.current.today).toBe("2026-11-12");

    act(() => {
      vi.advanceTimersByTime(31 * 60_000); // 00:01 in Manila
    });

    expect(result.current.today).toBe("2026-11-13");
  });
});
