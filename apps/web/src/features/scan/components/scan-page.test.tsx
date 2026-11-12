import type { ScanBatchResult, ScanItemResult, ScanResult } from "@shared/schemas/scan";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeBatch, makeItem } from "@/features/inventory/test-data";
import { failure } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { ScanPage } from "./scan-page";

const openItemDetail = vi.hoisted(() => vi.fn());
const openNewRequest = vi.hoisted(() => vi.fn());
const openQuickDeduct = vi.hoisted(() => vi.fn());

vi.mock("@/features/inventory/stock-item-detail-dialog-context", () => ({
  useStockItemDetailDialog: () => ({ openItemDetail }),
}));
vi.mock("@/features/requests/new-request-dialog-context", () => ({
  useNewRequestDialog: () => ({ openNewRequest }),
}));
vi.mock("@/features/requests/quick-deduct-dialog-context", () => ({
  useQuickDeductDialog: () => ({ openQuickDeduct }),
}));

const ITEM = makeItem();
const FIRST = makeBatch({ batchNumber: "LOT-1", code: "AAAAAAAAAA", id: "b1" });
const SECOND = makeBatch({
  batchNumber: "LOT-2",
  code: "BBBBBBBBBB",
  daysUntil: 200,
  expiry: "2027-06-01",
  fefoRank: 2,
  id: "b2",
});
const EXPIRED = makeBatch({
  batchNumber: "LOT-OLD",
  code: "CCCCCCCCCC",
  daysUntil: -12,
  expiry: "2026-10-31",
  expiryClass: "expired",
  fefoRank: null,
  id: "b3",
  quarantined: true,
});

const ALL_ACTIONS = ["view", "request", "quick_deduct", "label", "edit"] as const;
const NURSE_ACTIONS = ["view", "request", "quick_deduct"] as const;

function batchResult(
  batch: typeof FIRST,
  actions: readonly string[] = ALL_ACTIONS
): ScanBatchResult {
  return {
    allowedActions: [...actions] as ScanBatchResult["allowedActions"],
    batch,
    fefoBatch: batch.fefoRank === 1 ? batch : FIRST,
    item: ITEM,
    kind: "batch",
  };
}

beforeEach(() => {
  openItemDetail.mockClear();
  openNewRequest.mockClear();
  openQuickDeduct.mockClear();
});

type Responses = Record<string, ScanResult>;

async function renderPage(
  responses: Responses,
  options: { canRegister?: boolean; role?: Parameters<typeof makeMe>[0] } = {}
) {
  const view = await renderWithProviders(<ScanPage />, {
    handlers: {
      "GET /api/scan": (request) =>
        responses[request.query.code] ??
        failure(404, "scan_not_found", "No item or batch matches that code.", {
          canRegister: options.canRegister ?? true,
          code: request.query.code,
        }),
    },
    me: makeMe(options.role ?? "admin"),
    route: "/scan",
  });
  return { ...view, input: screen.getByLabelText("Scan or enter a code") };
}

async function scan(input: HTMLElement, code: string): Promise<void> {
  await userEvent.click(input);
  await userEvent.paste(code);
  await userEvent.keyboard("{Enter}");
}

