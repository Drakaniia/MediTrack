import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import {
  NewRequestDialogProvider,
  useNewRequestDialog,
} from "../new-request-dialog-context";
import { makeItem, makeItemDetail, makeRequest } from "../test-data";
import { NewRequestDialog } from "./new-request-dialog";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const QTY_MESSAGE = "Quantity must be a whole number greater than zero.";
const ITEM = makeItem();

const HANDLERS = {
  "GET /api/items": () => [ITEM],
  "GET /api/items/:id": () => makeItemDetail([], { id: "item-1" }),
  "POST /api/requests": () => [makeRequest({ code: "REQ-2026-0042" })],
};

async function pickItem() {
  await userEvent.click(
    await screen.findByRole("button", { name: /Paracetamol 500 mg/ })
  );
}

describe("NewRequestDialog validation timing", () => {
  it("shows the quantity message only after Create is clicked, never when an item is picked", async () => {
    const onClose = vi.fn();
    const { api } = await renderWithProviders(
      <NewRequestDialog initial={{}} onClose={onClose} />,
      { handlers: HANDLERS, me: makeMe("nurse") }
    );
    await screen.findByRole("dialog");

    await pickItem();
    expect(screen.getByText("Paracetamol 500 mg")).toBeInTheDocument();
    expect(screen.queryByText(QTY_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(QTY_MESSAGE)).toBeInTheDocument();
    expect(api.callsTo("POST /api/requests")).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rejects zero but accepts a positive whole number, then creates one request per line", async () => {
    const onClose = vi.fn();
    const { api } = await renderWithProviders(
      <NewRequestDialog initial={{}} onClose={onClose} />,
      { handlers: HANDLERS, me: makeMe("nurse") }
    );
    await screen.findByRole("dialog");
    await pickItem();

    const qty = screen.getByRole("spinbutton");
    await userEvent.type(qty, "0");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(QTY_MESSAGE)).toBeInTheDocument();

    await userEvent.clear(qty);
    await userEvent.type(qty, "3");
    await userEvent.type(screen.getByLabelText("Reason (optional)"), "Ward 4");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [call] = api.callsTo("POST /api/requests");
    expect(call.body).toMatchObject({
      lines: [{ itemId: "item-1", qty: 3 }],
      reason: "Ward 4",
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Request REQ-2026-0042 created."
    );
  });

  it("requires an item on every line after Create", async () => {
    await renderWithProviders(
      <NewRequestDialog initial={{}} onClose={vi.fn()} />,
      { handlers: HANDLERS, me: makeMe("nurse") }
    );
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual(
      expect.arrayContaining(["Choose an item.", QTY_MESSAGE])
    );
  });

  it("warns, but still allows creating, when the quantity exceeds availability", async () => {
    const { api } = await renderWithProviders(
      <NewRequestDialog initial={{}} onClose={vi.fn()} />,
      { handlers: HANDLERS, me: makeMe("nurse") }
    );
    await screen.findByRole("dialog");
    await pickItem();
    await userEvent.type(screen.getByRole("spinbutton"), "50");
    expect(screen.getByText(/Only 20 tabs available now/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(api.callsTo("POST /api/requests")).toHaveLength(1)
    );
  });

  it("shows a server failure inline and stays open", async () => {
    const onClose = vi.fn();
    await renderWithProviders(
      <NewRequestDialog initial={{}} onClose={onClose} />,
      {
        handlers: {
          ...HANDLERS,
          "POST /api/requests": () =>
            failure(404, "not_found", "The item was not found."),
        },
        me: makeMe("nurse"),
      }
    );
    await screen.findByRole("dialog");
    await pickItem();
    await userEvent.type(screen.getByRole("spinbutton"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("The item was not found.")
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

function Opener({ qty }: { qty?: number }) {
  const { openNewRequest } = useNewRequestDialog();
  return (
    <button
      onClick={() => openNewRequest({ itemId: "item-1", qty })}
      type="button"
    >
      Open it
    </button>
  );
}

describe("NewRequestDialogProvider", () => {
  it("opens pre-filled with the item and quantity from openNewRequest", async () => {
    await renderWithProviders(
      <NewRequestDialogProvider>
        <Opener qty={4} />
      </NewRequestDialogProvider>,
      { handlers: HANDLERS, me: makeMe("nurse") }
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));

    await screen.findByRole("dialog");
    expect(await screen.findByText("Paracetamol 500 mg")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue("4");
    expect(screen.queryByText(QTY_MESSAGE)).not.toBeInTheDocument();
  });

  it("refuses to open for a role that cannot create requests", async () => {
    await renderWithProviders(
      <NewRequestDialogProvider>
        <Opener />
      </NewRequestDialogProvider>,
      { handlers: HANDLERS, me: makeMe("health_admin") }
    );
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(
      "Your role cannot create requests."
    );
  });
});
