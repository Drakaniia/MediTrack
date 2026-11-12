import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StockItemDetailDialogProvider } from "@/features/inventory/stock-item-detail-dialog-context";
import { makeDetail, makeItem } from "@/features/inventory/test-data";
import { failure, page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { InventoryPage } from "./inventory-page";

vi.mock("@tanstack/react-virtual", () => import("@/test/virtualizer-shim"));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/features/requests/new-request-dialog-context", () => ({
  useNewRequestDialog: () => ({ openNewRequest: vi.fn() }),
}));

const ITEMS = [
  makeItem({ displayName: "Amoxicillin 250 mg", id: "a", name: "Amoxicillin" }),
  makeItem({
    available: 0,
    displayName: "Gauze",
    id: "g",
    lowStock: "out",
    name: "Gauze",
    onHand: 12,
    worstClass: "expired",
  }),
  makeItem({
    displayName: "Ibuprofen 200 mg",
    id: "i",
    name: "Ibuprofen",
    worstClass: "urgent",
  }),
];

function handlers(extra: Record<string, () => unknown> = {}) {
  return {
    "GET /api/categories": () => [
      { id: "c1", itemCount: 2, name: "Analgesic" },
      { id: "c2", itemCount: 1, name: "Antibiotic" },
    ],
    "GET /api/items": () => page(ITEMS, { total: ITEMS.length }),
    ...extra,
  };
}

function renderPage(role: Parameters<typeof makeMe>[0], extra = {}) {
  return renderWithProviders(
    <StockItemDetailDialogProvider>
      <InventoryPage />
    </StockItemDetailDialogProvider>,
    { handlers: handlers(extra), me: makeMe(role) }
  );
}

describe("InventoryPage", () => {
  it("lists items with their worst expiry class and a low-stock chip", async () => {
    await renderPage("admin");
    const list = await screen.findByRole("list", { name: "Inventory items" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);

    const gauze = within(screen.getByRole("button", { name: /Gauze/ }));
    expect(gauze.getByText("Expired")).toBeInTheDocument();
    expect(gauze.getByText("Out of stock")).toBeInTheDocument();
    expect(gauze.getByText("0 available")).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Ibuprofen/ })).getByText(
        "Urgent"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("3 items")).toBeInTheDocument();
  });

  it("sends search and filters to the server", async () => {
    const { api } = await renderPage("admin");
    await screen.findByRole("list", { name: "Inventory items" });

    await userEvent.type(screen.getByLabelText("Search items"), "gauze");
    await waitFor(() =>
      expect(api.callsTo("GET /api/items").at(-1)?.query.search).toBe("gauze")
    );

    await userEvent.selectOptions(
      screen.getByLabelText("Expiry status"),
      "expired"
    );
    await userEvent.selectOptions(screen.getByLabelText("Stock level"), "out");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "c2");
    await userEvent.selectOptions(
      screen.getByLabelText("Sort by"),
      "nearestExpiry"
    );
    await waitFor(() => {
      const { query } = api.callsTo("GET /api/items").at(-1) ?? { query: {} };
      expect(query).toMatchObject({
        categoryId: "c2",
        search: "gauze",
        sort: "nearestExpiry",
        status: "expired",
        stock: "out",
      });
    });
  });

  it("shows a no-match state and lets the user clear the filters", async () => {
    await renderPage("admin", {
      "GET /api/items": () => page([], { total: 0 }),
    });
    await userEvent.type(await screen.findByLabelText("Search items"), "zzz");
    expect(await screen.findByText("No items match")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear filters" })
    );
    expect(screen.getByLabelText("Search items")).toHaveValue("");
  });

  it("shows the empty state with an Add stock action for writers", async () => {
    await renderPage("inventory", {
      "GET /api/items": () => page([], { total: 0 }),
    });
    expect(await screen.findByText("No inventory yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add your first stock" })
    ).toBeInTheDocument();
  });

  it("opens the item detail when a row is clicked", async () => {
    await renderPage("admin", {
      "GET /api/items/:id": () => makeDetail({ displayName: "Gauze", id: "g" }),
      "GET /api/items/:id/history": () => page([]),
    });
    await userEvent.click(await screen.findByRole("button", { name: /Gauze/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Gauze" })
    ).toBeInTheDocument();
  });

  it("lets an administrator select rows and delete them", async () => {
    const { api } = await renderPage("admin", {
      "DELETE /api/items/:id": () => undefined,
    });
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Select Gauze" })
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select Ibuprofen 200 mg" })
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Delete selected" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Move to Trash" })
    );
    await waitFor(() =>
      expect(api.callsTo("DELETE /api/items/:id")).toHaveLength(2)
    );
    expect(
      api
        .callsTo("DELETE /api/items/:id")
        .map((call) => call.params.id)
        .sort()
    ).toEqual(["g", "i"]);
  });

  it("hides write actions and selection from a nurse", async () => {
    await renderPage("nurse");
    await screen.findByRole("list", { name: "Inventory items" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("link", { name: "Add stock" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Categories" })).toBeNull();
    expect(screen.getByRole("link", { name: "Use first" })).toBeInTheDocument();
  });

  it("shows an error with a retry", async () => {
    let calls = 0;
    await renderPage("admin", {
      "GET /api/items": () => {
        calls += 1;
        return calls === 1
          ? failure(500, "internal_error", "The database is busy.")
          : page(ITEMS, { total: ITEMS.length });
      },
    });
    expect(
      await screen.findByText("The database is busy.")
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("list", { name: "Inventory items" })
    ).toBeInTheDocument();
  });
});
