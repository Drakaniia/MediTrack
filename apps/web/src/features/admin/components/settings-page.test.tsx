import type { MeResponse } from "@shared/session";
import type { AppSettings, SettingsPatch } from "@shared/settings";
import { mergeSettings } from "@shared/settings";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure, type MockRequest } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { makeSettings } from "../test-data";
import { SettingsPage } from "./settings-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function adminHandlers(
  settings: AppSettings = makeSettings(),
  extra: Record<string, (request: MockRequest) => unknown> = {}
) {
  let current = settings;
  return {
    "GET /api/alerts/run/status": () => [],
    "GET /api/settings": () => current,
    "PUT /api/settings": (request: MockRequest) => {
      current = mergeSettings(current, request.body as SettingsPatch);
      return current;
    },
    ...extra,
  };
}

function renderAdmin(
  settings?: AppSettings,
  extra: Record<string, (request: MockRequest) => unknown> = {}
) {
  return renderWithProviders(<SettingsPage />, {
    handlers: adminHandlers(settings, extra),
    me: makeMe("admin"),
  });
}

function tabNames(): string[] {
  return screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
}

describe("SettingsPage tabs", () => {
  it("gives an administrator General, Expiry thresholds, Alerts and Account", async () => {
    await renderAdmin();
    expect(await screen.findByLabelText("Facility name")).toBeInTheDocument();
    expect(tabNames()).toEqual([
      "General",
      "Expiry thresholds",
      "Alerts",
      "Account",
    ]);
  });

  it("gives everyone else a read-only summary and never calls /settings", async () => {
    const { api } = await renderWithProviders(<SettingsPage />, {
      me: makeMe("nurse", {
        settings: {
          facilityName: "Rural Health Unit 4",
          nearDays: 45,
          urgentDays: 10,
        },
      }),
    });
    expect(tabNames()).toEqual(["General", "Expiry thresholds", "Account"]);
    expect(await screen.findByText("Rural Health Unit 4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByLabelText("Facility name")).toBeNull();

    await userEvent.click(
      screen.getByRole("tab", { name: "Expiry thresholds" })
    );
    expect(
      await screen.findByText(
        /Urgent: 10 days or fewer. Near Expiry: 45 days or fewer./
      )
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Urgent days")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Account" }));
    expect(
      await screen.findByLabelText("Current password")
    ).toBeInTheDocument();
    expect(api.calls.some((call) => call.path === "/api/settings")).toBe(false);
  });

  it("moves between tabs with the arrow keys", async () => {
    await renderAdmin();
    await screen.findByLabelText("Facility name");
    screen.getByRole("tab", { name: "General" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(
      await screen.findByRole("tab", {
        name: "Expiry thresholds",
        selected: true,
      })
    ).toHaveFocus();
  });

  it("asks before dropping unsaved edits when switching tabs", async () => {
    const user = userEvent.setup();
    await renderAdmin();
    const name = await screen.findByLabelText("Facility name");
    await user.clear(name);
    await user.type(name, "Clinic X");

    await user.click(screen.getByRole("tab", { name: "Expiry thresholds" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Keep editing" })
    );
    expect(screen.getByLabelText("Facility name")).toHaveValue("Clinic X");

    await user.click(screen.getByRole("tab", { name: "Expiry thresholds" }));
    await user.click(
      await screen.findByRole("button", { name: "Discard changes" })
    );
    expect(await screen.findByLabelText("Urgent days")).toBeInTheDocument();
  });
});

describe("General tab", () => {
  it("saves only the facility name and refreshes /auth/me", async () => {
    const user = userEvent.setup();
    const { api, queryClient } = await renderAdmin(undefined, {
      "GET /api/auth/me": () =>
        makeMe("admin", { settings: { facilityName: "Clinic X" } }),
    });
    const name = await screen.findByLabelText("Facility name");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.clear(name);
    await user.type(name, "Clinic X");
    expect(save).toBeEnabled();
    const meCallsBefore = api.callsTo("GET /api/auth/me").length;
    await user.click(save);

    await waitFor(() =>
      expect(api.callsTo("PUT /api/settings")).toHaveLength(1)
    );
    expect(api.callsTo("PUT /api/settings")[0].body).toEqual({
      facility: { name: "Clinic X" },
    });
    await waitFor(() =>
      expect(api.callsTo("GET /api/auth/me").length).toBeGreaterThan(
        meCallsBefore
      )
    );
    await waitFor(() => expect(save).toBeDisabled());
    // The header and the tab title read the facility name from this cache entry.
    expect(
      queryClient.getQueryData<MeResponse>(["auth", "me"])?.settings
        .facilityName
    ).toBe("Clinic X");
  });

  it("flags an empty name after submit, without calling the server", async () => {
    const user = userEvent.setup();
    const { api } = await renderAdmin();
    const name = await screen.findByLabelText("Facility name");
    await user.clear(name);
    expect(screen.queryByText("Enter the facility name.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Enter the facility name.")
    ).toBeInTheDocument();
    expect(api.callsTo("PUT /api/settings")).toHaveLength(0);
  });

  it("puts a server validation issue on its field", async () => {
    const user = userEvent.setup();
    await renderAdmin(undefined, {
      "PUT /api/settings": () =>
        failure(400, "validation_error", "Invalid", {
          issues: [
            { message: "Too long for a title.", path: ["facility", "name"] },
          ],
        }),
    });
    const name = await screen.findByLabelText("Facility name");
    await user.type(name, " annex");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Too long for a title.")
    ).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
  });

  it("searches timezones and shows the local time there", async () => {
    const user = userEvent.setup();
    const { api } = await renderAdmin();
    const search = await screen.findByLabelText("Timezone");
    const list = screen.getByRole("listbox", { name: "Timezones" });

    await user.type(search, "new york");
    const options = within(list).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toContain(
      "America/New_York"
    );
    expect(
      within(list).queryByRole("option", { name: "Asia/Manila" })
    ).toBeNull();

    await user.clear(search);
    await user.type(search, "tokyo");
    await user.selectOptions(list, "Asia/Tokyo");
    expect(await screen.findByText(/UTC\+09:00 there now/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(api.callsTo("PUT /api/settings")).toHaveLength(1)
    );
    expect(api.callsTo("PUT /api/settings")[0].body).toEqual({
      facility: { timezone: "Asia/Tokyo" },
    });
  });

  it("keeps device preferences on this device (no request)", async () => {
    const user = userEvent.setup();
    const { api } = await renderAdmin();
    await screen.findByLabelText("Facility name");
    await user.click(screen.getByRole("radio", { name: "Compact density" }));
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(api.callsTo("PUT /api/settings")).toHaveLength(0);
  });
});

describe("Expiry thresholds tab", () => {
  async function openThresholds() {
    const user = userEvent.setup();
    const rendered = await renderAdmin();
    await screen.findByLabelText("Facility name");
    await user.click(screen.getByRole("tab", { name: "Expiry thresholds" }));
    await screen.findByLabelText("Urgent days");
    return { ...rendered, user };
  }

  it("validates live and blocks saving until urgent < near", async () => {
    const { user } = await openThresholds();
    const urgent = screen.getByLabelText("Urgent days");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(urgent).toHaveValue(7);
    expect(screen.getByLabelText("Near Expiry days")).toHaveValue(30);

    await user.clear(urgent);
    await user.type(urgent, "40");
    expect(
      await screen.findByText(
        "Urgent days must be fewer than Near Expiry days."
      )
    ).toBeInTheDocument();
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("Near Expiry days")).toHaveAttribute(
      "aria-invalid",
      "true"
    );

    await user.clear(urgent);
    await user.type(urgent, "-2");
    expect(
      await screen.findByText("Urgent days cannot be negative.")
    ).toBeInTheDocument();
    expect(urgent).toHaveAttribute("aria-invalid", "true");
    expect(save).toBeDisabled();
  });

  it("previews the classes and saves only what changed", async () => {
    const { api, container, user } = await openThresholds();
    const urgent = screen.getByLabelText("Urgent days");
    await user.clear(urgent);
    await user.type(urgent, "10");

    const strip = screen.getByRole("list", {
      name: "How batches will be classified",
    });
    expect(strip.querySelectorAll('[data-expiry-class="urgent"]')).toHaveLength(
      2
    );
    expect(
      strip.querySelectorAll('[data-expiry-class="expired"]')
    ).toHaveLength(1);
    expect(container.textContent).toContain("dashboard, the expiry list");

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(api.callsTo("PUT /api/settings")).toHaveLength(1)
    );
    expect(api.callsTo("PUT /api/settings")[0].body).toEqual({
      expiry: { urgentDays: 10 },
    });
  });
});
