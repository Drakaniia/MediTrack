import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportNetworkFailure, reportNetworkSuccess } from "@/lib/online";

import { OFFLINE_MESSAGE, OfflineBanner } from "./offline-banner";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OfflineBanner", () => {
  it("renders an empty status region while online", () => {
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByText(OFFLINE_MESSAGE)).not.toBeInTheDocument();
  });

  it("has the exact offline wording", () => {
    expect(OFFLINE_MESSAGE).toBe(
      "You're offline — changes can't be saved until you reconnect."
    );
  });

  it("appears inside the status region when the browser goes offline, and goes away on reconnect", () => {
    const onLine = vi.spyOn(window.navigator, "onLine", "get");
    onLine.mockReturnValue(true);
    render(<OfflineBanner />);

    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(OFFLINE_MESSAGE);

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText(OFFLINE_MESSAGE)).not.toBeInTheDocument();
  });

  it("appears when an API call fails at the network level, even if the browser claims to be online", () => {
    render(<OfflineBanner />);

    act(() => reportNetworkFailure());
    expect(screen.getByRole("status")).toHaveTextContent(OFFLINE_MESSAGE);

    act(() => reportNetworkSuccess());
    expect(screen.queryByText(OFFLINE_MESSAGE)).not.toBeInTheDocument();
  });
});
