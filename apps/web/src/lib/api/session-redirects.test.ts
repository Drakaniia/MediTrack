import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { failure, mockApi } from "@/test/mock-api";

import { apiGet, setApiClientHooks } from "./client";
import {
  installSessionRedirects,
  type SessionNavigator,
} from "./session-redirects";

afterEach(() => {
  setApiClientHooks({});
});

function setup(pathname = "/inventory"): {
  navigator: SessionNavigator;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient();
  const navigator: SessionNavigator = {
    getLocation: () => ({ href: `${pathname}?tab=2`, pathname }),
    goToChangePassword: vi.fn(),
    goToLogin: vi.fn(),
  };
  installSessionRedirects(queryClient, navigator);
  return { navigator, queryClient };
}

describe("installSessionRedirects", () => {
  it("sends an expired session to /login once, however many requests fail", async () => {
    const { navigator, queryClient } = setup();
    queryClient.setQueryData(["inventory", "items"], [1]);
    mockApi({
      "GET /api/items": () => failure(401, "unauthenticated", "Sign in"),
    });

    await Promise.allSettled([apiGet("/items"), apiGet("/items")]);

    expect(navigator.goToLogin).toHaveBeenCalledTimes(1);
    expect(navigator.goToLogin).toHaveBeenCalledWith("/inventory?tab=2");
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(["inventory", "items"])).toBeUndefined()
    );
  });

  it("does nothing on the login page itself", async () => {
    const { navigator } = setup("/login");
    mockApi({
      "GET /api/items": () => failure(401, "unauthenticated", "Sign in"),
    });

    await expect(apiGet("/items")).rejects.toBeDefined();

    expect(navigator.goToLogin).not.toHaveBeenCalled();
  });

  it("sends password_change_required to /change-password", async () => {
    const { navigator } = setup();
    mockApi({
      "GET /api/items": () =>
        failure(403, "password_change_required", "Change it"),
    });

    await expect(apiGet("/items")).rejects.toBeDefined();

    expect(navigator.goToChangePassword).toHaveBeenCalledWith(
      "/inventory?tab=2"
    );
  });
});
