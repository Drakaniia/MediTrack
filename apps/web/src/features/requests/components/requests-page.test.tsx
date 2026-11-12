import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeMe, renderWithProviders } from "@/test/render";

import { makeBatch, makeItemDetail, makeRequest } from "../test-data";
import { RequestsPage } from "./requests-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock(
  "@cmis/ui/components/dropdown-menu",
  () => import("@/test/dropdown-menu-shim")
);

const PENDING = makeRequest({ itemName: "Aspirin 100 mg", status: "pending" });
const APPROVED = makeRequest({
  itemName: "Gauze pad",
  requestedBy: "someone-else",
  status: "approved",
});
const READY = makeRequest({
  itemId: "item-9",
  itemName: "Ibuprofen 200 mg",
  qty: 5,
  remaining: 5,
  requestedBy: "someone-else",
  status: "ready",
});

const HANDLERS = {
  "GET /api/requests": () => [PENDING, APPROVED, READY],
};

function cardOf(code: string): HTMLElement {
  const card = screen.getByText(new RegExp(code)).closest("li");
  if (!card) {
    throw new Error(`No card for ${code}`);
  }
  return card;
}

describe("RequestsPage gating by role", () => {
  it("is read-only for a nurse: no process actions, no selection, own request can be cancelled", async () => {
    await renderWithProviders(<RequestsPage />, {
      handlers: HANDLERS,
      me: makeMe("nurse"),
    });
    await screen.findByText("Aspirin 100 mg");

    expect(screen.getByText(/View only/)).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Approve" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Dispense/ })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Deny" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /Select/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New request/ })
    ).toBeInTheDocument();

    // The nurse's own pending request can be withdrawn; someone else's cannot.
    expect(
      within(cardOf(PENDING.code)).getByRole("menuitem", {
        name: "Cancel request",
      })
    ).toBeInTheDocument();
    expect(
      within(cardOf(APPROVED.code)).queryByRole("menuitem", {
        name: "Cancel request",
      })
    ).not.toBeInTheDocument();
  });

  it("hides creation too for a health administrator", async () => {
    await renderWithProviders(<RequestsPage />, {
      handlers: HANDLERS,
      me: makeMe("health_admin"),
    });
    await screen.findByText("Aspirin 100 mg");
    expect(
      screen.queryByRole("button", { name: /New request/ })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Cancel request" })
    ).not.toBeInTheDocument();
  });

  it("offers a pharmacist the process actions and the batch toolbar", async () => {
    const { api } = await renderWithProviders(<RequestsPage />, {
      handlers: {
        ...HANDLERS,
        "POST /api/requests/:id/transition": () => makeRequest(),
      },
      me: makeMe("pharmacist"),
    });
    await screen.findByText("Aspirin 100 mg");
    expect(screen.queryByText(/View only/)).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("checkbox", { name: `Select ${PENDING.code}` })
    );
    expect(
      await screen.findByRole("toolbar", { name: "Batch actions" })
    ).toHaveTextContent("1 selected");
    expect(
      screen.getByRole("button", { name: "Approve all" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deny all" })
    ).toBeInTheDocument();

    await userEvent.click(
      within(cardOf(PENDING.code)).getByRole("menuitem", { name: "Approve" })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/requests/:id/transition")).toHaveLength(1)
    );
    const [call] = api.callsTo("POST /api/requests/:id/transition");
    expect(call.params.id).toBe(PENDING.id);
    expect(call.body).toEqual({ to: "approved" });
  });

  it("moves a card optimistically and rolls back when the API refuses", async () => {
    const { queryClient } = await renderWithProviders(<RequestsPage />, {
      handlers: {
        ...HANDLERS,
        "POST /api/requests/:id/transition": () => {
          throw new TypeError("offline");
        },
      },
      me: makeMe("admin"),
    });
    await screen.findByText("Aspirin 100 mg");
    await userEvent.click(
      within(cardOf(PENDING.code)).getByRole("menuitem", { name: "Approve" })
    );
    await waitFor(() => {
      const lists = queryClient.getQueriesData<
        { id: string; status: string }[]
      >({
        queryKey: ["requests", "list"],
      });
      const row = lists[0]?.[1]?.find((request) => request.id === PENDING.id);
      expect(row?.status).toBe("pending");
    });
  });
});

