import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { makeLowStockRow } from "../test-data";
import { LowStockPage } from "./low-stock-page";

vi.mock("@tanstack/react-virtual", () => import("@/test/virtualizer-shim"));
vi.mock("@cmis/ui/components/popover", () => import("@/test/popover-shim"));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const openItemDetail = vi.fn();

vi.mock("@/features/inventory/stock-item-detail-dialog-context", () => ({
  useStockItemDetailDialog: () => ({ openItemDetail }),
}));

const ROWS = [
  makeLowStockRow({
    available: 0,
    displayName: "Gauze 10 cm",
    gap: 30,
    itemId: "item-out",
    lowStockThreshold: 30,
    name: "Gauze",
    nearestExpiry: null,
    onHand: 8,
    status: "out",
    suggestedReorderQty: 60,
    unit: "roll",
  }),
  makeLowStockRow(),
];

function renderPage(role: Parameters<typeof makeMe>[0], extra = {}) {
  return renderWithProviders(<LowStockPage />, {
    handlers: {
      "GET /api/categories": () => [
        { id: "cat-1", itemCount: 2, name: "Antibiotic" },
      ],
      "GET /api/low-stock": () => page(ROWS, { total: ROWS.length }),
      "PATCH /api/items/:id/threshold": (request: { body: unknown }) => ({
        itemId: "item-2",
        lowStockThreshold: (request.body as { lowStockThreshold: number })
          .lowStockThreshold,
        previous: 10,
      }),
      ...extra,
    },
    me: makeMe(role),
  });
}

describe("LowStockPage", () => {
  it("says stock is counted as available (not expired)", async () => {
    await renderPage("admin");
    expect(
      await screen.findByText(/available stock \(not expired\) is below/)
    ).toBeInTheDocument();
  });

  it("lists items with status chip, gap bar and suggested reorder", async () => {
    await renderPage("admin");
    const list = await screen.findByRole("list", { name: "Low-stock items" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    const gauze = within(
      screen.getByRole("button", { name: "Open Gauze 10 cm" })
    );
    expect(gauze.getByText("Out")).toBeInTheDocument();
    expect(gauze.getByText(/0 of 30 available/)).toBeInTheDocument();
    expect(gauze.getByText(/Reorder about 60 rolls/)).toBeInTheDocument();
    expect(
      gauze.getByText(/8 more expired, awaiting disposal/)
    ).toBeInTheDocument();

    const amox = within(
      screen.getByRole("button", { name: "Open Amoxicillin 500 mg" })
    );
    expect(amox.getByText("Low")).toBeInTheDocument();
    expect(amox.getByText(/4 of 10 available/)).toBeInTheDocument();
    expect(amox.getByText(/short by 6 caps/)).toBeInTheDocument();
    expect(amox.getByText(/next expiry 15 Jan 2027/)).toBeInTheDocument();

    const bar = amox.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "4");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
  });

  it("opens the item when a row is pressed", async () => {
    await renderPage("admin");
    await userEvent.click(
      await screen.findByRole("button", { name: "Open Gauze 10 cm" })
    );
    expect(openItemDetail).toHaveBeenCalledWith("item-out");
  });

  it("edits the threshold inline and refreshes the list", async () => {
    const { api } = await renderPage("inventory");
    await screen.findByRole("list", { name: "Low-stock items" });
    const before = api.callsTo("GET /api/low-stock").length;

    await userEvent.click(
      screen.getByRole("button", {
        name: "Edit low-stock threshold of Amoxicillin 500 mg",
      })
    );
    const input = screen.getByLabelText("Low-stock threshold");
    expect(input).toHaveValue("10");
    await userEvent.clear(input);
    await userEvent.type(input, "25");
    await userEvent.click(
      screen.getByRole("button", { name: "Save threshold" })
    );

    await waitFor(() =>
      expect(api.callsTo("PATCH /api/items/:id/threshold")).toHaveLength(1)
    );
    const [call] = api.callsTo("PATCH /api/items/:id/threshold");
    expect(call.params.id).toBe("item-2");
    expect(call.body).toEqual({ lowStockThreshold: 25 });
    await waitFor(() =>
      expect(api.callsTo("GET /api/low-stock").length).toBeGreaterThan(before)
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Low-stock threshold")
      ).not.toBeInTheDocument()
    );
  });

  it("validates the threshold only after submit", async () => {
    const { api } = await renderPage("admin");
    await screen.findByRole("list", { name: "Low-stock items" });
    await userEvent.click(
      screen.getByRole("button", {
        name: "Edit low-stock threshold of Amoxicillin 500 mg",
      })
    );
    const input = screen.getByLabelText("Low-stock threshold");
    await userEvent.clear(input);
    await userEvent.type(input, "abc");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Save threshold" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a whole number"
    );
    expect(api.callsTo("PATCH /api/items/:id/threshold")).toHaveLength(0);
  });

  it("hides the threshold editor from roles without inventory.write", async () => {
    for (const role of ["pharmacist", "nurse", "health_admin"] as const) {
      const { unmount } = await renderPage(role);
      await screen.findByRole("list", { name: "Low-stock items" });
      expect(
        screen.queryByRole("button", { name: /Edit low-stock threshold/ })
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("sends the status chips, search and category to the server", async () => {
    const { api } = await renderPage("admin");
    await screen.findByRole("list", { name: "Low-stock items" });
    expect(api.callsTo("GET /api/low-stock")[0].query.status).toBe("low,out");

    await userEvent.click(screen.getByRole("button", { name: "Out" }));
    await waitFor(() =>
      expect(api.callsTo("GET /api/low-stock").at(-1)?.query.status).toBe("low")
    );
    await userEvent.type(screen.getByLabelText("Search items"), "amox");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "cat-1");
    await waitFor(() => {
      const { query } = api.callsTo("GET /api/low-stock").at(-1) ?? {
        query: {},
      };
      expect(query).toMatchObject({
        categoryId: "cat-1",
        search: "amox",
        status: "low",
      });
    });
  });

  it("shows a calm empty state when nothing is low", async () => {
    await renderPage("admin", {
      "GET /api/low-stock": () => page([], { total: 0 }),
    });
    expect(
      await screen.findByText("Nothing is running low")
    ).toBeInTheDocument();
  });
});
