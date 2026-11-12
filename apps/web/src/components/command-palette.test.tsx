import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeMe, renderWithProviders } from "@/test/render";

import { CommandPalette } from "./command-palette";

describe("CommandPalette", () => {
  it("opens with Ctrl+K and lists only the pages the role may open", async () => {
    await renderWithProviders(<CommandPalette />, { me: makeMe("nurse") });

    await userEvent.keyboard("{Control>}k{/Control}");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("option", { name: "Requests" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: "Audit log" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: /Quick deduct/ })).toBeInTheDocument();
  });

  it("searches items on the server and navigates to a chosen page", async () => {
    const { api, router } = await renderWithProviders(<CommandPalette />, {
      handlers: {
        "GET /api/items": () => [
          { available: 12, displayName: "Paracetamol 500 mg", id: "i1", unit: "tablet" },
        ],
      },
    });
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox");

    await userEvent.type(input, "para");
    expect(await screen.findByRole("option", { name: /Paracetamol 500 mg/ })).toBeInTheDocument();
    expect(api.callsTo("GET /api/items").at(-1)?.query.search).toBe("para");

    await userEvent.clear(input);
    await userEvent.type(input, "audit");
    await userEvent.click(await screen.findByRole("option", { name: "Audit log" }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/audit"));
  });

  it("opens the shortcuts list with ?", async () => {
    await renderWithProviders(<CommandPalette />);

    await userEvent.keyboard("{Shift>}/{/Shift}");

    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toHaveTextContent(
      "Quick deduct stock"
    );
  });
});
