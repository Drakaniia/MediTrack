import { monthOf } from "@shared/dates";
import type { Role } from "@shared/roles";
import type { DashboardDto } from "@shared/schemas/dashboard";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { failure, type MockApi } from "@/test/mock-api";
import { makeMe, renderWithProviders } from "@/test/render";

import { makeDashboard, makeDashboardFor } from "../test-data";
import { DashboardPage } from "./dashboard-page";

const openItemDetail = vi.fn();
const openNewRequest = vi.fn();
const openQuickDeduct = vi.fn();

vi.mock("@/features/inventory/stock-item-detail-dialog-context", () => ({
  useStockItemDetailDialog: () => ({ openItemDetail }),
}));
vi.mock("@/features/requests/new-request-dialog-context", () => ({
  useNewRequestDialog: () => ({ openNewRequest }),
}));
vi.mock("@/features/requests/quick-deduct-dialog-context", () => ({
  useQuickDeductDialog: () => ({ openQuickDeduct }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

interface Arranged {
  api: MockApi;
  month: string;
}

async function renderDashboard(
  role: Role,
  payload?: (month: string) => DashboardDto
): Promise<Arranged> {
  const me = makeMe(role);
  const month = monthOf(me.today);
  const { api } = await renderWithProviders(<DashboardPage />, {
    handlers: {
      "GET /api/dashboard": (req) =>
        payload
          ? payload(req.query.month)
          : makeDashboardFor(role, req.query.month),
    },
    me,
  });
  return { api, month };
}

async function heading(name: string | RegExp): Promise<HTMLElement> {
  return await screen.findByRole("heading", { name });
}

function queryHeading(name: string | RegExp): HTMLElement | null {
  return screen.queryByRole("heading", { name });
}

describe("DashboardPage — role-appropriate cards", () => {
  it.each(["admin", "inventory", "pharmacist", "health_admin"] as const)(
    "shows every card to the %s role",
    async (role) => {
      const { month } = await renderDashboard(role);
      await heading("Use first (FEFO)");
      expect(await heading("Requests")).toBeInTheDocument();
      expect(await heading(/^Expiring in /)).toBeInTheDocument();
      expect(await heading(/^Activity in /)).toBeInTheDocument();
      expect(await heading("Recent dispensing")).toBeInTheDocument();
      expect(month).toMatch(/^\d{4}-\d{2}$/);
    }
  );

  it("hides recent dispensing and activity from nurses, who still see availability", async () => {
    await renderDashboard("nurse");
    await heading("Use first (FEFO)");
    expect(await heading("Requests")).toBeInTheDocument();
    expect(await heading(/^Expiring in /)).toBeInTheDocument();
    expect(queryHeading("Recent dispensing")).not.toBeInTheDocument();
    expect(queryHeading(/^Activity in /)).not.toBeInTheDocument();
  });

  it("does not render a card whose permission the role lacks, even if the payload carries it", async () => {
    await renderDashboard("nurse", (month) => makeDashboard(month));
    await heading("Use first (FEFO)");
    expect(queryHeading("Recent dispensing")).not.toBeInTheDocument();
    expect(queryHeading(/^Activity in /)).not.toBeInTheDocument();
  });
});

describe("DashboardPage — stat cards", () => {
  it("shows the count of each class and links to the matching list", async () => {
    await renderDashboard("admin");
    const summary = within(
      await screen.findByRole("list", { name: "Stock summary" })
    );
    const links: [RegExp, string][] = [
      [/^Safe\s*30/, "/inventory/expiry?class=safe"],
      [/^Near Expiry\s*4/, "/inventory/expiry?class=near_expiry"],
      [/^Urgent\s*2/, "/inventory/expiry?class=urgent"],
      [/^Expired\s*1/, "/inventory/expiry?class=expired"],
      [/^Low stock\s*3/, "/inventory/low-stock"],
    ];
    for (const [name, href] of links) {
      expect(summary.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(summary.getByText(/45 units/)).toBeInTheDocument();
    expect(summary.getByText(/1 out of stock/)).toBeInTheDocument();
  });

  it("is available to the nurse role too", async () => {
    await renderDashboard("nurse");
    expect(
      await screen.findByRole("list", { name: "Stock summary" })
    ).toBeInTheDocument();
  });
});

describe("DashboardPage — request buttons", () => {
  it("opens the dialogs and shows the Ctrl+N / Ctrl+D hints", async () => {
    await renderDashboard("pharmacist");
    const newRequest = await screen.findByRole("button", { name: "New request" });
    const quickDeduct = screen.getByRole("button", { name: "Quick deduct" });
    expect(screen.getByText("Ctrl+N")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+D")).toBeInTheDocument();

    await userEvent.click(newRequest);
    expect(openNewRequest).toHaveBeenCalledTimes(1);
    await userEvent.click(quickDeduct);
    expect(openQuickDeduct).toHaveBeenCalledTimes(1);
  });

  it("hides the buttons from a role that may not use them", async () => {
    await renderDashboard("health_admin");
    await heading("Use first (FEFO)");
    expect(
      screen.queryByRole("button", { name: "New request" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Quick deduct" })
    ).not.toBeInTheDocument();
  });
});

describe("DashboardPage — month filter", () => {
  it("has month and year only, and refetches with ?month=", async () => {
    const { api, month } = await renderDashboard("admin");
    const group = await screen.findByRole("group", { name: "Month filter" });
    expect(within(group).getAllByRole("combobox")).toHaveLength(2);
    expect(within(group).getByLabelText("Month")).toBeInTheDocument();
    expect(within(group).getByLabelText("Year")).toBeInTheDocument();
    expect(group.querySelector('input[type="date"]')).toBeNull();
    expect(api.callsTo("GET /api/dashboard")[0].query.month).toBe(month);

    const year = month.slice(0, 4);
    const other = month.endsWith("-03") ? "April" : "March";
    const otherNumber = other === "March" ? "03" : "04";
    await userEvent.selectOptions(within(group).getByLabelText("Month"), other);

    await waitFor(() =>
      expect(api.callsTo("GET /api/dashboard").at(-1)?.query.month).toBe(
        `${year}-${otherNumber}`
      )
    );
    expect(await heading(`Expiring in ${other} ${year}`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "This month" }));
    await waitFor(() =>
      expect(api.callsTo("GET /api/dashboard").at(-1)?.query.month).toBe(month)
    );
    expect(
      screen.queryByRole("button", { name: "This month" })
    ).not.toBeInTheDocument();
  });

  it("changes the year without touching the month", async () => {
    const { api, month } = await renderDashboard("admin");
    const group = await screen.findByRole("group", { name: "Month filter" });
    const nextYear = String(Number(month.slice(0, 4)) + 1);
    await userEvent.selectOptions(within(group).getByLabelText("Year"), nextYear);
    await waitFor(() =>
      expect(api.callsTo("GET /api/dashboard").at(-1)?.query.month).toBe(
        `${nextYear}-${month.slice(5)}`
      )
    );
  });
});

describe("DashboardPage — lists", () => {
  it("opens the item detail on the recommended batch and links to the full FEFO list", async () => {
    await renderDashboard("admin");
    const list = within(await screen.findByRole("list", { name: "Use first" }));
    await userEvent.click(
      list.getByRole("button", { name: "Paracetamol 500 mg, batch LOT-1" })
    );
    expect(openItemDetail).toHaveBeenCalledWith("item-1", {
      batchId: "batch-1",
    });
    expect(
      screen.getByRole("link", { name: "View full list" })
    ).toHaveAttribute("href", "/inventory/fefo");
  });

  it("links the requests and dispensing cards to their pages", async () => {
    await renderDashboard("admin");
    expect(
      await screen.findByRole("link", { name: "Open request queue" })
    ).toHaveAttribute("href", "/requests");
    expect(
      screen.getByRole("link", { name: "Open dispensing log" })
    ).toHaveAttribute("href", "/dispensing");
    const pending = within(
      screen.getByRole("list", { name: "Oldest pending requests" })
    );
    expect(pending.getByText("Gauze")).toBeInTheDocument();
    expect(pending.getByText(/REQ-2026-0001 · Nurse Joy/)).toBeInTheDocument();
    const recent = within(screen.getByRole("list", { name: "Recent dispensing" }));
    expect(recent.getByText(/LOT-A × 2, LOT-B × 1/)).toBeInTheDocument();
    expect(recent.getByText("Dana Pharmacist")).toBeInTheDocument();
  });

  it("explains a month with nothing expiring", async () => {
    await renderDashboard("admin", (month) =>
      makeDashboard(month, {
        expiringThisMonth: { batches: 0, items: [], month, units: 0 },
      })
    );
    expect(
      await screen.findByText(/No batches with stock expire in/)
    ).toBeInTheDocument();
  });

  it("describes the activity donut for assistive technology", async () => {
    await renderDashboard("admin");
    const donut = await screen.findByRole("img", {
      name: /Dispensed 120 units, Received 300 units, Disposed 30 units/,
    });
    expect(donut).toBeInTheDocument();
  });
});

describe("DashboardPage — states", () => {
  it("shows a loading skeleton first", async () => {
    await renderLoading();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("shows the empty state with an Add stock button for roles that can write inventory", async () => {
    await renderDashboard("inventory", (month) =>
      makeDashboard(month, {
        totals: {
          classes: {
            expired: { batches: 0, units: 0 },
            near_expiry: { batches: 0, units: 0 },
            safe: { batches: 0, units: 0 },
            urgent: { batches: 0, units: 0 },
          },
          itemCount: 0,
          lowStockCount: 0,
          outOfStockCount: 0,
        },
        useFirst: [],
      })
    );
    expect(await screen.findByText("No stock registered yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add stock" })).toHaveAttribute(
      "href",
      "/inventory/add"
    );
  });

  it("offers no Add stock button to a nurse", async () => {
    await renderDashboard("nurse", (month) =>
      makeDashboard(month, {
        totals: {
          classes: {
            expired: { batches: 0, units: 0 },
            near_expiry: { batches: 0, units: 0 },
            safe: { batches: 0, units: 0 },
            urgent: { batches: 0, units: 0 },
          },
          itemCount: 0,
          lowStockCount: 0,
          outOfStockCount: 0,
        },
        useFirst: [],
      })
    );
    expect(await screen.findByText("No stock registered yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add stock" })).not.toBeInTheDocument();
  });

  it("shows an error with a retry when the dashboard cannot load", async () => {
    const me = makeMe("admin");
    await renderWithProviders(<DashboardPage />, {
      handlers: {
        "GET /api/dashboard": () => failure(500, "internal_error", "Boom"),
      },
      me,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

async function renderLoading(): Promise<void> {
  await renderWithProviders(<DashboardPage />, {
    handlers: {
      "GET /api/dashboard": () => new Promise(() => undefined),
    },
    me: makeMe("admin"),
  });
}
