import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeBatch, makeItem } from "@/features/inventory/test-data";
import { created, failure, page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { AddStockPage } from "./add-stock-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const PARACETAMOL = makeItem({ displayName: "Paracetamol 500 mg", id: "p1" });
const SUGGESTION = "PAR-261112-01";

function baseHandlers(extra: Record<string, () => unknown> = {}) {
  return {
    "GET /api/batches/suggest-number": () => ({ batchNumber: SUGGESTION }),
    "GET /api/categories": () => [],
    "GET /api/items": () => page([PARACETAMOL]),
    ...extra,
  };
}

function renderAdd(extra: Record<string, unknown> = {}, role = "inventory") {
  return renderWithProviders(<AddStockPage />, {
    handlers: baseHandlers(extra as Record<string, () => unknown>),
    me: makeMe(role as Parameters<typeof makeMe>[0]),
  });
}

async function pickParacetamol() {
  await userEvent.type(
    screen.getByLabelText("Find an existing product"),
    "para"
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /Paracetamol 500 mg/ })
  );
}

function setDate(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("AddStockPage", () => {
  it("suggests a batch number when a product is chosen and on request", async () => {
    const { api } = await renderAdd();
    await pickParacetamol();

    await waitFor(() =>
      expect(screen.getByLabelText("Batch 1 number")).toHaveValue(SUGGESTION)
    );
    expect(api.callsTo("GET /api/batches/suggest-number")[0].query.itemId).toBe(
      "p1"
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Add another batch" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Suggest Batch 2 number" })
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Batch 2 number")).toHaveValue(
        "PAR-261112-02"
      )
    );
  });

  it("removes a batch row", async () => {
    await renderAdd();
    await userEvent.click(
      screen.getByRole("button", { name: "Add another batch" })
    );
    expect(screen.getAllByRole("group", { name: /^Batch \d$/ })).toHaveLength(
      2
    );

    await userEvent.type(screen.getByLabelText("Batch 2 quantity"), "7");
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Batch 1" })
    );

    expect(screen.getAllByRole("group", { name: /^Batch \d$/ })).toHaveLength(
      1
    );
    expect(screen.getByLabelText("Batch 1 quantity")).toHaveValue(7);
  });

  it("keeps one empty row when the last row is removed", async () => {
    await renderAdd();
    await userEvent.type(screen.getByLabelText("Batch 1 quantity"), "4");
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Batch 1" })
    );
    expect(screen.getByLabelText("Batch 1 quantity")).toHaveValue(null);
  });

  it("shows validation messages only after the user presses Review", async () => {
    await renderAdd();
    await pickParacetamol();
    await userEvent.clear(screen.getByLabelText("Batch 1 number"));
    expect(screen.queryByRole("alert")).toBeNull();

    await userEvent.type(screen.getByLabelText("Batch 1 quantity"), "0");
    expect(screen.queryByRole("alert")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    const alerts = (await screen.findAllByRole("alert")).map(
      (a) => a.textContent
    );
    expect(alerts).toEqual(
      expect.arrayContaining([
        "Enter a real expiry date.",
        "Enter a whole quantity of 1 or more.",
      ])
    );
    expect(screen.queryByRole("region", { name: "Review" })).toBeNull();
  });

  it("asks to choose a product when none is selected", async () => {
    await renderAdd();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(
      await screen.findByText(/Choose the product you are receiving/)
    ).toBeInTheDocument();
  });

  it("reviews and saves a batch for an existing product", async () => {
    const { api } = await renderAdd({
      "POST /api/items/:id/batches": () =>
        created({
          batch: makeBatch({ id: "nb" }),
          merged: false,
          warnings: [],
        }),
    });
    await pickParacetamol();
    setDate("Batch 1 expiry date", "2099-05-01");
    await userEvent.type(screen.getByLabelText("Batch 1 quantity"), "25");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));

    const review = await screen.findByRole("region", { name: "Review" });
    expect(within(review).getByText(SUGGESTION)).toBeInTheDocument();
    expect(
      within(review).getByText(/Receiving 25 of Paracetamol 500 mg in 1 batch/)
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save stock" }));
    await waitFor(() =>
      expect(api.callsTo("POST /api/items/:id/batches")).toHaveLength(1)
    );
    const [call] = api.callsTo("POST /api/items/:id/batches");
    expect(call.params.id).toBe("p1");
    expect(call.body).toEqual({
      batchNumber: SUGGESTION,
      expiry: "2099-05-01",
      itemId: undefined,
      mergeIntoExisting: false,
      qty: 25,
      supplier: "",
    });
    expect(
      await screen.findByText(/Saved 1 batch of Paracetamol 500 mg/)
    ).toBeInTheDocument();
  });

  it("warns on review when an expiry date has already passed", async () => {
    await renderAdd();
    await pickParacetamol();
    setDate("Batch 1 expiry date", "2000-01-01");
    expect(screen.getByText(/already passed/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Batch 1 quantity"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(
      await screen.findByText(
        /already past their expiry date|already past its expiry date/
      )
    ).toBeInTheDocument();
  });

  it("offers to add to the existing batch when the number is a duplicate", async () => {
    let calls = 0;
    const { api } = await renderAdd({
      "POST /api/items/:id/batches": () => {
        calls += 1;
        return calls === 1
          ? failure(409, "duplicate_batch", "Batch exists.", {
              existingBatchId: "eb",
              existingBatchNumber: SUGGESTION,
              existingQty: 12,
            })
          : {
              batch: makeBatch({ id: "eb", qty: 37 }),
              merged: true,
              warnings: [],
            };
      },
    });
    await pickParacetamol();
    setDate("Batch 1 expiry date", "2099-05-01");
    await userEvent.type(screen.getByLabelText("Batch 1 quantity"), "25");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Save stock" })
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(`Batch ${SUGGESTION} already exists`);
    expect(dialog).toHaveTextContent("12 in stock");

    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Add quantity to existing batch",
      })
    );
    await waitFor(() =>
      expect(api.callsTo("POST /api/items/:id/batches")).toHaveLength(2)
    );
    const calls2 = api.callsTo("POST /api/items/:id/batches");
    expect(calls2[0].body).toMatchObject({ mergeIntoExisting: false });
    expect(calls2[1].body).toMatchObject({ mergeIntoExisting: true, qty: 25 });
    expect(await screen.findByText(/Saved 1 batch of/)).toBeInTheDocument();
  });

  it("lets the user pick another number instead of merging", async () => {
    await renderAdd({
      "POST /api/items/:id/batches": () =>
        failure(409, "duplicate_batch", "Batch exists.", {
          existingBatchNumber: SUGGESTION,
          existingQty: 3,
        }),
    });
    await pickParacetamol();
    setDate("Batch 1 expiry date", "2099-05-01");
    await userEvent.type(screen.getByLabelText("Batch 1 quantity"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Save stock" })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Change batch number" })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Batch 1 number")).toHaveValue(SUGGESTION);
  });

  it("creates a new product with its first batch in one request", async () => {
    const { api } = await renderAdd({
      "POST /api/items": () =>
        created({
          item: {
            ...makeItem({ id: "new" }),
            batches: [makeBatch()],
            notes: "",
          },
          warnings: [],
        }),
    });
    await userEvent.click(screen.getByRole("button", { name: "New product" }));
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(
      await screen.findByText("Enter the product name.")
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Product name"), "Saline");
    await userEvent.type(screen.getByLabelText("Strength"), "0.9%");
    setDate("Batch 1 expiry date", "2099-05-01");
    await userEvent.type(screen.getByLabelText("Batch 1 quantity"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Save stock" })
    );

    await waitFor(() => expect(api.callsTo("POST /api/items")).toHaveLength(1));
    expect(api.callsTo("POST /api/items")[0].body).toMatchObject({
      batches: [{ batchNumber: "", expiry: "2099-05-01", qty: 10 }],
      hasExpiry: true,
      name: "Saline",
      strength: "0.9%",
      unit: "tab",
    });
  });

  it("offers the existing product when a new one is a duplicate", async () => {
    await renderAdd({
      "GET /api/items/:id": () => PARACETAMOL,
      "POST /api/items": () =>
        failure(
          409,
          "conflict",
          "An item with this name and strength already exists.",
          {
            existingItemId: "p1",
            field: "identity",
          }
        ),
    });
    await userEvent.click(screen.getByRole("button", { name: "New product" }));
    await userEvent.type(screen.getByLabelText("Product name"), "Paracetamol");
    setDate("Batch 1 expiry date", "2099-05-01");
    await userEvent.type(screen.getByLabelText("Batch 1 quantity"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Save stock" })
    );

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Add stock to the existing product" })
    );
    expect(await screen.findByText("Paracetamol 500 mg")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change product" })
    ).toBeInTheDocument();
  });

  it("hides the expiry field for products without expiry", async () => {
    await renderAdd();
    await userEvent.click(screen.getByRole("button", { name: "New product" }));
    expect(screen.getByLabelText("Batch 1 expiry date")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "This product has an expiry date" })
    );
    expect(screen.queryByLabelText("Batch 1 expiry date")).toBeNull();
  });

  it("checks pasted rows and reports each problem", async () => {
    const { api } = await renderAdd({
      "POST /api/items/bulk": () =>
        failure(400, "validation_error", "Some rows need attention.", {
          issues: [
            {
              field: "qty",
              message: "Use a whole number of 1 or more.",
              path: "rows.1.qty",
              row: 2,
            },
          ],
        }),
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Paste from spreadsheet" })
    );
    fireEvent.change(screen.getByLabelText("Pasted rows"), {
      target: {
        value:
          "name,strength,batch,expiry,qty\nGauze,,G-1,2027-01-01,5\nTape,,T-1,01/02/2027,x",
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Check rows" }));

    expect(
      await screen.findByText(/Row 2 \(qty\): Use a whole number/)
    ).toBeInTheDocument();
    const [call] = api.callsTo("POST /api/items/bulk");
    expect(call.body).toMatchObject({
      dryRun: true,
      rows: [
        { batchNumber: "G-1", expiry: "2027-01-01", name: "Gauze", qty: "5" },
        { batchNumber: "T-1", expiry: "2027-01-02", name: "Tape", qty: "x" },
      ],
    });
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });
});
