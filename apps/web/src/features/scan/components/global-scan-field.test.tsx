import type { ScanResult } from "@shared/schemas/scan";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeBatch, makeItem } from "@/features/inventory/test-data";
import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { GlobalScanField } from "./global-scan-field";

const openItemDetail = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/features/inventory/stock-item-detail-dialog-context", () => ({
  useStockItemDetailDialog: () => ({ openItemDetail }),
}));

const ITEM = makeItem();
const BATCH = makeBatch();

const BATCH_RESULT: ScanResult = {
  allowedActions: ["view"],
  batch: BATCH,
  fefoBatch: BATCH,
  item: ITEM,
  kind: "batch",
};

beforeEach(() => {
  openItemDetail.mockClear();
  toastMock.error.mockClear();
  toastMock.success.mockClear();
});

function notFound(canRegister: boolean) {
  return () =>
    failure(404, "scan_not_found", "No item or batch matches that code.", {
      canRegister,
      code: "ZZZ-404",
    });
}

async function renderField(
  handler: () => unknown,
  role: Parameters<typeof makeMe>[0] = "admin"
) {
  const view = await renderWithProviders(<GlobalScanField />, {
    handlers: { "GET /api/scan": handler },
    me: makeMe(role),
  });
  return { ...view, field: screen.getByLabelText("Scan or enter code") };
}

describe("GlobalScanField", () => {
  it("opens the item detail on the scanned batch and says so", async () => {
    const { api, field } = await renderField(() => BATCH_RESULT);
    await userEvent.type(field, "ABCDEFGHJK{Enter}");

    await waitFor(() =>
      expect(openItemDetail).toHaveBeenCalledExactlyOnceWith("item-1", {
        batchId: "batch-1",
      })
    );
    expect(api.callsTo("GET /api/scan")[0].query.code).toBe("ABCDEFGHJK");
    expect(toastMock.success).toHaveBeenCalledWith(
      "Found Paracetamol 500 mg · LOT-1"
    );
    expect(await screen.findByText("Found Paracetamol 500 mg, batch LOT-1.")).toBeInTheDocument();
  });

  it("clears and refocuses the field after a scan", async () => {
    const { field } = await renderField(() => BATCH_RESULT);
    await userEvent.type(field, "ABCDEFGHJK{Enter}");
    await waitFor(() => expect(openItemDetail).toHaveBeenCalled());
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
  });

  it("opens the item for an item scan", async () => {
    const { field } = await renderField(() => ({
      allowedActions: ["view"],
      fefoBatch: BATCH,
      item: ITEM,
      kind: "item",
    }));
    await userEvent.type(field, "5000000000017{Enter}");
    await waitFor(() =>
      expect(openItemDetail).toHaveBeenCalledExactlyOnceWith("item-1")
    );
    expect(toastMock.success).toHaveBeenCalledWith("Found Paracetamol 500 mg");
  });

  it("offers a chooser for an ambiguous code and opens the picked item", async () => {
    const other = makeItem({ displayName: "Gauze", id: "item-2", name: "Gauze" });
    const { field } = await renderField(() => ({
      items: [ITEM, other],
      kind: "ambiguous",
    }));
    await userEvent.type(field, "AMBIG{Enter}");

    const list = await screen.findByRole("list", { name: "Matching items" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(openItemDetail).not.toHaveBeenCalled();
    await userEvent.click(within(list).getByRole("button", { name: /Gauze/ }));
    expect(openItemDetail).toHaveBeenCalledExactlyOnceWith("item-2");
    expect(screen.queryByRole("list", { name: "Matching items" })).not.toBeInTheDocument();
  });

  it("says the code was not found and lets an admin register it", async () => {
    const { field, router } = await renderField(notFound(true));
    await userEvent.type(field, "ZZZ-404{Enter}");

    expect(await screen.findByText("Code not found")).toBeInTheDocument();
    expect(openItemDetail).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Register this code" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/inventory/add")
    );
    expect(router.state.location.search).toMatchObject({ code: "ZZZ-404" });
  });

  it("does not offer to register for a role that cannot", async () => {
    const { field } = await renderField(notFound(false), "nurse");
    await userEvent.type(field, "ZZZ-404{Enter}");
    expect(await screen.findByText("Code not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Register this code" })).not.toBeInTheDocument();
  });

  it("dismisses the not-found message and returns focus to the field", async () => {
    const { field } = await renderField(notFound(true));
    await userEvent.type(field, "ZZZ-404{Enter}");
    await screen.findByText("Code not found");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss scan result" }));
    expect(screen.queryByText("Code not found")).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it("never looks up a partial code: only Enter submits", async () => {
    const { api, field } = await renderField(() => BATCH_RESULT);
    await userEvent.type(field, "ABCDEFGH");
    await userEvent.tab();
    expect(api.callsTo("GET /api/scan")).toHaveLength(0);
    expect(field).toHaveValue("ABCDEFGH");
  });

  it("ignores Enter on an empty field", async () => {
    const { api, field } = await renderField(() => BATCH_RESULT);
    await userEvent.type(field, "   {Enter}");
    expect(api.callsTo("GET /api/scan")).toHaveLength(0);
  });

  it("focuses the field with the / key", async () => {
    const { field } = await renderField(() => BATCH_RESULT);
    document.body.focus();
    await userEvent.keyboard("/");
    expect(field).toHaveFocus();
    expect(field).toHaveValue("");
  });

  it("focuses the field with Ctrl+Shift+S", async () => {
    const { field } = await renderField(() => BATCH_RESULT);
    document.body.focus();
    await userEvent.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    expect(field).toHaveFocus();
  });

  it("reports a failed lookup with a toast and keeps working", async () => {
    const { field } = await renderField(() =>
      failure(500, "internal_error", "Something broke.")
    );
    await userEvent.type(field, "ABCDEFGHJK{Enter}");
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Something broke."));
    expect(openItemDetail).not.toHaveBeenCalled();
  });
});
