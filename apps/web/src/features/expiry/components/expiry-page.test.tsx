import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { makeExpiryRow, makeSummary } from "../test-data";
import { ExpiryPage } from "./expiry-page";

vi.mock("@tanstack/react-virtual", () => import("@/test/virtualizer-shim"));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const openItemDetail = vi.fn();

vi.mock("@/features/inventory/stock-item-detail-dialog-context", () => ({
  useStockItemDetailDialog: () => ({ openItemDetail }),
}));

const ROWS = [
  makeExpiryRow({
    batchId: "b-old",
    batchNumber: "OLD-1",
    daysUntil: -3,
    displayName: "Ibuprofen 200 mg",
    expiry: "2026-11-09",
    expiryClass: "expired",
    fefoRank: null,
    itemId: "item-old",
    quarantined: true,
  }),
  makeExpiryRow({
    batchId: "b-soon",
    batchNumber: "SOON-1",
    displayName: "Paracetamol 500 mg",
    itemId: "item-soon",
  }),
  makeExpiryRow({
    batchId: "b-near",
    batchNumber: "NEAR-1",
    daysUntil: 20,
    displayName: "Amoxicillin 250 mg",
    expiry: "2026-12-02",
    expiryClass: "near_expiry",
    fefoRank: 2,
    itemId: "item-near",
  }),
];

function renderPage(
  role: Parameters<typeof makeMe>[0],
  options: { settings?: { nearDays: number; urgentDays: number } } = {}
) {
  return renderWithProviders(<ExpiryPage />, {
    handlers: {
      "GET /api/categories": () => [
        { id: "cat-1", itemCount: 3, name: "Analgesic" },
      ],
      "GET /api/expiry": () => page(ROWS, { total: ROWS.length }),
      "GET /api/expiry/summary": () => makeSummary(),
    },
    me: makeMe(role, { settings: options.settings }),
  });
}

describe("ExpiryPage", () => {
  it("lists batches with their class badge, quantity and expiry", async () => {
    await renderPage("admin");
    const list = await screen.findByRole("list", { name: "Batches by expiry" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);

    const expired = within(
      screen.getByRole("button", { name: /Ibuprofen 200 mg, batch OLD-1/ })
    );
    expect(expired.getByText("Expired")).toBeInTheDocument();
    expect(expired.getByText("· Expired 3d ago")).toBeInTheDocument();
    expect(expired.getByText("9 Nov 2026")).toBeInTheDocument();

    const soon = within(
      screen.getByRole("button", { name: /Paracetamol 500 mg, batch SOON-1/ })
    );
    expect(soon.getByText("Urgent")).toBeInTheDocument();
    expect(soon.getByText(/40 tabs/)).toBeInTheDocument();
    expect(await screen.findByText("3 batches")).toBeInTheDocument();
  });

  it("shows summary tiles with batch and unit counts", async () => {
    await renderPage("admin");
    const tiles = within(
      await screen.findByRole("list", { name: "Expiry summary" })
    );
    expect(
      await tiles.findByRole("button", { name: /^Urgent 2 batches · 45 units/ })
    ).toBeInTheDocument();
    expect(
      tiles.getByRole("button", { name: /^Near Expiry 4 batches · 120 units/ })
    ).toBeInTheDocument();
    expect(
      tiles.getByRole("button", { name: /^Expired 1 batch · 6 units/ })
    ).toBeInTheDocument();
    expect(
      tiles.getByRole("button", { name: /^Safe 30 batches · 900 units/ })
    ).toBeInTheDocument();
  });

  it("filters the list to a class when its tile is pressed, and back again", async () => {
    const { api } = await renderPage("admin");
    const tile = await screen.findByRole("button", {
      name: /^Expired 1 batch/,
    });
    await screen.findByRole("list", { name: "Batches by expiry" });
    expect(api.callsTo("GET /api/expiry")[0].query.class).toBe(
      "urgent,near_expiry,expired"
    );

    await userEvent.click(tile);
    await waitFor(() =>
      expect(api.callsTo("GET /api/expiry").at(-1)?.query.class).toBe("expired")
    );
    expect(tile).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(tile);
    await waitFor(() =>
      expect(api.callsTo("GET /api/expiry").at(-1)?.query.class).toBe(
        "urgent,near_expiry,expired"
      )
    );
    expect(tile).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles classes with the chips, including Safe", async () => {
    const { api } = await renderPage("admin");
    await screen.findByRole("list", { name: "Batches by expiry" });
    await userEvent.click(screen.getByRole("button", { name: "Safe" }));
    await waitFor(() =>
      expect(api.callsTo("GET /api/expiry").at(-1)?.query.class).toBe(
        "urgent,near_expiry,expired,safe"
      )
    );
  });

  it("sends the search, category and date range to the server", async () => {
    const { api } = await renderPage("admin");
    await screen.findByRole("list", { name: "Batches by expiry" });
    await userEvent.type(screen.getByLabelText("Search batches"), "para");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "cat-1");
    await userEvent.type(screen.getByLabelText("Expires to"), "2026-12-31");
    await waitFor(() => {
      const { query } = api.callsTo("GET /api/expiry").at(-1) ?? { query: {} };
      expect(query).toMatchObject({
        categoryId: "cat-1",
        search: "para",
        to: "2026-12-31",
      });
    });
  });

  it("describes the thresholds from the facility settings", async () => {
    await renderPage("admin", { settings: { nearDays: 45, urgentDays: 10 } });
    expect(
      await screen.findByText(/Urgent ≤ 10 days, Near Expiry ≤ 45 days/)
    ).toBeInTheDocument();
  });

  it("opens the item detail for the batch when a row is pressed", async () => {
    await renderPage("admin");
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Paracetamol 500 mg, batch SOON-1/,
      })
    );
    expect(openItemDetail).toHaveBeenCalledWith("item-soon", {
      batchId: "b-soon",
    });
  });

  it("gives admin Adjust on live rows and Dispose on the expired row only", async () => {
    await renderPage("admin");
    await screen.findByRole("list", { name: "Batches by expiry" });
    expect(
      screen.getByRole("button", {
        name: "Dispose batch OLD-1 of Ibuprofen 200 mg",
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Adjust batch OLD-1/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Adjust batch SOON-1 of Paracetamol 500 mg",
      })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Dispose/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Adjust/ })).toHaveLength(2);
  });

  it("shows no action buttons to roles without stock permissions", async () => {
    for (const role of ["nurse", "health_admin"] as const) {
      const { unmount } = await renderPage(role);
      await screen.findByRole("list", { name: "Batches by expiry" });
      expect(
        screen.queryByRole("button", { name: /^Dispose/ })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^Adjust/ })
      ).not.toBeInTheDocument();
      // They can still look: the rows open the item.
      expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(3);
      unmount();
    }
  });

  it("shows a friendly empty state", async () => {
    await renderWithProviders(<ExpiryPage />, {
      handlers: {
        "GET /api/categories": () => [],
        "GET /api/expiry": () => page([], { total: 0 }),
        "GET /api/expiry/summary": () => makeSummary(),
      },
      me: makeMe("admin"),
    });
    expect(
      await screen.findByText("Nothing needs attention")
    ).toBeInTheDocument();
  });
});
