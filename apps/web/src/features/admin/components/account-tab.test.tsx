import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { AccountTab } from "./account-tab";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function renderTab(
  handlers: Record<string, () => unknown> = {},
  role: Parameters<typeof makeMe>[0] = "nurse"
) {
  return renderWithProviders(<AccountTab />, {
    handlers,
    me: makeMe(role, { user: { displayName: "Nina Cruz", username: "nina" } }),
  });
}

async function fillPasswords(
  current: string,
  next: string,
  confirm: string
): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

describe("Account tab", () => {
  it("shows the display name read-only", async () => {
    await renderTab();
    expect(screen.getByText("Nina Cruz")).toBeInTheDocument();
    expect(screen.queryByLabelText("Display name")).toBeNull();
    expect(screen.getByText("Nurse / Healthcare Worker")).toBeInTheDocument();
  });

  it("checks the form only after submit", async () => {
    const user = userEvent.setup();
    const { api } = await renderTab();
    await user.type(screen.getByLabelText("New password"), "short");
    expect(screen.queryByText(/Use at least 10/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      await screen.findByText("Enter your current password.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Use at least 10 characters.", {
        selector: "p.text-destructive",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("The passwords don't match.")).toBeInTheDocument();
    expect(api.callsTo("POST /api/auth/change-password")).toHaveLength(0);
  });

  it("changes the password and clears the form", async () => {
    const { api } = await renderTab({
      "POST /api/auth/change-password": () => makeMe("nurse"),
    });
    await fillPasswords(
      "old-password-1",
      "brand-new-pass-2",
      "brand-new-pass-2"
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/auth/change-password")).toHaveLength(1)
    );
    expect(api.callsTo("POST /api/auth/change-password")[0].body).toEqual({
      currentPassword: "old-password-1",
      newPassword: "brand-new-pass-2",
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Current password")).toHaveValue("")
    );
  });

  it("puts a wrong current password on its field", async () => {
    await renderTab({
      "POST /api/auth/change-password": () =>
        failure(401, "invalid_credentials", "Wrong password"),
    });
    await fillPasswords(
      "wrong-password-1",
      "brand-new-pass-2",
      "brand-new-pass-2"
    );
    expect(
      await screen.findByText("Your current password is incorrect.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("logs out everywhere after confirmation", async () => {
    const user = userEvent.setup();
    const { api, router } = await renderTab({
      "POST /api/auth/logout-all": () => undefined,
    });
    await user.click(
      screen.getByRole("button", { name: "Log out everywhere" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Log out of all devices?",
    });
    expect(api.callsTo("POST /api/auth/logout-all")).toHaveLength(0);
    await user.click(
      within(dialog).getByRole("button", { name: "Log out everywhere" })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/auth/logout-all")).toHaveLength(1)
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });
});
