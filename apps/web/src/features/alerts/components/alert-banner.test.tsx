import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { makeMe, renderWithProviders } from "@/test/render";

import { alertKeys } from "../hooks/alert-queries";
import { BANNER_DISMISSED_KEY } from "../lib/banner-model";
import { makeBanner } from "../test-data";
import { AlertBanner } from "./alert-banner";

beforeEach(() => {
  sessionStorage.clear();
});

const FULL = makeBanner({
  counts: { expired: 2, lowStock: 4, urgent: 3 },
  topItems: [
    {
      available: null,
      batchId: "b1",
      batchNumber: "B-12",
      daysUntil: -3,
      expiry: "2026-11-09",
      itemId: "i1",
      itemName: "Amoxicillin 500 mg",
      kind: "expired",
      threshold: null,
      unit: "cap",
    },
  ],
});

describe("AlertBanner", () => {
  it("summarises expired, urgent and low-stock with links to the inventory views", async () => {
    await renderWithProviders(<AlertBanner />, {
      handlers: { "GET /api/alerts/banner": () => FULL },
      me: makeMe("pharmacist"),
    });

    const region = await screen.findByRole("region", { name: "Stock alerts" });
    expect(region).toHaveTextContent(
      "2 batches expired3 urgent4 items low on stock"
    );
    expect(
      screen.getByRole("link", { name: "2 batches expired" })
    ).toHaveAttribute("href", "/inventory/quarantine");
    expect(screen.getByRole("link", { name: "3 urgent" })).toHaveAttribute(
      "href",
      "/inventory/expiry"
    );
    expect(
      screen.getByRole("link", { name: "4 items low on stock" })
    ).toHaveAttribute("href", "/inventory/low-stock");
    expect(
      screen.getByText("Amoxicillin 500 mg · batch B-12 · Expired 3d ago")
    ).toBeInTheDocument();
  });

  it("renders nothing when every count is zero", async () => {
    const { api } = await renderWithProviders(<AlertBanner />, {
      handlers: { "GET /api/alerts/banner": () => makeBanner() },
    });
    await waitFor(() =>
      expect(api.callsTo("GET /api/alerts/banner")).toHaveLength(1)
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Stock alerts" })
      ).not.toBeInTheDocument()
    );
  });

  it("renders nothing when in-app alerts are disabled", async () => {
    const { api } = await renderWithProviders(<AlertBanner />, {
      handlers: {
        "GET /api/alerts/banner": () =>
          makeBanner({ counts: FULL.counts, enabled: false }),
      },
    });
    await waitFor(() =>
      expect(api.callsTo("GET /api/alerts/banner")).toHaveLength(1)
    );
    expect(
      screen.queryByRole("region", { name: "Stock alerts" })
    ).not.toBeInTheDocument();
  });

  it("is dismissed for the session and reappears when a count increases", async () => {
    let banner = FULL;
    const { queryClient } = await renderWithProviders(<AlertBanner />, {
      handlers: { "GET /api/alerts/banner": () => banner },
    });
    await screen.findByRole("region", { name: "Stock alerts" });

    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss stock alerts" })
    );
    expect(
      screen.queryByRole("region", { name: "Stock alerts" })
    ).not.toBeInTheDocument();
    expect(sessionStorage.getItem(BANNER_DISMISSED_KEY)).not.toBeNull();

    // Same counts: stays hidden.
    await queryClient.invalidateQueries({ queryKey: alertKeys.banner });
    expect(
      screen.queryByRole("region", { name: "Stock alerts" })
    ).not.toBeInTheDocument();

    // One more urgent batch: back.
    banner = makeBanner({ counts: { expired: 2, lowStock: 4, urgent: 4 } });
    await queryClient.invalidateQueries({ queryKey: alertKeys.banner });
    expect(
      await screen.findByRole("region", { name: "Stock alerts" })
    ).toHaveTextContent("4 urgent");
  });

  it("stays hidden after a reload of the same session", async () => {
    sessionStorage.setItem(
      BANNER_DISMISSED_KEY,
      JSON.stringify({ expired: 2, lowStock: 4, urgent: 3 })
    );
    const { api } = await renderWithProviders(<AlertBanner />, {
      handlers: { "GET /api/alerts/banner": () => FULL },
    });
    await waitFor(() =>
      expect(api.callsTo("GET /api/alerts/banner")).toHaveLength(1)
    );
    expect(
      screen.queryByRole("region", { name: "Stock alerts" })
    ).not.toBeInTheDocument();
  });
});
