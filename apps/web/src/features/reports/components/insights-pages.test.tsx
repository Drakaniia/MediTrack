import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsPage } from "@/features/analytics/components/analytics-page";
import { DocArticlePage, DocsIndexPage } from "@/features/docs/docs-pages";
import { makeMe, renderWithProviders } from "@/test/render";

import type { ReportDocument } from "../lib/report-export";
import { ANALYTICS, EXPIRY_REPORT, STOCK_REPORT } from "../test-data";
import { ReportsPage } from "./reports-page";

type Exporter = (report: ReportDocument) => Promise<void>;

const exporters = vi.hoisted(() => ({
  exportPdf: vi.fn<Exporter>(async () => {}),
  exportXlsx: vi.fn<Exporter>(async () => {}),
}));
vi.mock("../lib/report-export", () => exporters);

const REPORT_HANDLERS = {
  "GET /api/reports/expiry": () => EXPIRY_REPORT,
  "GET /api/reports/expiry/export": () => EXPIRY_REPORT,
  "GET /api/reports/stock": () => STOCK_REPORT,
  "GET /api/reports/stock/export": () => STOCK_REPORT,
};

describe("ReportsPage", () => {
  it("shows the stock report tables and lets an exporter export", async () => {
    await renderWithProviders(<ReportsPage />, {
      handlers: REPORT_HANDLERS,
      me: makeMe("health_admin"),
    });

    expect(await screen.findByRole("heading", { name: "Stock by item" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stock by batch" })).toBeInTheDocument();
    expect(screen.getAllByText("Paracetamol 500 mg").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export XLSX" })).toBeInTheDocument();
  });

  it("builds the export from the guarded export endpoint, not the on-screen data", async () => {
    exporters.exportXlsx.mockClear();
    const { api } = await renderWithProviders(<ReportsPage />, {
      handlers: REPORT_HANDLERS,
      me: makeMe("admin"),
    });
    await screen.findByRole("heading", { name: "Stock by item" });

    await userEvent.click(screen.getByRole("button", { name: "Export XLSX" }));

    await vi.waitFor(() => expect(exporters.exportXlsx).toHaveBeenCalledTimes(1));
    const shownMonth = api.callsTo("GET /api/reports/stock")[0].query.month;
    const [call] = api.callsTo("GET /api/reports/stock/export");
    expect(call.query).toMatchObject({ format: "xlsx", month: shownMonth });
    expect(exporters.exportXlsx.mock.calls[0][0]).toMatchObject({
      fileName: `meditract-stock-report-${STOCK_REPORT.month}.xlsx`,
      title: "Stock report",
    });
  });

  it("hides export from a role that may only view, and switches to the expiry report", async () => {
    const { api } = await renderWithProviders(<ReportsPage />, {
      handlers: REPORT_HANDLERS,
      me: makeMe("pharmacist"),
    });
    await screen.findByRole("heading", { name: "Stock by item" });
    expect(screen.queryByRole("button", { name: "Export PDF" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Expiry report" }));

    expect(await screen.findByText("Expires this month")).toBeInTheDocument();
    expect(api.callsTo("GET /api/reports/expiry")).toHaveLength(1);
  });
});

describe("AnalyticsPage", () => {
  it("renders every widget from one request", async () => {
    const { api } = await renderWithProviders(<AnalyticsPage />, {
      handlers: {
        "GET /api/analytics": () => ANALYTICS,
        "GET /api/categories": () => [],
      },
    });

    for (const title of [
      "Usage",
      "Top dispensed",
      "Stock movement",
      "Dispensed vs requested",
      "Expiry timeline",
      "Low-stock trend",
    ]) {
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(api.callsTo("GET /api/analytics")[0].query.to).toBeTruthy();
  });
});

describe("Docs", () => {
  it("lists the topics and renders an article, or a not-found state", async () => {
    const { unmount } = await renderWithProviders(<DocsIndexPage />);
    expect(screen.getByRole("link", { name: /Expiry status and disposal/ })).toHaveAttribute(
      "href",
      "/docs/expiry"
    );
    unmount();

    const article = await renderWithProviders(<DocArticlePage slug="fefo" />);
    expect(screen.getByRole("heading", { level: 1, name: "FEFO: what to use first" })).toBeInTheDocument();
    article.unmount();

    await renderWithProviders(<DocArticlePage slug="nope" />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });
});
