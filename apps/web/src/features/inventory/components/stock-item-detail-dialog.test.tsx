import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeBatch, makeDetail } from "@/features/inventory/test-data";
import { page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { StockItemDetailDialog } from "./stock-item-detail-dialog";

const openNewRequest = vi.fn();

vi.mock("@/features/requests/new-request-dialog-context", () => ({
  useNewRequestDialog: () => ({ openNewRequest }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const DETAIL = makeDetail({
  available: 30,
  batches: [
    makeBatch({
      batchNumber: "SOON",
      expiry: "2026-12-01",
      fefoRank: 1,
      id: "b1",
      qty: 10,
    }),
    makeBatch({
      batchNumber: "LATER",
      expiry: "2027-06-01",
      fefoRank: 2,
      id: "b2",
      qty: 20,
    }),
    makeBatch({
      batchNumber: "OLD",
      daysUntil: -12,
      expiry: "2026-10-31",
      expiryClass: "expired",
      fefoRank: null,
      id: "b3",
      qty: 5,
      quarantined: true,
    }),
    makeBatch({ batchNumber: "EMPTY", fefoRank: null, id: "b4", qty: 0 }),
  ],
  onHand: 35,
  worstClass: "expired",
});

async function open(role: Parameters<typeof makeMe>[0]) {
  return await renderWithProviders(
    <StockItemDetailDialog itemId="item-1" onClose={vi.fn()} />,
    {
      handlers: {
        "GET /api/items/:id": () => DETAIL,
        "GET /api/items/:id/history": () => page([]),
      },
      me: makeMe(role),
    }
  );
}

describe("StockItemDetailDialog", () => {
  it("lists batches in FEFO order, then quarantined, then empty ones", async () => {
    await open("admin");
    await screen.findByRole("heading", { name: "Paracetamol 500 mg" });

    const use = within(
      screen.getByRole("region", { name: "Use in this order" })
    );
    const rows = use.getAllByRole("row").slice(1);
    expect(
      rows.map((row) => within(row).getAllByRole("cell")[1].textContent)
    ).toEqual(["SOON", "LATER"]);
    expect(use.getByText("#1 · Use first")).toBeInTheDocument();
    expect(use.getByText("#2")).toBeInTheDocument();

    const quarantined = within(
      screen.getByRole("region", { name: "Quarantined (expired)" })
    );
    expect(quarantined.getByText("OLD")).toBeInTheDocument();
    expect(quarantined.getByText("Expired")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Empty or disposed" })
      ).getByText("EMPTY")
    ).toBeInTheDocument();
  });

  it("offers every action to an administrator", async () => {
    await open("admin");
    await screen.findByRole("button", { name: "New request for this stock" });
    expect(
      screen.getByRole("button", { name: "Edit product" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete product" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add batch" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Print label/ })).toHaveLength(
      4
    );
  });

  it("lets a nurse request stock but not edit or delete", async () => {
    await open("nurse");
    await screen.findByRole("button", { name: "New request for this stock" });
    expect(screen.queryByRole("button", { name: "Edit product" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete product" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add batch" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit$/ })).toBeNull();
  });

  it("hides the request button from a role that cannot create requests", async () => {
    await open("health_admin");
    await screen.findByRole("heading", { name: "Paracetamol 500 mg" });
    expect(
      screen.queryByRole("button", { name: "New request for this stock" })
    ).toBeNull();
  });

  it("opens the new-request dialog for this item", async () => {
    openNewRequest.mockClear();
    await open("pharmacist");
    await userEvent.click(
      await screen.findByRole("button", { name: "New request for this stock" })
    );
    expect(openNewRequest).toHaveBeenCalledWith({ itemId: "item-1" });
  });

  it("deletes a product after confirmation", async () => {
    const { api } = await renderWithProviders(
      <StockItemDetailDialog itemId="item-1" onClose={vi.fn()} />,
      {
        handlers: {
          "DELETE /api/items/:id": () => undefined,
          "GET /api/items/:id": () => DETAIL,
          "GET /api/items/:id/history": () => page([]),
        },
        me: makeMe("inventory"),
      }
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete product" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Move to Trash" })
    );
    await vi.waitFor(() =>
      expect(api.callsTo("DELETE /api/items/:id")).toHaveLength(1)
    );
    expect(api.callsTo("DELETE /api/items/:id")[0].params.id).toBe("item-1");
  });

  it("shows the history tab", async () => {
    const { api } = await renderWithProviders(
      <StockItemDetailDialog itemId="item-1" onClose={vi.fn()} />,
      {
        handlers: {
          "GET /api/items/:id": () => DETAIL,
          "GET /api/items/:id/history": () =>
            page([
              {
                actorName: "Maria",
                at: "2026-11-01T02:00:00.000Z",
                batchNumber: "SOON",
                id: "movement:1",
                kind: "receive",
                note: "",
                qtyAfter: 10,
                qtyDelta: 10,
                source: "movement",
                summary: "Initial stock",
              },
            ]),
        },
        me: makeMe("admin"),
      }
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "History" })
    );
    expect(
      await screen.findByText(/Received \+10 \(batch SOON, now 10\)/)
    ).toBeInTheDocument();
    expect(api.callsTo("GET /api/items/:id/history")).toHaveLength(1);
  });
});
