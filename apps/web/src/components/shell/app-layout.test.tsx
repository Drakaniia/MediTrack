import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { alertsPage, makeBanner } from "@/features/alerts/test-data";
import {
  makeMe,
  type RenderOptions,
  renderWithProviders as renderBare,
} from "@/test/render";

import { AppLayout } from "./app-layout";


/** The bell, the banner and the item pickers fetch on mount; answer them quietly. */
function renderWithProviders(ui: Parameters<typeof renderBare>[0], options: RenderOptions = {}) {
  return renderBare(ui, {
    ...options,
    handlers: {
      "GET /api/alerts": () => alertsPage([], { unread: 0 }),
      "GET /api/alerts/banner": () => makeBanner(),
      "GET /api/items": () => [],
      ...options.handlers,
    },
  });
}

function mainNav() {
  return screen.getAllByRole("navigation", { name: "Main" })[0] as HTMLElement;
}

describe("AppLayout", () => {
  it("renders the page in <main> with the facility name in the header", async () => {
    await renderWithProviders(
      <AppLayout>
        <p>Page body</p>
      </AppLayout>,
      {
        me: makeMe("pharmacist", {
          settings: { facilityName: "Rizal Clinic" },
        }),
      }
    );

    expect(
      within(screen.getByRole("main")).getByText("Page body")
    ).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Rizal Clinic");
    expect(
      screen.getByRole("link", { name: "Skip to content" })
    ).toHaveAttribute("href", "#main-content");
  });

  it("lists only the destinations the role may open", async () => {
    await renderWithProviders(<AppLayout>x</AppLayout>, {
      me: makeMe("nurse"),
    });

    const nav = within(mainNav());
    expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/"
    );
    expect(nav.getByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(
      nav.queryByRole("link", { name: "Audit log" })
    ).not.toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("marks the current page", async () => {
    await renderWithProviders(<AppLayout>x</AppLayout>, {
      me: makeMe("admin"),
      route: "/inventory/add",
    });

    const nav = within(mainNav());
    expect(nav.getByRole("link", { name: "Add stock" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(nav.getByRole("link", { name: "Inventory" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("gates New request and Quick deduct by permission", async () => {
    const { unmount } = await renderWithProviders(<AppLayout>x</AppLayout>, {
      me: makeMe("nurse"),
    });
    expect(
      screen.getByRole("button", { name: "New request" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Quick deduct" })
    ).toBeInTheDocument();
    unmount();

    await renderWithProviders(<AppLayout>x</AppLayout>, {
      me: makeMe("health_admin"),
    });
    expect(
      screen.queryByRole("button", { name: "New request" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Quick deduct" })
    ).not.toBeInTheDocument();
  });

  it("opens New request, Quick deduct and the palette from their shortcuts", async () => {
    await renderWithProviders(<AppLayout>x</AppLayout>, {
      me: makeMe("nurse"),
    });

    await userEvent.keyboard("{Control>}n{/Control}");
    expect(
      await screen.findByRole("dialog", { name: "New request" })
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.keyboard("{Control>}d{/Control}");
    expect(
      await screen.findByRole("dialog", { name: "Quick deduct" })
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.keyboard("{Control>}k{/Control}");
    expect(
      await screen.findByRole("dialog", { name: "Command palette" })
    ).toBeInTheDocument();
  });

  it("does not react to Ctrl+N for a role that cannot create requests", async () => {
    await renderWithProviders(<AppLayout>x</AppLayout>, {
      me: makeMe("health_admin"),
    });

    await userEvent.keyboard("{Control>}n{/Control}");

    expect(
      screen.queryByRole("dialog", { name: "New request" })
    ).not.toBeInTheDocument();
  });

  it("links to the docs from the header", async () => {
    await renderWithProviders(<AppLayout>x</AppLayout>);
    expect(
      screen.getByRole("link", { name: "Help and documentation" })
    ).toHaveAttribute("href", "/docs");
  });

  it("opens the navigation drawer on a phone and closes it with Escape", async () => {
    await renderWithProviders(<AppLayout>x</AppLayout>, {
      me: makeMe("nurse"),
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" })
    );

    const drawer = await screen.findByRole("dialog", {
      name: "Navigation menu",
    });
    expect(
      within(drawer).getByRole("link", { name: "Requests" })
    ).toBeInTheDocument();
    expect(drawer).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("closes the drawer after choosing a destination", async () => {
    const { router } = await renderWithProviders(<AppLayout>x</AppLayout>, {
      me: makeMe("nurse"),
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" })
    );
    const drawer = await screen.findByRole("dialog", {
      name: "Navigation menu",
    });

    await userEvent.click(
      within(drawer).getByRole("link", { name: "Requests" })
    );

    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(router.state.location.pathname).toBe("/requests");
  });

  it("collapses the sidebar to an icon rail and remembers it", async () => {
    await renderWithProviders(<AppLayout>x</AppLayout>);

    await userEvent.click(
      screen.getByRole("button", { name: "Collapse sidebar" })
    );

    expect(
      screen.getByRole("button", { name: "Expand sidebar" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("meditract:sidebar-collapsed")).toBe("true");
    // Labels stay available to screen readers.
    expect(
      within(mainNav()).getByRole("link", { name: "Dashboard" })
    ).toBeInTheDocument();
  });
});
