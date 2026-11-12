import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { TrashPage } from "./trash-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const TRASH = {
  batches: [
    {
      batchNumber: "LOT-9",
      deletedAt: "2026-11-10T03:00:00.000Z",
      deletedBy: "Admin A",
      deletedWithItem: false,
      expiry: "2027-01-01",
      id: "b1",
      itemDeleted: false,
      itemId: "i2",
      itemName: "Ibuprofen 200 mg",
      qty: 12,
    },
    {
      batchNumber: "LOT-1",
      deletedAt: "2026-11-11T03:00:00.000Z",
      deletedBy: "Admin A",
      deletedWithItem: true,
      expiry: "2027-02-01",
      id: "b2",
      itemDeleted: true,
      itemId: "i1",
      itemName: "Cetirizine 10 mg",
      qty: 30,
    },
  ],
  items: [
    {
      batchCount: 1,
      categoryName: null,
      deletedAt: "2026-11-11T03:00:00.000Z",
      deletedBy: "Admin A",
      displayName: "Cetirizine 10 mg",
      id: "i1",
      onHand: 30,
    },
  ],
};

function renderTrash(handlers: Record<string, () => unknown> = {}) {
  return renderWithProviders(<TrashPage />, {
    handlers: { "GET /api/trash": () => TRASH, ...handlers },
    me: makeMe("admin"),
  });
}

describe("TrashPage", () => {
  it("lists deleted products first and batches on the other tab", async () => {
    await renderTrash();
    expect(await screen.findByText("Cetirizine 10 mg")).toBeInTheDocument();
    expect(screen.queryByText("Batch LOT-9")).toBeNull();
    expect(screen.getByText(/1 batch, 30 on hand/)).toBeInTheDocument();
    expect(
      screen.getByText(/Deleted 11 Nov 2026, 11:00 by Admin A/)
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Batches/ }));
    expect(screen.getByText("Batch LOT-9")).toBeInTheDocument();
    expect(
      screen.getByText(/Deleted together with its product/)
    ).toBeInTheDocument();
  });

  it("restores an entry", async () => {
    const { api } = await renderTrash({
      "POST /api/trash/:type/:id/restore": () => undefined,
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Restore Cetirizine 10 mg" })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/trash/:type/:id/restore")).toHaveLength(1)
    );
    expect(api.callsTo("POST /api/trash/:type/:id/restore")[0].params).toEqual({
      id: "i1",
      type: "item",
    });
  });

  it("shows the server's message when a restore conflicts", async () => {
    await renderTrash({
      "POST /api/trash/:type/:id/restore": () =>
        failure(
          409,
          "restore_conflict",
          "Restore the item first: its batches come back with it."
        ),
    });
    await userEvent.click(
      await screen.findByRole("button", { name: /Batches/ })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Restore Batch LOT-1" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Restore the item first: its batches come back with it."
    );
  });

  it("requires typing DELETE before purging", async () => {
    const { api } = await renderTrash({
      "DELETE /api/trash/:type/:id": () => undefined,
    });
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Delete Cetirizine 10 mg permanently",
      })
    );
    const confirm = screen.getByRole("button", {
      hidden: false,
      name: "Delete permanently",
    });
    expect(confirm).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/Type DELETE to confirm/),
      "delete"
    );
    expect(confirm).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Type DELETE to confirm/));
    await userEvent.type(
      screen.getByLabelText(/Type DELETE to confirm/),
      "DELETE"
    );
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    await waitFor(() =>
      expect(api.callsTo("DELETE /api/trash/:type/:id")).toHaveLength(1)
    );
    expect(api.callsTo("DELETE /api/trash/:type/:id")[0].params).toEqual({
      id: "i1",
      type: "item",
    });
  });

  it("shows an empty state", async () => {
    await renderTrash({ "GET /api/trash": () => ({ batches: [], items: [] }) });
    expect(await screen.findByText("The Trash is empty")).toBeInTheDocument();
  });
});
