import type { ExpiryRowDto } from "@shared/schemas/expiry";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeBatch, makeDetail, makeItem } from "@/features/inventory/test-data";
import { page } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { LabelsPage } from "./labels-page";

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const BATCH_ONE = makeBatch({ batchNumber: "LOT-1", code: "ABCDEFGHJK", id: "b1" });
const BATCH_TWO = makeBatch({
  batchNumber: "LOT-2",
  code: "23456789MN",
  expiry: "2027-06-01",
  id: "b2",
});
const ITEM = makeItem();
const DETAIL = makeDetail({ batches: [BATCH_ONE, BATCH_TWO] });

const EXPIRING_ROW: ExpiryRowDto = {
  batchId: "b9",
  batchNumber: "LOT-9",
  categoryId: null,
  categoryName: null,
  code: "ZZZZZZZZZZ",
  daysUntil: 10,
  displayName: "Ibuprofen 200 mg",
  expiry: "2026-11-22",
  expiryClass: "urgent",
  fefoRank: 1,
  itemId: "item-9",
  itemName: "Ibuprofen",
  qty: 5,
  quarantined: false,
  status: "active",
  unit: "tab",
};

const printSpy = vi.fn();

beforeEach(() => {
  printSpy.mockClear();
  toastMock.success.mockClear();
  vi.spyOn(window, "print").mockImplementation(printSpy);
});

function handlers(extra: Record<string, () => unknown> = {}) {
  return {
    "GET /api/batches/:id": () => BATCH_ONE,
    "GET /api/expiry": () => page([EXPIRING_ROW]),
    "GET /api/items": () => page([ITEM]),
    "GET /api/items/:id": () => DETAIL,
    ...extra,
  };
}

async function renderLabels(props: { initialBatchId?: string } = {}) {
  const view = await renderWithProviders(<LabelsPage {...props} />, {
    handlers: handlers(),
    me: makeMe("admin"),
    route: "/labels",
  });
  return { ...view, preview: screen.getByRole("region", { name: "Label preview" }) };
}

async function chooseBothBatches(): Promise<void> {
  await userEvent.type(screen.getByLabelText("Search items"), "para");
  await userEvent.click(await screen.findByRole("button", { name: "Paracetamol 500 mg" }));
  await userEvent.click(await screen.findByRole("checkbox", { name: /LOT-1/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: /LOT-2/ }));
}

describe("LabelsPage", () => {
  it("starts empty with printing disabled", async () => {
    const { preview } = await renderLabels();
    expect(within(preview).getByText("No labels to print.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print labels" })).toBeDisabled();
    expect(within(preview).queryAllByTestId("label")).toHaveLength(0);
  });

  it("previews one label per chosen batch with product, lot, expiry, QR and short code", async () => {
    const { api, preview } = await renderLabels();
    await chooseBothBatches();

    expect(api.callsTo("GET /api/items")[0].query).toMatchObject({ search: "para" });
    const labels = within(preview).getAllByTestId("label");
    expect(labels).toHaveLength(2);
    const first = within(labels[0]);
    expect(first.getByText("Paracetamol 500 mg")).toBeInTheDocument();
    expect(first.getByText("Lot LOT-1")).toBeInTheDocument();
    expect(first.getByText("Exp 12 Mar 2027")).toBeInTheDocument();
    expect(first.getByText("ABCDE-FGHJK")).toBeInTheDocument();
    expect(within(preview).getByText("2 labels on 2 pages.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print labels" })).toBeEnabled();
  });

  it("encodes only the batch code in the QR", async () => {
    const { preview } = await renderLabels();
    await chooseBothBatches();
    const codes = within(preview)
      .getAllByRole("img")
      .map((svg) => svg.getAttribute("aria-label"));
    expect(codes).toEqual(["QR code for batch ABCDEFGHJK", "QR code for batch 23456789MN"]);
    for (const svg of within(preview).getAllByRole("img")) {
      expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M\d/);
    }
  });

  it("packs 24 labels on an A4 sheet and one per page on a roll", async () => {
    const { preview } = await renderLabels();
    await chooseBothBatches();
    expect(within(preview).getAllByTestId("label-sheet")).toHaveLength(2);

    await userEvent.click(screen.getByRole("radio", { name: /A4 sheet 3 × 8/ }));
    expect(within(preview).getAllByTestId("label-sheet")).toHaveLength(1);
    expect(within(preview).getAllByTestId("label")).toHaveLength(2);
    expect(within(preview).getByText("2 labels on 1 page.")).toBeInTheDocument();
    expect(document.querySelector("style")?.textContent).toContain("size: 210mm 297mm");
  });

  it("multiplies labels by the number of copies", async () => {
    const { preview } = await renderLabels();
    await chooseBothBatches();
    fireEvent.change(screen.getByLabelText("Copies of each label"), { target: { value: "3" } });
    expect(within(preview).getAllByTestId("label")).toHaveLength(6);
  });

  it("prints a copy of the sheets outside the app shell", async () => {
    await renderLabels();
    await chooseBothBatches();
    await userEvent.click(screen.getByRole("button", { name: "Print labels" }));
    expect(printSpy).toHaveBeenCalledOnce();
    const printRoot = screen.getByTestId("label-print-root");
    expect(printRoot.parentElement).toBe(document.body);
    expect(within(printRoot).getAllByTestId("label")).toHaveLength(2);
  });

  it("starts with the batch from ?batch=", async () => {
    const { api, preview } = await renderLabels({ initialBatchId: "b1" });
    await waitFor(() => expect(within(preview).getAllByTestId("label")).toHaveLength(1));
    expect(api.callsTo("GET /api/batches/:id")[0].params.id).toBe("b1");
    expect(within(preview).getByText("Lot LOT-1")).toBeInTheDocument();
  });

  it("adds the batches expiring soon once, without duplicating them on a second click", async () => {
    const { preview } = await renderLabels();
    const add = screen.getByRole("button", { name: "Add batches expiring soon" });
    await userEvent.click(add);
    await waitFor(() => expect(within(preview).getAllByTestId("label")).toHaveLength(1));
    expect(within(preview).getByText("Ibuprofen 200 mg")).toBeInTheDocument();
    await userEvent.click(add);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(2));
    expect(within(preview).getAllByTestId("label")).toHaveLength(1);
  });

  it("removes a chosen batch", async () => {
    const { preview } = await renderLabels();
    await chooseBothBatches();
    await userEvent.click(screen.getByRole("button", { name: "Remove Paracetamol LOT-1" }));
    expect(within(preview).getAllByTestId("label")).toHaveLength(1);
    expect(within(preview).queryByText("Lot LOT-1")).not.toBeInTheDocument();
  });

  it("cuts a very long product name on the label", async () => {
    const long = makeItem({
      displayName: "Extended release metformin hydrochloride 500 mg",
      name: "Extended release metformin hydrochloride",
    });
    const view = await renderWithProviders(<LabelsPage />, {
      handlers: handlers({
        "GET /api/items": () => page([long]),
        "GET /api/items/:id": () => makeDetail({ ...long, batches: [BATCH_ONE] }),
      }),
      me: makeMe("admin"),
    });
    await userEvent.type(screen.getByLabelText("Search items"), "met");
    await userEvent.click(await screen.findByRole("button", { name: /Extended release/ }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /LOT-1/ }));
    const preview = screen.getByRole("region", { name: "Label preview" });
    const title = within(within(preview).getByTestId("label")).getByText(/…/);
    expect(title.textContent?.length).toBeLessThanOrEqual(28);
    expect(title.textContent?.endsWith("500 mg")).toBe(true);
    view.unmount();
  });
});
