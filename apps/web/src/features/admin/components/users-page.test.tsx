import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { created, failure, page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { makeUser } from "../test-data";
import { UsersPage } from "./users-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const SELF = makeUser({
  displayName: "Test System Administrator",
  id: "user-admin",
  role: "admin",
  username: "admin",
});
const MARIA = makeUser();
const OTHER_ADMIN = makeUser({
  disabled: true,
  disabledAt: "2026-11-01T00:00:00.000Z",
  displayName: "Old Admin",
  id: "user-old",
  lastLoginAt: null,
  mustChangePassword: true,
  role: "admin",
  username: "oldadmin",
});

function renderPage(extra: Record<string, () => unknown> = {}) {
  return renderWithProviders(<UsersPage />, {
    handlers: {
      "GET /api/users": () => page([SELF, MARIA, OTHER_ADMIN]),
      ...extra,
    },
    me: makeMe("admin"),
  });
}

describe("UsersPage", () => {
  it("lists accounts with role label, status, last login and a You marker", async () => {
    await renderPage();
    const table = await screen.findByRole("table", { name: "User accounts" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);

    const self = within(rows[1]);
    expect(self.getByText("You")).toBeInTheDocument();
    expect(self.getByText("System Administrator")).toBeInTheDocument();
    // The signed-in admin can't disable or reset themselves from this list.
    expect(self.queryByRole("button", { name: /^Disable/ })).toBeNull();

    const maria = within(rows[2]);
    expect(maria.getByText("Pharmacist")).toBeInTheDocument();
    expect(maria.getByText("Active")).toBeInTheDocument();
    expect(maria.getByText("11 Nov 2026, 09:30")).toBeInTheDocument();

    const old = within(rows[3]);
    expect(old.getByText("Disabled")).toBeInTheDocument();
    expect(old.getByText("Never")).toBeInTheDocument();
    expect(old.getByText("Must change password")).toBeInTheDocument();
    expect(old.getByRole("button", { name: "Enable Old Admin" })).toBeVisible();
  });

  it("sends the search, role and status filters to the server", async () => {
    const { api } = await renderPage();
    await screen.findByRole("table", { name: "User accounts" });

    await userEvent.type(screen.getByLabelText("Search users"), "mar");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "pharmacist");
    await userEvent.selectOptions(screen.getByLabelText("Status"), "active");

    await waitFor(() => {
      const last = api.callsTo("GET /api/users").at(-1);
      expect(last?.query).toMatchObject({
        limit: "200",
        q: "mar",
        role: "pharmacist",
        status: "active",
      });
    });
  });

  it("creates a user and shows the temporary password once", async () => {
    const user = userEvent.setup();
    const newUser = makeUser({
      displayName: "Nina Cruz",
      id: "user-nina",
      mustChangePassword: true,
      role: "nurse",
      username: "nina.cruz",
    });
    const { api } = await renderPage({
      "POST /api/users": () =>
        created({ temporaryPassword: "Tmp-Pass-4821", user: newUser }),
    });
    await screen.findByRole("table", { name: "User accounts" });

    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = await screen.findByRole("dialog", { name: "Add user" });
    expect(
      within(dialog).getByText(/3–40 letters, digits, dots/)
    ).toBeInTheDocument();

    // Nothing is flagged while typing …
    await user.type(within(dialog).getByLabelText("Username"), "n!");
    expect(within(dialog).queryByText(/Use 3–40/)).toBeNull();
    // … only after submitting.
    await user.click(
      within(dialog).getByRole("button", { name: "Create user" })
    );
    expect(
      await within(dialog).findByText(/Use 3–40 letters, digits/)
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    expect(api.callsTo("POST /api/users")).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText("Username"));
    await user.type(within(dialog).getByLabelText("Username"), "nina.cruz");
    await user.type(within(dialog).getByLabelText("Display name"), "Nina Cruz");
    await user.selectOptions(within(dialog).getByLabelText("Role"), "nurse");
    expect(
      within(dialog).getByText(/Checks available and prioritised supplies/)
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Create user" })
    );

    const passwordDialog = await screen.findByRole("dialog", {
      name: "Account created",
    });
    expect(api.callsTo("POST /api/users")[0].body).toEqual({
      displayName: "Nina Cruz",
      role: "nurse",
      username: "nina.cruz",
    });
    expect(
      within(passwordDialog).getByLabelText("Temporary password")
    ).toHaveTextContent("Tmp-Pass-4821");
    expect(
      within(passwordDialog).getByText(/shown only once/)
    ).toBeInTheDocument();

    await user.click(
      within(passwordDialog).getByRole("button", { name: "Copy" })
    );
    expect(await navigator.clipboard.readText()).toBe("Tmp-Pass-4821");

    await user.click(
      within(passwordDialog).getByRole("button", { name: /close/ })
    );
    await waitFor(() => expect(screen.queryByText("Tmp-Pass-4821")).toBeNull());
  });

  it("puts a taken username on the username field", async () => {
    const user = userEvent.setup();
    await renderPage({
      "POST /api/users": () =>
        failure(409, "conflict", "That username is already taken.", {
          field: "username",
        }),
    });
    await screen.findByRole("table", { name: "User accounts" });
    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = await screen.findByRole("dialog", { name: "Add user" });
    await user.type(within(dialog).getByLabelText("Username"), "maria");
    await user.type(within(dialog).getByLabelText("Display name"), "Maria 2");
    await user.click(
      within(dialog).getByRole("button", { name: "Create user" })
    );
    const field = within(dialog).getByLabelText("Username");
    expect(
      await within(dialog).findByText("That username is already taken.")
    ).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("edits only what changed", async () => {
    const user = userEvent.setup();
    const { api } = await renderPage({
      "PATCH /api/users/:id": () => ({ ...MARIA, role: "nurse" }),
    });
    await screen.findByRole("table", { name: "User accounts" });
    await user.click(screen.getByRole("button", { name: "Edit Maria Santos" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit user" });
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Role"), "nurse");
    await user.click(save);
    await waitFor(() =>
      expect(api.callsTo("PATCH /api/users/:id")).toHaveLength(1)
    );
    expect(api.callsTo("PATCH /api/users/:id")[0].body).toEqual({
      role: "nurse",
    });
    expect(api.callsTo("PATCH /api/users/:id")[0].params.id).toBe("user-maria");
  });

  it("shows the server's refusal when disabling fails, and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const { api } = await renderPage({
      "POST /api/users/:id/disable": () =>
        failure(
          409,
          "conflict",
          "You can't disable the last active administrator."
        ),
    });
    await screen.findByRole("table", { name: "User accounts" });
    await user.click(
      screen.getByRole("button", { name: "Disable Maria Santos" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Disable maria?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Disable account" })
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You can't disable the last active administrator."
    );
    expect(api.callsTo("POST /api/users/:id/disable")).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "Disable maria?" })
    ).toBeVisible();
  });

  it("resets a password after confirmation and shows the new one once", async () => {
    const user = userEvent.setup();
    await renderPage({
      "POST /api/users/:id/reset-password": () => ({
        temporaryPassword: "Reset-Pass-77",
        user: MARIA,
      }),
    });
    await screen.findByRole("table", { name: "User accounts" });
    await user.click(
      screen.getByRole("button", { name: "Reset password for Maria Santos" })
    );
    const confirm = await screen.findByRole("dialog", {
      name: "Reset password for maria?",
    });
    await user.click(
      within(confirm).getByRole("button", { name: "Reset password" })
    );
    const shown = await screen.findByRole("dialog", { name: "Password reset" });
    expect(
      within(shown).getByLabelText("Temporary password")
    ).toHaveTextContent("Reset-Pass-77");
  });
});
