import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import {
  QuickDeductDialogProvider,
  useQuickDeductDialog,
} from "../quick-deduct-dialog-context";
import { makeItem, makeItemDetail, makeRecord } from "../test-data";
import { QuickDeductDialog } from "./quick-deduct-dialog";
import { QuickDeductUndoToast } from "./quick-deduct-undo-toast";

vi.mock("sonner", () => ({
  toast: {
    custom: vi.fn(),
    dismiss: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

const ITEM = makeItem();
const RECORD = makeRecord({ qty: 5 });
const RESULT = { record: RECORD, undoUntil: "2026-11-12T02:01:00.000Z" };

const HANDLERS = {
  "GET /api/items": () => [ITEM],
  "GET /api/items/:id": () => makeItemDetail([]),
  "POST /api/quick-deduct": () => RESULT,
};

describe("QuickDeductDialog", () => {
  it("deducts one item and one quantity with one confirm", async () => {
    const onClose = vi.fn();
    const onDone = vi.fn();
    const { api } = await renderWithProviders(
      <QuickDeductDialog onClose={onClose} onDone={onDone} />,
      { handlers: HANDLERS, me: makeMe("nurse") }
    );
    await screen.findByRole("dialog");
    await userEvent.click(
      await screen.findByRole("button", { name: /Paracetamol 500 mg/ })
    );
    await userEvent.type(screen.getByRole("spinbutton"), "5");
    await userEvent.type(screen.getByLabelText("Recipient (optional)"), "Ben");
    await userEvent.click(screen.getByRole("button", { name: "Deduct" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.callsTo("POST /api/quick-deduct")[0].body).toEqual({
      itemId: "item-1",
      qty: 5,
      recipient: "Ben",
    });
    expect(onDone).toHaveBeenCalledWith(
      RESULT,
      expect.objectContaining({ id: "item-1" })
    );
  });

  it("validates after Deduct is clicked and shows a refusal inline", async () => {
    const onClose = vi.fn();
    await renderWithProviders(
      <QuickDeductDialog
        initialItemId="item-1"
        onClose={onClose}
        onDone={vi.fn()}
      />,
      {
        handlers: {
          ...HANDLERS,
          "POST /api/quick-deduct": () =>
            failure(409, "insufficient_stock", "Only 3 tab in stock."),
        },
        me: makeMe("nurse"),
      }
    );
    await screen.findByRole("dialog");
    await screen.findByText("Paracetamol 500 mg");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Deduct" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Quantity must be a whole number greater than zero."
    );

    await userEvent.type(screen.getByRole("spinbutton"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Deduct" }));
    expect(await screen.findByText("Only 3 tab in stock.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

function Opener(): ReactElement {
  const { openQuickDeduct } = useQuickDeductDialog();
  return (
    <button onClick={() => openQuickDeduct({ itemId: "item-1" })} type="button">
      Quick
    </button>
  );
}

describe("QuickDeductDialogProvider", () => {
  it("shows an Undo toast after a successful deduction", async () => {
    const { api } = await renderWithProviders(
      <QuickDeductDialogProvider>
        <Opener />
      </QuickDeductDialogProvider>,
      {
        handlers: {
          ...HANDLERS,
          "POST /api/quick-deduct/:id/undo": () => ({
            ...RECORD,
            undoneAt: "x",
          }),
        },
        me: makeMe("pharmacist"),
      }
    );
    await userEvent.click(screen.getByRole("button", { name: "Quick" }));
    await screen.findByText("Paracetamol 500 mg");
    await userEvent.type(screen.getByRole("spinbutton"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Deduct" }));

    await waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(1));
    const [renderToast, options] = vi.mocked(toast.custom).mock.calls[0];
    expect(options).toMatchObject({ duration: 60_000 });

    render(renderToast("toast-1") as ReactElement);
    expect(
      screen.getByText("Deducted 5 tabs of Paracetamol 500 mg.")
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Undo/ }));
    await waitFor(() =>
      expect(api.callsTo("POST /api/quick-deduct/:id/undo")).toHaveLength(1)
    );
    expect(api.callsTo("POST /api/quick-deduct/:id/undo")[0].params.id).toBe(
      RECORD.id
    );
    await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith("toast-1"));
  });
});

describe("QuickDeductUndoToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down, undoes while live, then expires", async () => {
    const onUndo = vi.fn(() => Promise.resolve());
    const onExpire = vi.fn();
    render(
      <QuickDeductUndoToast
        onExpire={onExpire}
        onUndo={onUndo}
        seconds={3}
        summary="5 tabs of Paracetamol 500 mg"
      />
    );
    expect(
      screen.getByText("Deducted 5 tabs of Paracetamol 500 mg.")
    ).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Undo (3s)" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("button", { name: "Undo (2s)" })).toBeEnabled();

    await act(async () => {
      button.click();
    });
    expect(onUndo).toHaveBeenCalledTimes(1);

    // One tick per act(): each render schedules the next timer.
    for (const tick of [1, 2]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(tick).toBeGreaterThan(0);
    }
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Undo (0s)" })).toBeDisabled();
  });
});
