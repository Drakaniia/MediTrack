import { EXPIRY_CLASS_LABELS, EXPIRY_CLASSES } from "@shared/expiry";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExpiryBadge } from "./expiry-badge";

describe("ExpiryBadge", () => {
  it.each(EXPIRY_CLASSES)(
    "renders the %s class as text plus an icon",
    (expiryClass) => {
      const { container } = render(<ExpiryBadge expiryClass={expiryClass} />);

      expect(
        screen.getByText(EXPIRY_CLASS_LABELS[expiryClass])
      ).toBeInTheDocument();
      const icon = container.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  );

  it("uses a different icon for every class (colour is never the only signal)", () => {
    const icons = EXPIRY_CLASSES.map((expiryClass) => {
      const { container, unmount } = render(
        <ExpiryBadge expiryClass={expiryClass} />
      );
      const svg = container.querySelector("svg")?.getAttribute("class") ?? "";
      unmount();
      return svg.split(" ").find((name) => name.startsWith("lucide-"));
    });

    expect(new Set(icons).size).toBe(EXPIRY_CLASSES.length);
  });

  it("adds relative text when daysUntil is given", () => {
    render(<ExpiryBadge daysUntil={12} expiryClass="near_expiry" />);
    expect(screen.getByText("Near Expiry")).toBeInTheDocument();
    expect(screen.getByText(/In 12d/)).toBeInTheDocument();
  });

  it("words past, today and tomorrow", () => {
    const { rerender } = render(
      <ExpiryBadge daysUntil={-3} expiryClass="expired" />
    );
    expect(screen.getByText(/Expired 3d ago/)).toBeInTheDocument();

    rerender(<ExpiryBadge daysUntil={0} expiryClass="urgent" />);
    expect(screen.getByText(/Expires today/)).toBeInTheDocument();

    rerender(<ExpiryBadge daysUntil={1} expiryClass="urgent" />);
    expect(screen.getByText(/Expires tomorrow/)).toBeInTheDocument();
  });

  it("says 'No expiry' for a null date and shows nothing extra when daysUntil is omitted", () => {
    const { container, rerender } = render(
      <ExpiryBadge daysUntil={null} expiryClass="safe" />
    );
    expect(screen.getByText(/No expiry/)).toBeInTheDocument();

    rerender(<ExpiryBadge expiryClass="safe" />);
    expect(container).toHaveTextContent(/^Safe$/);
  });

  it("exposes the class for styling and tests", () => {
    const { container } = render(<ExpiryBadge expiryClass="urgent" />);
    expect(container.firstElementChild).toHaveAttribute(
      "data-expiry-class",
      "urgent"
    );
  });
});
