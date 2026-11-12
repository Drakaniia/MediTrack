import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { expiryKeys } from "../hooks/expiry-queries";
import { makeBatchDto } from "../test-data";
import {
  type AdjustDialogBatch,
  AdjustStockDialog,
  checkAmount,
} from "./adjust-stock-dialog";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const BATCH: AdjustDialogBatch = {
  batchId: "b-1",
  batchNumber: "LOT-1",
  displayName: "Paracetamol 500 mg",
  qty: 12,
  unit: "tab",
};

function setup(handlers = {}) {
  const onClose = vi.fn();
  const onAdjusted = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
  queryClient.setQueryData(expiryKeys.summary, { stale: true });
  const rendered = renderWithProviders(
    <AdjustStockDialog
      batch={BATCH}
      onAdjusted={onAdjusted}
      onClose={onClose}
    />,
    {
      handlers: {
        "POST /api/batches/:id/adjust": () =>
          makeBatchDto({ id: "b-1", qty: 7 }),
        ...handlers,
      },
      me: makeMe("inventory"),
      queryClient,
    }
  );
  return { onAdjusted, onClose, queryClient, rendered };
}

describe("checkAmount", () => {
  it("builds newQty for 'set' and delta for 'change'", () => {
    expect(checkAmount("set", " 7 ", 12)).toMatchObject({
      body: { newQty: 7 },
      result: 7,
    });
    expect(checkAmount("change", "-3", 12)).toMatchObject({
      body: { delta: -3 },
      result: 9,
    });
    expect(checkAmount("change", "+5", 12)).toMatchObject({
      body: { delta: 5 },
      result: 17,
    });
  });

  it("explains what is wrong", () => {
    expect(checkAmount("set", "", 12).error).toMatch(/whole number/);
    expect(checkAmount("set", "-1", 12).error).toMatch(/whole number/);
    expect(checkAmount("set", "2.5", 12).error).toMatch(/whole number/);
    expect(checkAmount("set", "12", 12).error).toMatch(/already the current/);
    expect(checkAmount("change", "0", 12).error).toMatch(/whole number/);
    expect(checkAmount("change", "-13", 12).error).toMatch(/below zero/);
  });
});

describe("AdjustStockDialog", () => {
  it("sets the counted total (newQty) with a reason and note", async () => {
    const { onAdjusted, onClose, queryClient, rendered } = setup();
    const { api } = await rendered;
    await screen.findByRole("dialog");

    await userEvent.type(screen.getByLabelText("Counted quantity"), "7");
    expect(screen.getByRole("status")).toHaveTextContent("12 → 7 tabs (-5)");
    await userEvent.selectOptions(
      screen.getByLabelText("Reason"),
      "count_correction"
    );
    await userEvent.type(screen.getByLabelText("Note (optional)"), "Recount");
    await userEvent.click(
      screen.getByRole("button", { name: "Save adjustment" })
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [call] = api.callsTo("POST /api/batches/:id/adjust");
    expect(call.params.id).toBe("b-1");
    expect(call.body).toEqual({
      newQty: 7,
      note: "Recount",
      reason: "count_correction",
    });
    expect(onAdjusted).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 7 })
    );
    expect(queryClient.getQueryState(expiryKeys.summary)?.isInvalidated).toBe(
      true
    );
  });

  it("adds or removes units (delta) when that mode is chosen", async () => {
    const { rendered } = setup();
    const { api } = await rendered;
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("radio", { name: "Add or remove" }));
    await userEvent.type(screen.getByLabelText("Change (+ or −)"), "-3");
    expect(screen.getByRole("status")).toHaveTextContent("12 → 9 tabs (-3)");
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "damaged");
    await userEvent.click(
      screen.getByRole("button", { name: "Save adjustment" })
    );

    await waitFor(() =>
      expect(api.callsTo("POST /api/batches/:id/adjust")).toHaveLength(1)
    );
    expect(api.callsTo("POST /api/batches/:id/adjust")[0].body).toEqual({
      delta: -3,
      note: "",
      reason: "damaged",
    });
  });

  it("shows errors only after submit and sends nothing while invalid", async () => {
    const { rendered } = setup();
    const { api } = await rendered;
    await screen.findByRole("dialog");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Save adjustment" })
    );
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      expect.stringContaining("whole number"),
      "Choose a reason.",
    ]);
    expect(api.callsTo("POST /api/batches/:id/adjust")).toHaveLength(0);
  });

  it("refuses to go below zero", async () => {
    const { rendered } = setup();
    const { api } = await rendered;
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("radio", { name: "Add or remove" }));
    await userEvent.type(screen.getByLabelText("Change (+ or −)"), "-99");
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "other");
    await userEvent.click(
      screen.getByRole("button", { name: "Save adjustment" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only 12 on hand"
    );
    expect(api.callsTo("POST /api/batches/:id/adjust")).toHaveLength(0);
  });

  it("stays open and says so when the stock changed underneath", async () => {
    const { onClose, rendered } = setup({
      "POST /api/batches/:id/adjust": () =>
        failure(
          409,
          "stock_conflict",
          "The stock changed while you were working."
        ),
    });
    await rendered;
    await screen.findByRole("dialog");
    await userEvent.type(screen.getByLabelText("Counted quantity"), "7");
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "found");
    await userEvent.click(
      screen.getByRole("button", { name: "Save adjustment" })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The stock changed while you were working."
      )
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
