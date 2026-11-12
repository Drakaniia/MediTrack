import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { DataState } from "./data-state";

describe("DataState", () => {
  it("shows a skeleton while loading, not the children", () => {
    render(
      <DataState isLoading>
        <p>Rows</p>
      </DataState>
    );

    expect(screen.getByRole("status", { name: "Loading" })).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(screen.queryByText("Rows")).not.toBeInTheDocument();
  });

  it("accepts a custom skeleton", () => {
    render(<DataState isLoading skeleton={<p>Custom skeleton</p>} />);
    expect(screen.getByText("Custom skeleton")).toBeInTheDocument();
  });

  it("shows the error message with a working retry button", async () => {
    const onRetry = vi.fn();
    render(
      <DataState
        error={
          new ApiError({
            code: "internal_error",
            message: "The database is on fire.",
            status: 500,
          })
        }
        onRetry={onRetry}
      >
        <p>Rows</p>
      </DataState>
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The database is on fire."
    );
    expect(screen.queryByText("Rows")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic message for an unknown error and hides retry without a handler", () => {
    render(<DataState error={new Error("boom")} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong while loading this."
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the empty state with its action", () => {
    render(
      <DataState
        empty={{
          action: <button type="button">Add stock</button>,
          description: "Nothing has been added yet.",
          title: "No items",
        }}
        isEmpty
      >
        <p>Rows</p>
      </DataState>
    );

    expect(screen.getByText("No items")).toBeInTheDocument();
    expect(screen.getByText("Nothing has been added yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add stock" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Rows")).not.toBeInTheDocument();
  });

  it("renders the children when there is data", () => {
    render(
      <DataState isEmpty={false} isLoading={false}>
        <p>Rows</p>
      </DataState>
    );
    expect(screen.getByText("Rows")).toBeInTheDocument();
  });

  it("prefers loading over error over empty", () => {
    const { rerender } = render(
      <DataState error={new Error("x")} isEmpty isLoading />
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(<DataState error={new Error("x")} isEmpty />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
