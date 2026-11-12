import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { makeRecord } from "../test-data";
import { DispensingPage } from "./dispensing-page";

const QUEUE = makeRecord({
  itemName: "Aspirin 100 mg",
  lines: [
    {
      batchId: "b1",
      batchNumber: "LOT-A",
      expiry: "2026-12-01",
      id: "l1",
      qty: 3,
    },
    {
      batchId: "b2",
      batchNumber: "LOT-B",
      expiry: "2027-02-01",
      id: "l2",
      qty: 2,
    },
  ],
  qty: 5,
  requestCode: "REQ-2026-0001",
});
const QUICK = makeRecord({
  itemName: "Gauze pad",
  qty: 2,
  recipientName: "Ben",
  source: "quick_deduct",
});

const HANDLERS = {
  "GET /api/dispensing": () => page([QUEUE, QUICK], { total: 2 }),
  "GET /api/dispensing/monthly": () => ({
    items: [
      {
        batches: [
          {
            batchId: "b1",
            batchNumber: "LOT-A",
            expiry: "2026-12-01",
            qty: 4,
            records: 2,
          },
          {
            batchId: "b2",
            batchNumber: "LOT-B",
            expiry: "2027-02-01",
            qty: 2,
            records: 1,
          },
        ],
        itemId: "item-1",
        itemName: "Aspirin 100 mg",
        totalQty: 6,
        unit: "tab",
      },
    ],
    month: "2026-11",
    timezone: "Asia/Manila",
    totalQty: 6,
  }),
};

describe("DispensingPage", () => {
  it("lists records with their batches and marks Quick Deduct", async () => {
    await renderWithProviders(<DispensingPage />, {
      handlers: HANDLERS,
      me: makeMe("pharmacist"),
    });
    const table = await screen.findByRole("table", { name: /Dispensing log/ });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("LOT-A, LOT-B")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/REQ-2026-0001/)).toBeInTheDocument();
    expect(within(rows[2]).getByText("Quick deduct")).toBeInTheDocument();
    expect(screen.getByText(/2 records · page 1 of 1/)).toBeInTheDocument();
  });

  it("sends the filters to the API and resets to the first page", async () => {
    const { api } = await renderWithProviders(<DispensingPage />, {
      handlers: HANDLERS,
      me: makeMe("admin"),
    });
    await screen.findByRole("table", { name: /Dispensing log/ });

    await userEvent.selectOptions(
      screen.getByLabelText("Source"),
      "quick_deduct"
    );
    await userEvent.type(screen.getByLabelText("From"), "2026-11-01");
    await userEvent.click(screen.getByLabelText("Show undone"));
    await userEvent.type(screen.getByLabelText("Search dispensing"), "gauze");

    await waitFor(() => {
      const last = api.callsTo("GET /api/dispensing").at(-1);
      expect(last?.query).toMatchObject({
        from: "2026-11-01",
        includeUndone: "1",
        search: "gauze",
        source: "quick_deduct",
      });
    });
    expect(api.callsTo("GET /api/dispensing")[0].query.limit).toBe("50");
  });

  it("opens a record to show the batches taken", async () => {
    await renderWithProviders(<DispensingPage />, {
      handlers: HANDLERS,
      me: makeMe("pharmacist"),
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Aspirin 100 mg" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Batch LOT-A")).toBeInTheDocument();
    expect(within(dialog).getByText("Batch LOT-B")).toBeInTheDocument();
  });

  it("shows the month view per batch", async () => {
    const { api } = await renderWithProviders(<DispensingPage />, {
      handlers: HANDLERS,
      me: makeMe("pharmacist"),
    });
    await screen.findByRole("table", { name: /Dispensing log/ });
    await userEvent.click(screen.getByRole("button", { name: "By month" }));

    const table = await screen.findByRole("table", {
      name: /per item and batch/,
    });
    expect(within(table).getByText("LOT-A")).toBeInTheDocument();
    expect(within(table).getByText("Total Aspirin 100 mg")).toBeInTheDocument();
    expect(within(table).getByText("6 tabs")).toBeInTheDocument();
    expect(api.callsTo("GET /api/dispensing/monthly")[0].query.month).toMatch(
      /^\d{4}-\d{2}$/
    );
  });
});
