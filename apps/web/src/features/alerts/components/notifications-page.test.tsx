import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MockRequest } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { alertsPage, makeNotification } from "../test-data";
import { NotificationsPage } from "./notifications-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("./push-opt-in-card", () => ({ PushOptInCard: () => null }));

const openItemDetail = vi.fn();
vi.mock("@/features/inventory/stock-item-detail-dialog-context", () => ({
  useStockItemDetailDialog: () => ({ openItemDetail }),
}));

interface ListRequest {
  query: Record<string, string>;
}

const EXPIRED = makeNotification({
  batchId: "batch-1",
  id: "n-expired",
  itemId: "item-1",
  kind: "expired",
  severity: "critical",
  title: "Amoxicillin expired",
});
const READ_ROW = makeNotification({
  id: "n-read",
  kind: "low_stock",
  read: true,
  severity: "info",
  title: "Gauze low on stock",
});

function setup(rows = [EXPIRED, READ_ROW], unread = 1) {
  return {
    "GET /api/alerts": (request: ListRequest) =>
      request.query.unread === "1"
        ? alertsPage(
            rows.filter((row) => !row.read),
            { unread }
          )
        : alertsPage(rows, { unread }),
    "POST /api/alerts/:id/dismiss": (request: MockRequest) =>
      makeNotification({ dismissed: true, id: request.params.id }),
    "POST /api/alerts/:id/read": (request: MockRequest) =>
      makeNotification({ id: request.params.id, read: true }),
    "POST /api/alerts/read-all": () => ({ marked: unread }),
  };
}

describe("NotificationsPage", () => {
  it("lists notifications with severity and unread shown as text", async () => {
    await renderWithProviders(<NotificationsPage />, {
      handlers: setup(),
      me: makeMe("nurse"),
    });

    const list = await screen.findByRole("list", { name: "Notifications" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first).getByText("Amoxicillin expired")).toBeInTheDocument();
    expect(within(first).getByText("Critical")).toBeInTheDocument();
    expect(within(first).getByText("Unread")).toBeInTheDocument();
    expect(within(second).queryByText("Unread")).not.toBeInTheDocument();
    expect(screen.getByText("2 notifications")).toBeInTheDocument();
  });

  it("switches to the unread tab and asks the server for unread only", async () => {
    const { api } = await renderWithProviders(<NotificationsPage />, {
      handlers: setup(),
    });
    await screen.findByRole("list", { name: "Notifications" });
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await userEvent.click(screen.getByRole("tab", { name: "Unread (1)" }));

    await waitFor(() =>
      expect(
        api.callsTo("GET /api/alerts").some((call) => call.query.unread === "1")
      ).toBe(true)
    );
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("list", { name: "Notifications" })
        ).getAllByRole("listitem")
      ).toHaveLength(1)
    );
  });

  it("filters by kind and severity", async () => {
    const { api } = await renderWithProviders(<NotificationsPage />, {
      handlers: setup(),
    });
    await screen.findByRole("list", { name: "Notifications" });

    await userEvent.selectOptions(screen.getByLabelText("Type"), "expired");
    await userEvent.selectOptions(
      screen.getByLabelText("Severity"),
      "critical"
    );

    await waitFor(() =>
      expect(
        api
          .callsTo("GET /api/alerts")
          .some(
            (call) =>
              call.query.kind === "expired" &&
              call.query.severity === "critical"
          )
      ).toBe(true)
    );
  });

  it("marks one notification read and dismisses another", async () => {
    const { api } = await renderWithProviders(<NotificationsPage />, {
      handlers: setup(),
    });
    await screen.findByRole("list", { name: "Notifications" });

    await userEvent.click(
      screen.getByRole("button", { name: "Mark Amoxicillin expired as read" })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/alerts/:id/read")[0]?.params.id).toBe(
        "n-expired"
      )
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss Gauze low on stock" })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/alerts/:id/dismiss")[0]?.params.id).toBe(
        "n-read"
      )
    );
  });

  it("marks everything read, and disables the button when nothing is unread", async () => {
    const { api } = await renderWithProviders(<NotificationsPage />, {
      handlers: setup(),
    });
    await screen.findByRole("list", { name: "Notifications" });

    await userEvent.click(
      screen.getByRole("button", { name: "Mark all read" })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/alerts/read-all")).toHaveLength(1)
    );
  });

  it("disables mark all read at zero unread", async () => {
    await renderWithProviders(<NotificationsPage />, {
      handlers: setup([READ_ROW], 0),
    });
    await screen.findByRole("list", { name: "Notifications" });

    expect(
      screen.getByRole("button", { name: "Mark all read" })
    ).toBeDisabled();
  });

  it("opens the item detail for a notification about an item", async () => {
    await renderWithProviders(<NotificationsPage />, { handlers: setup() });
    await screen.findByRole("list", { name: "Notifications" });

    await userEvent.click(
      screen.getByRole("button", { name: "View item for Amoxicillin expired" })
    );

    expect(openItemDetail).toHaveBeenCalledWith("item-1", {
      batchId: "batch-1",
    });
    expect(
      screen.queryByRole("button", { name: "View item for Gauze low on stock" })
    ).not.toBeInTheDocument();
  });

  it("loads more in pages of 30", async () => {
    const all = Array.from({ length: 31 }, (_, index) =>
      makeNotification({ id: `bulk-${index}`, title: `Bulk ${index}` })
    );
    const { api } = await renderWithProviders(<NotificationsPage />, {
      handlers: {
        ...setup(),
        "GET /api/alerts": (request: ListRequest) => {
          const offset = Number(request.query.offset) || 0;
          return alertsPage(all.slice(offset, offset + 30), {
            offset,
            total: all.length,
            unread: 31,
          });
        },
      },
    });
    const list = await screen.findByRole("list", { name: "Notifications" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(30);

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() =>
      expect(within(list).getAllByRole("listitem")).toHaveLength(31)
    );
    expect(api.callsTo("GET /api/alerts").at(-1)?.query.offset).toBe("30");
    expect(
      screen.queryByRole("button", { name: "Load more" })
    ).not.toBeInTheDocument();
  });

  it("explains an empty list", async () => {
    await renderWithProviders(<NotificationsPage />, {
      handlers: setup([], 0),
    });

    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
  });
});
