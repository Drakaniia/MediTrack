import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { UserMenu } from "./user-menu";

vi.mock(
  "@cmis/ui/components/dropdown-menu",
  () => import("@/test/dropdown-menu-shim")
);
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

describe("UserMenu", () => {
  it("shows the display name and role label", async () => {
    await renderWithProviders(<UserMenu />, {
      me: makeMe("pharmacist", { user: { displayName: "Dana Reyes" } }),
    });

    expect(
      screen.getByText("Dana Reyes", { selector: "span.block" })
    ).toBeInTheDocument();
    expect(screen.getByText("Pharmacist")).toBeInTheDocument();
  });

  it("logs out and returns to /login", async () => {
    const { api, queryClient, router } = await renderWithProviders(
      <UserMenu />,
      {
        handlers: { "POST /api/auth/logout": () => undefined },
        route: "/inventory",
      }
    );

    await userEvent.click(screen.getByRole("menuitem", { name: "Log out" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(api.callsTo("POST /api/auth/logout")).toHaveLength(1);
    await waitFor(() =>
      expect(queryClient.getQueryData(["auth", "me"])).toBeUndefined()
    );
  });

  it("can end every session", async () => {
    const { api } = await renderWithProviders(<UserMenu />, {
      handlers: { "POST /api/auth/logout-all": () => undefined },
    });

    await userEvent.click(
      screen.getByRole("menuitem", { name: "Log out everywhere" })
    );

    await waitFor(() =>
      expect(api.callsTo("POST /api/auth/logout-all")).toHaveLength(1)
    );
  });

  it("treats an already-expired session as logged out", async () => {
    const { router } = await renderWithProviders(<UserMenu />, {
      handlers: {
        "POST /api/auth/logout": () =>
          failure(401, "unauthenticated", "Sign in"),
      },
    });

    await userEvent.click(screen.getByRole("menuitem", { name: "Log out" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("opens the change-password page", async () => {
    const { router } = await renderWithProviders(<UserMenu />);

    await userEvent.click(
      screen.getByRole("menuitem", { name: "Change password" })
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/change-password")
    );
  });

  it("renders nothing before sign-in", async () => {
    await renderWithProviders(<UserMenu />, { me: null });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
