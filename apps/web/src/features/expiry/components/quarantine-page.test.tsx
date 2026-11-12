import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { makeDisposal, makeQuarantineRow } from "../test-data";
import { QuarantinePage } from "./quarantine-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const openItemDetail = vi.fn();

vi.mock("@/features/inventory/stock-item-detail-dialog-context", () => ({
  useStockItemDetailDialog: () => ({ openItemDetail }),
}));

const EXPIRED_LONG_AGO = "2000-01-01";

function renderPage(role: Parameters<typeof makeMe>[0], canDispose: boolean) {
  const rows = [
    makeQuarantineRow({
      batchId: "b-old",
      batchNumber: "OLD-9",
      canDispose,
      expiry: EXPIRED_LONG_AGO,
    }),
  ];
  const disposals = [
    makeDisposal({
      id: "d1",
      itemName: "Gauze",
      note: "Water damage",
      reason: "damaged",
    }),
    makeDisposal({
      batchNumber: "OLD-2",
      id: "d2",
      itemName: "Saline",
      reason: "expired",
    }),
  ];
  return renderWithProviders(<QuarantinePage />, {
    handlers: {
      "GET /api/disposals": () => page(disposals, { total: 2 }),
      "GET /api/quarantine": () => page(rows, { total: 1 }),
      "POST /api/batches/:id/dispose": () => makeDisposal({ batchId: "b-old" }),
    },
    me: makeMe(role),
  });
}

describe("QuarantinePage", () => {
  it("lists expired batches awaiting disposal with how overdue they are", async () => {
    await renderPage("pharmacist", true);
    const list = await screen.findByRole("list", {
      name: "Expired batches awaiting disposal",
    });
    const row = within(list);
    expect(row.getByText("Ibuprofen 200 mg")).toBeInTheDocument();
    expect(row.getByText("Batch OLD-9")).toBeInTheDocument();
    expect(row.getByText("Expired")).toBeInTheDocument();
    expect(row.getByText("· Expired 12d ago")).toBeInTheDocument();
    expect(
      await screen.findByText("1 batch awaiting disposal")
    ).toBeInTheDocument();
  });

  it("opens the dispose dialog, posts the reason and refreshes the list", async () => {
    const { api } = await renderPage("pharmacist", true);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Dispose batch OLD-9 of Ibuprofen 200 mg",
      })
    );
    expect(
      await screen.findByRole("heading", {
        name: "Dispose / write off batch OLD-9",
      })
    ).toBeInTheDocument();
    const before = api.callsTo("GET /api/quarantine").length;

    await userEvent.click(
      screen.getByRole("button", { name: "Dispose 6 tabs" })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/batches/:id/dispose")).toHaveLength(1)
    );
    expect(api.callsTo("POST /api/batches/:id/dispose")[0].body).toEqual({
      note: "",
      reason: "expired",
    });
    await waitFor(() =>
      expect(api.callsTo("GET /api/quarantine").length).toBeGreaterThan(before)
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("shows the disposals log with reasons and notes", async () => {
    await renderPage("admin", true);
    const log = within(
      await screen.findByRole("region", { name: "Recent disposals" })
    );
    expect(await log.findByText("Gauze")).toBeInTheDocument();
    expect(log.getByText("Water damage")).toBeInTheDocument();
    expect(log.getByText("Saline")).toBeInTheDocument();
    expect(log.getAllByRole("row")).toHaveLength(3);
  });

  it("is read-only for roles that cannot dispose, and hides the log from nurses", async () => {
    await renderPage("nurse", false);
    await screen.findByRole("list", {
      name: "Expired batches awaiting disposal",
    });
    expect(
      screen.queryByRole("button", { name: /^Dispose/ })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Recent disposals" })
    ).not.toBeInTheDocument();
  });

  it("lets a health admin read the log but not dispose", async () => {
    await renderPage("health_admin", false);
    await screen.findByRole("list", {
      name: "Expired batches awaiting disposal",
    });
    expect(
      screen.queryByRole("button", { name: /^Dispose/ })
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: "Recent disposals" })
    ).toBeInTheDocument();
  });

  it("shows an empty state when nothing is expired", async () => {
    await renderWithProviders(<QuarantinePage />, {
      handlers: {
        "GET /api/disposals": () => page([], { total: 0 }),
        "GET /api/quarantine": () => page([], { total: 0 }),
      },
      me: makeMe("admin"),
    });
    expect(
      await screen.findByText("Nothing in quarantine")
    ).toBeInTheDocument();
    expect(await screen.findByText("No disposals yet")).toBeInTheDocument();
  });
});
