import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MockRequest } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { alertKeys } from "../hooks/alert-queries";
import { alertsPage, makeNotification } from "../test-data";
import { NotificationBell } from "./notification-bell";

vi.mock("@cmis/ui/components/popover", () => import("@/test/popover-shim"));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

const openItemDetail = vi.fn();
vi.mock("@/features/inventory/stock-item-detail-dialog-context", () => ({
  useStockItemDetailDialog: () => ({ openItemDetail }),
}));

function setup(initialUnread: number) {
  const state = { unread: initialUnread };
  const rows = [
    makeNotification({
      batchId: "batch-1",
      id: "n1",
      itemId: "item-1",
      severity: "critical",
      title: "Amoxicillin expired",
    }),
    makeNotification({ id: "n2", read: true, title: "Gauze low on stock" }),
  ];
  const handlers = {
    "GET /api/alerts": (request: { query: Record<string, string> }) =>
      request.query.unread === "1"
        ? alertsPage(rows.slice(0, 1), {
            total: state.unread,
            unread: state.unread,
          })
        : alertsPage(rows, { unread: state.unread }),
    "POST /api/alerts/:id/read": (request: MockRequest) => {
      state.unread = Math.max(0, state.unread - 1);
      return makeNotification({ id: request.params.id, read: true });
    },
    "POST /api/alerts/read-all": () => {
      state.unread = 0;
      return { marked: 2 };
    },
  };
  return { handlers, state };
}

describe("NotificationBell", () => {
  it("shows the unread count as text and in the accessible name", async () => {
    const { handlers } = setup(3);
    await renderWithProviders(<NotificationBell />, {
      handlers,
      me: makeMe("nurse"),
    });

    const bell = await screen.findByRole("button", {
      name: "Notifications, 3 unread",
    });
    expect(within(bell).getByText("3")).toBeInTheDocument();
  });

  it("shows no badge when everything is read", async () => {
    const { handlers } = setup(0);
    await renderWithProviders(<NotificationBell />, { handlers });

    const bell = await screen.findByRole("button", {
      name: "Notifications, 0 unread",
    });
    expect(bell).toHaveTextContent("");
  });

  it("asks only for the count until it is opened, then lists the latest notifications", async () => {
    const { handlers } = setup(1);
    const { api } = await renderWithProviders(<NotificationBell />, {
      handlers,
    });
    await screen.findByRole("button", { name: "Notifications, 1 unread" });
    expect(api.callsTo("GET /api/alerts")).toHaveLength(1);
    expect(api.callsTo("GET /api/alerts")[0].query).toMatchObject({
      limit: "1",
      unread: "1",
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" })
    );

    const list = await screen.findByRole("list", {
      name: "Latest notifications",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Amoxicillin expired")).toBeInTheDocument();
    expect(within(list).getByText("Critical")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View all notifications" })
    ).toHaveAttribute("href", "/notifications");
    expect(
      api.callsTo("GET /api/alerts").some((call) => call.query.limit === "8")
    ).toBe(true);
  });

  it("marks everything read", async () => {
    const { handlers } = setup(2);
    const { api } = await renderWithProviders(<NotificationBell />, {
      handlers,
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Notifications, 2 unread" })
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Mark all read" })
    );

    await waitFor(() =>
      expect(api.callsTo("POST /api/alerts/read-all")).toHaveLength(1)
    );
    await screen.findByRole("button", { name: "Notifications, 0 unread" });
    expect(
      screen.getByRole("button", { name: "Mark all read" })
    ).toBeDisabled();
  });

  it("marks one read and opens the item when a notification is chosen", async () => {
    const { handlers } = setup(1);
    const { api } = await renderWithProviders(<NotificationBell />, {
      handlers,
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" })
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /Amoxicillin expired/ })
    );

    await waitFor(() =>
      expect(api.callsTo("POST /api/alerts/:id/read")[0]?.params.id).toBe("n1")
    );
    expect(openItemDetail).toHaveBeenCalledWith("item-1", {
      batchId: "batch-1",
    });
  });

  it("announces a rise in unread politely, once, and not the first value", async () => {
    const { handlers, state } = setup(1);
    const { queryClient } = await renderWithProviders(<NotificationBell />, {
      handlers,
    });
    await screen.findByRole("button", { name: "Notifications, 1 unread" });
    expect(screen.getByRole("status")).toHaveTextContent("");

    state.unread = 4;
    await queryClient.invalidateQueries({ queryKey: alertKeys.unread });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "3 new notifications"
      )
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