describe("deny dialog", () => {
  it("requires a reason, then sends it", async () => {
    const { api } = await renderWithProviders(<RequestsPage />, {
      handlers: {
        ...HANDLERS,
        "POST /api/requests/:id/transition": () => makeRequest(),
      },
      me: makeMe("pharmacist"),
    });
    await screen.findByText("Aspirin 100 mg");
    await userEvent.click(
      within(cardOf(PENDING.code)).getByRole("menuitem", { name: "Deny" })
    );
    const dialog = await screen.findByRole("dialog", { name: "Deny request" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Deny" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Choose a reason for denying."
    );
    expect(api.callsTo("POST /api/requests/:id/transition")).toHaveLength(0);

    await userEvent.selectOptions(
      within(dialog).getByLabelText("Reason"),
      "Out of Stock"
    );
    await userEvent.type(
      within(dialog).getByLabelText("Note (optional)"),
      "none left"
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Deny" }));
    await waitFor(() =>
      expect(api.callsTo("POST /api/requests/:id/transition")).toHaveLength(1)
    );
    expect(api.callsTo("POST /api/requests/:id/transition")[0].body).toEqual({
      deniedNote: "none left",
      deniedReason: "Out of Stock",
      to: "denied",
    });
  });
});

describe("dispense dialog", () => {
  it("lists the FEFO batches that will be used and the availability", async () => {
    const batches = [
      makeBatch({
        batchNumber: "LOT-A",
        expiry: "2099-01-01",
        id: "ba",
        itemId: "item-9",
        qty: 3,
      }),
      makeBatch({
        batchNumber: "LOT-B",
        expiry: "2099-06-01",
        id: "bb",
        itemId: "item-9",
        qty: 10,
      }),
      makeBatch({
        batchNumber: "LOT-OLD",
        expiry: "2001-01-01",
        id: "bc",
        itemId: "item-9",
        qty: 50,
      }),
    ];
    const { api } = await renderWithProviders(<RequestsPage />, {
      handlers: {
        ...HANDLERS,
        "GET /api/items/:id": () => makeItemDetail(batches, { id: "item-9" }),
        "POST /api/requests/:id/dispense": () => ({
          partial: false,
          record: { qty: 5 },
          request: READY,
        }),
      },
      me: makeMe("pharmacist"),
    });
    await screen.findByText("Ibuprofen 200 mg");
    await userEvent.click(
      within(cardOf(READY.code)).getByRole("menuitem", { name: /Dispense/ })
    );
    const dialog = await screen.findByRole("dialog", {
      name: `Dispense ${READY.code}`,
    });

    expect(
      await within(dialog).findByText(/LOT-A: 3 tabs/)
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/LOT-B: 2 tabs/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/LOT-OLD/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(/Available now: 13 tabs/)
    ).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Dispense" })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/requests/:id/dispense")).toHaveLength(1)
    );
    expect(api.callsTo("POST /api/requests/:id/dispense")[0].body).toEqual({
      allowPartial: false,
      qty: 5,
    });
  });

  it("offers a partial hand-over when stock is short and needs the box ticked", async () => {
    const batches = [
      makeBatch({
        batchNumber: "LOT-A",
        expiry: "2099-01-01",
        id: "ba",
        itemId: "item-9",
        qty: 3,
      }),
    ];
    const { api } = await renderWithProviders(<RequestsPage />, {
      handlers: {
        ...HANDLERS,
        "GET /api/items/:id": () => makeItemDetail(batches, { id: "item-9" }),
        "POST /api/requests/:id/dispense": () => ({
          partial: true,
          record: { qty: 3 },
          request: READY,
        }),
      },
      me: makeMe("pharmacist"),
    });
    await screen.findByText("Ibuprofen 200 mg");
    await userEvent.click(
      within(cardOf(READY.code)).getByRole("menuitem", { name: /Dispense/ })
    );
    const dialog = await screen.findByRole("dialog", {
      name: `Dispense ${READY.code}`,
    });
    await within(dialog).findByText(/LOT-A: 3 tabs/);

    const submit = within(dialog).getByRole("button", { name: "Dispense" });
    expect(submit).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("checkbox", {
        name: /Only 3 tabs can be handed over now/,
      })
    );
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() =>
      expect(api.callsTo("POST /api/requests/:id/dispense")).toHaveLength(1)
    );
    expect(api.callsTo("POST /api/requests/:id/dispense")[0].body).toEqual({
      allowPartial: true,
      qty: 5,
    });
  });
});
