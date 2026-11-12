import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DENSITY_STORAGE_KEY, DensityProvider } from "@/hooks/use-density";

import { DensityToggle } from "./density-toggle";

function renderToggle() {
  return render(
    <DensityProvider>
      <DensityToggle />
    </DensityProvider>
  );
}

describe("DensityToggle", () => {
  it("defaults to comfortable and sets data-density on <html>", () => {
    renderToggle();

    expect(
      screen.getByRole("radio", { name: "Comfortable density" })
    ).toBeChecked();
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("switches to compact, updates <html> and remembers the choice", async () => {
    renderToggle();

    await userEvent.click(
      screen.getByRole("radio", { name: "Compact density" })
    );

    expect(
      screen.getByRole("radio", { name: "Compact density" })
    ).toBeChecked();
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe("compact");
  });

  it("restores the stored preference", () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, "compact");
    renderToggle();

    expect(
      screen.getByRole("radio", { name: "Compact density" })
    ).toBeChecked();
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("ignores a garbage stored value", () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, "huge");
    renderToggle();
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("is a labelled group", () => {
    renderToggle();
    expect(screen.getByRole("group", { name: "Density" })).toBeInTheDocument();
  });
});
