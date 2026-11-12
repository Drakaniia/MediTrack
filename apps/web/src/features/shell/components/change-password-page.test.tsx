import { MIN_PASSWORD_LENGTH } from "@shared/session";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import {
  ChangePasswordPage,
  validatePasswordForm,
} from "./change-password-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

const GOOD_PASSWORD = "a-much-longer-password";

async function fill(current: string, next: string, confirm = next) {
  await userEvent.type(screen.getByLabelText("Current password"), current);
  await userEvent.type(screen.getByLabelText("New password"), next);
  await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
}

function submit() {
  return userEvent.click(
    screen.getByRole("button", { name: "Change password" })
  );
}

describe("validatePasswordForm", () => {
  it("accepts a valid form", () => {
    expect(
      validatePasswordForm({
        confirmPassword: GOOD_PASSWORD,
        currentPassword: "old-password",
        newPassword: GOOD_PASSWORD,
      })
    ).toEqual({});
  });

  it("flags every problem at once", () => {
    const errors = validatePasswordForm({
      confirmPassword: "different",
      currentPassword: "",
      newPassword: "short",
    });
    expect(Object.keys(errors).sort()).toEqual([
      "confirmPassword",
      "currentPassword",
      "newPassword",
    ]);
  });

  it("rejects reusing the current password", () => {
    expect(
      validatePasswordForm({
        confirmPassword: GOOD_PASSWORD,
        currentPassword: GOOD_PASSWORD,
        newPassword: GOOD_PASSWORD,
      }).newPassword
    ).toMatch(/haven't used/);
  });
});

describe("ChangePasswordPage", () => {
  it("labels the three fields and shows the minimum length up front", async () => {
    await renderWithProviders(<ChangePasswordPage />, {
      me: makeMe("nurse"),
      route: "/change-password",
    });

    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      `At least ${MIN_PASSWORD_LENGTH} characters.`
    );
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("shows errors only after submit", async () => {
    const { api } = await renderWithProviders(<ChangePasswordPage />, {
      me: makeMe("nurse"),
      route: "/change-password",
    });

    await userEvent.type(screen.getByLabelText("New password"), "short");
    expect(screen.queryByText(/Use at least/)).not.toBeInTheDocument();

    await submit();

    expect(
      screen.getByText("Enter your current password.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    ).toBeInTheDocument();
    expect(screen.getByText("The passwords don't match.")).toBeInTheDocument();
    expect(api.callsTo("POST /api/auth/change-password")).toHaveLength(0);
  });

  it("changes the password and returns to the requested page", async () => {
    const { api, router } = await renderWithProviders(
      <ChangePasswordPage redirectTo="/requests" />,
      {
        handlers: { "POST /api/auth/change-password": () => makeMe("nurse") },
        me: makeMe("nurse", { user: { mustChangePassword: true } }),
        route: "/change-password",
      }
    );

    await fill("old-password-1", GOOD_PASSWORD);
    await submit();

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/requests")
    );
    expect(api.callsTo("POST /api/auth/change-password")[0]?.body).toEqual({
      currentPassword: "old-password-1",
      newPassword: GOOD_PASSWORD,
    });
  });

  it("explains a wrong current password on that field", async () => {
    await renderWithProviders(<ChangePasswordPage />, {
      handlers: {
        "POST /api/auth/change-password": () =>
          failure(401, "invalid_credentials", "Wrong password"),
      },
      me: makeMe("nurse"),
      route: "/change-password",
    });

    await fill("not-my-password", GOOD_PASSWORD);
    await submit();

    expect(
      await screen.findByText("Your current password is incorrect.")
    ).toBeInTheDocument();
  });

  it("shows the server's validation message under the new password", async () => {
    await renderWithProviders(<ChangePasswordPage />, {
      handlers: {
        "POST /api/auth/change-password": () =>
          failure(400, "validation_error", "Invalid", {
            issues: [
              {
                message: "That password is too common.",
                path: ["newPassword"],
              },
            ],
          }),
      },
      me: makeMe("nurse"),
      route: "/change-password",
    });

    await fill("old-password-1", GOOD_PASSWORD);
    await submit();

    expect(
      await screen.findByText("That password is too common.")
    ).toBeInTheDocument();
  });

  it("offers log out instead of cancel when the change is mandatory", async () => {
    await renderWithProviders(<ChangePasswordPage />, {
      me: makeMe("nurse", { user: { mustChangePassword: true } }),
      route: "/change-password",
    });
    expect(
      screen.getByRole("button", { name: "Log out instead" })
    ).toBeInTheDocument();
    expect(screen.getByText(/before you continue/)).toBeInTheDocument();
  });
});
