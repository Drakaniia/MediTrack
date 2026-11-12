import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { expiryKeys } from "../hooks/expiry-queries";
import { makeDisposal } from "../test-data";
import { DisposeDialog, type DisposeDialogBatch } from "./dispose-dialog";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const LIVE: DisposeDialogBatch = {
  batchId: "b-live",
  batchNumber: "LIVE-1",
  displayName: "Paracetamol 500 mg",
  expiry: "2999-01-01",
  qty: 12,
  unit: "tab",
};

const EXPIRED: DisposeDialogBatch = {
  ...LIVE,
  batchId: "b-old",
  batchNumber: "OLD-1",
  expiry: "2000-01-01",
};

function setup(batch: DisposeDialogBatch, handlers = {}) {
  const onClose = vi.fn();
  const onDisposed = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
  queryClient.setQueryData(expiryKeys.summary, { stale: true });
  const rendered = renderWithProviders(
    <DisposeDialog batch={batch} onClose={onClose} onDisposed={onDisposed} />,
    {
      handlers: {
        "POST /api/batches/:id/dispose": () =>
          makeDisposal({ batchId: batch.batchId, qty: batch.qty }),
        ...handlers,
      },
      me: makeMe("pharmacist"),
      queryClient,
    }
  );
  return { onClose, onDisposed, queryClient, rendered };
}

describe("DisposeDialog", () => {
  it("states what will be written off", async () => {
    const { rendered } = setup(LIVE);
    const { api } = await rendered;
    expect(
      await screen.findByRole("heading", {
        name: "Dispose / write off batch LIVE-1",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/All 12 tabs left in this batch will be written off/)
    ).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("requires a reason, and only complains after submit", async () => {
    const { rendered } = setup(LIVE);
    const { api } = await rendered;
    await screen.findByRole("dialog");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Dispose 12 tabs" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a reason."
    );
    expect(api.callsTo("POST /api/batches/:id/dispose")).toHaveLength(0);
  });

  it("posts the reason and note, closes and refreshes stock data", async () => {
    const { onClose, onDisposed, queryClient, rendered } = setup(LIVE);
    const { api } = await rendered;
    await screen.findByRole("dialog");

    await userEvent.selectOptions(screen.getByLabelText("Reason"), "damaged");
    await userEvent.type(
      screen.getByLabelText("Note (optional)"),
      "Box crushed"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Dispose 12 tabs" })
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [call] = api.callsTo("POST /api/batches/:id/dispose");
    expect(call.params.id).toBe("b-live");
    expect(call.body).toEqual({ note: "Box crushed", reason: "damaged" });
    expect(onDisposed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "disposal-1" })
    );
    expect(queryClient.getQueryState(expiryKeys.summary)?.isInvalidated).toBe(
      true
    );
  });

  it("offers 'Expired' only for a batch that has expired, and preselects it", async () => {
    const { rendered } = setup(EXPIRED);
    const { api } = await rendered;
    await screen.findByRole("dialog");
    const select = screen.getByLabelText("Reason");
    expect(select).toHaveValue("expired");
    expect(
      within(select).getByRole("option", { name: "Expired" })
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Dispose 12 tabs" })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/batches/:id/dispose")[0]?.body).toEqual({
        note: "",
        reason: "expired",
      })
    );
  });

  it("does not offer 'Expired' for a batch that is still in date", async () => {
    const { rendered } = setup(LIVE);
    await rendered;
    await screen.findByRole("dialog");
    const select = screen.getByLabelText("Reason");
    expect(select).toHaveValue("");
    expect(
      within(select).queryByRole("option", { name: "Expired" })
    ).not.toBeInTheDocument();
    for (const name of ["Damaged", "Recalled", "Other"]) {
      expect(within(select).getByRole("option", { name })).toBeInTheDocument();
    }
  });

  it("keeps the dialog open and shows the server's reason error", async () => {
    const { onClose, rendered } = setup(EXPIRED, {
      "POST /api/batches/:id/dispose": () =>
        failure(400, "validation_error", "The request is not valid.", {
          issues: [{ message: "Batch has not expired", path: "reason" }],
        }),
    });
    await rendered;
    await screen.findByRole("dialog");
    await userEvent.click(
      screen.getByRole("button", { name: "Dispose 12 tabs" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Batch has not expired"
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