describe("ScanPage", () => {
  it("starts ready and focused, with nothing scanned", async () => {
    const { input } = await renderPage({});
    expect(screen.getByRole("heading", { level: 1, name: "Scan" })).toBeInTheDocument();
    expect(screen.getByText("Scanner ready")).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(screen.getByText("Nothing scanned yet this session.")).toBeInTheDocument();
  });

  it("shows the scanned batch with expiry, quantity and the use-first answer", async () => {
    const { input } = await renderPage({ AAAAAAAAAA: batchResult(FIRST) });
    await scan(input, "AAAAAAAAAA");

    const card = await screen.findByRole("article", { name: "Scanned: Paracetamol 500 mg" });
    expect(within(card).getByText("LOT-1")).toBeInTheDocument();
    expect(within(card).getByText("40 tabs")).toBeInTheDocument();
    expect(within(card).getByText("12 Mar 2027")).toBeInTheDocument();
    expect(within(card).getByText("Safe")).toBeInTheDocument();
    expect(within(card).getByText("AAAAA-AAAAA")).toBeInTheDocument();
    expect(within(card).getByText("Use this batch first: yes.")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("names the batch to use first when the scanned one is not rank 1", async () => {
    const { input } = await renderPage({ BBBBBBBBBB: batchResult(SECOND) });
    await scan(input, "BBBBBBBBBB");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Use batch LOT-1 first.")).toBeInTheDocument();
    expect(alert).toHaveTextContent("#2 in FEFO order");
  });

  it("warns that expired stock must not be dispensed", async () => {
    const { input } = await renderPage({ CCCCCCCCCC: batchResult(EXPIRED) });
    await scan(input, "CCCCCCCCCC");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Expired stock: do not dispense");
    expect(alert).toHaveTextContent("Use batch LOT-1 first");
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("shows the batch to use first for an item scan", async () => {
    const result: ScanItemResult = {
      allowedActions: ["view", "request"],
      fefoBatch: FIRST,
      item: ITEM,
      kind: "item",
    };
    const { input } = await renderPage({ SKU1: result });
    await scan(input, "SKU1");
    expect(await screen.findByText("Item scanned · Analgesic")).toBeInTheDocument();
    expect(screen.getByText("Use batch LOT-1 first.")).toBeInTheDocument();
  });

  it("offers every action to a role that holds them, and each one works", async () => {
    const { input } = await renderPage({ AAAAAAAAAA: batchResult(FIRST) });
    await scan(input, "AAAAAAAAAA");
    await screen.findByRole("article");

    await userEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(openItemDetail).toHaveBeenCalledExactlyOnceWith("item-1", { batchId: "b1" });
    await userEvent.click(screen.getByRole("button", { name: "New request for this stock" }));
    expect(openNewRequest).toHaveBeenCalledExactlyOnceWith({ itemId: "item-1" });
    await userEvent.click(screen.getByRole("button", { name: "Quick deduct" }));
    expect(openQuickDeduct).toHaveBeenCalledExactlyOnceWith({ itemId: "item-1" });
    expect(screen.getByRole("link", { name: "Print label" })).toHaveAttribute(
      "href",
      expect.stringContaining("/labels?batch=b1")
    );
  });

  it("hides the actions a role may not take", async () => {
    const { input } = await renderPage(
      { AAAAAAAAAA: batchResult(FIRST, NURSE_ACTIONS) },
      { role: "nurse" }
    );
    await scan(input, "AAAAAAAAAA");
    await screen.findByRole("article");
    expect(screen.getByRole("button", { name: "View details" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Print label" })).not.toBeInTheDocument();
  });

  it("explains an unknown code and lets an admin register it", async () => {
    const { input, router } = await renderPage({});
    await scan(input, "NOPE-1");
    expect(await screen.findByRole("heading", { name: "Code not found" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Register this code" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/inventory/add"));
    expect(router.state.location.search).toMatchObject({ code: "NOPE-1" });
  });

  it("does not offer Register to a role that cannot register", async () => {
    const { input } = await renderPage({}, { canRegister: false, role: "nurse" });
    await scan(input, "NOPE-1");
    await screen.findByRole("heading", { name: "Code not found" });
    expect(screen.queryByRole("button", { name: "Register this code" })).not.toBeInTheDocument();
  });

  it("lists the candidates of an ambiguous code", async () => {
    const other = makeItem({ displayName: "Gauze", id: "item-2", name: "Gauze" });
    const { input } = await renderPage({ AMBIG: { items: [ITEM, other], kind: "ambiguous" } });
    await scan(input, "AMBIG");
    const list = await screen.findByRole("list", { name: "Matching items" });
    await userEvent.click(within(list).getByRole("button", { name: "Gauze" }));
    expect(openItemDetail).toHaveBeenCalledExactlyOnceWith("item-2");
  });

  it("keeps the last ten scans, newest first, and looks one up again on click", async () => {
    const { api, input } = await renderPage({});
    for (let index = 1; index <= 12; index += 1) {
      await scan(input, `CODE-${index}`);
      await waitFor(() => expect(api.callsTo("GET /api/scan")).toHaveLength(index));
    }
    const list = await screen.findByRole("list", { name: "Recent scans" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(10));
    const entries = within(list).getAllByRole("button");
    expect(entries[0]).toHaveAccessibleName(/CODE-12/);
    expect(entries[9]).toHaveAccessibleName(/CODE-3\b/);

    await userEvent.click(entries[5]);
    await waitFor(() => expect(api.callsTo("GET /api/scan")).toHaveLength(13));
    expect(api.callsTo("GET /api/scan")[12].query.code).toBe("CODE-7");
  });

  it("looks up whatever is in the field when Look up is pressed", async () => {
    const { api, input } = await renderPage({});
    await userEvent.type(input, "TYPED-1");
    await userEvent.click(screen.getByRole("button", { name: "Look up" }));
    await waitFor(() => expect(api.callsTo("GET /api/scan")).toHaveLength(1));
    expect(api.callsTo("GET /api/scan")[0].query.code).toBe("TYPED-1");
  });

  it("catches a scanner burst even when the field is not focused", async () => {
    const { api } = await renderPage({});
    document.body.focus();
    for (const key of ["Z", "Z", "T", "O", "P", "Enter"]) {
      fireEvent.keyDown(document.body, { key });
    }
    await waitFor(() => expect(api.callsTo("GET /api/scan")).toHaveLength(1));
    expect(api.callsTo("GET /api/scan")[0].query.code).toBe("ZZTOP");
  });

  it("switches the field to inputmode none for handheld scanners and remembers it", async () => {
    const { input } = await renderPage({});
    expect(input).toHaveAttribute("inputmode", "text");
    await userEvent.click(screen.getByLabelText(/Handheld scanner mode/));
    expect(input).toHaveAttribute("inputmode", "none");
    expect(localStorage.getItem("meditract.scan.handheld")).toBe("1");
  });

  it("shows an error when the lookup itself fails", async () => {
    const view = await renderWithProviders(<ScanPage />, {
      handlers: { "GET /api/scan": () => failure(500, "internal_error", "Server on fire.") },
      me: makeMe("admin"),
    });
    await scan(view.container.querySelector("input") as HTMLElement, "ANYTHING");
    expect(await screen.findByRole("alert")).toHaveTextContent("Server on fire.");
  });
});
