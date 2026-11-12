import type { BoardStatus } from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeRequest } from "../test-data";
import { useCardDrag } from "./use-card-drag";

function Harness({
  enabled,
  onDrop,
  request,
}: {
  enabled: boolean;
  onDrop: (request: RequestDto, to: BoardStatus) => void;
  request: RequestDto;
}): ReactElement {
  const { drag, startDrag } = useCardDrag({ enabled, onDrop });
  return (
    <div>
      <div
        data-testid="card"
        onPointerDown={(event) => startDrag(event, request)}
      >
        <button type="button">inner</button>
      </div>
      <div data-column-status="approved" data-testid="approved" />
      <div data-column-status="claimed" data-testid="claimed" />
      <output>{drag ? `dragging over ${drag.over}` : "idle"}</output>
    </div>
  );
}

function hitTest(testId: string): void {
  document.elementsFromPoint = () => [screen.getByTestId(testId)];
}

describe("useCardDrag", () => {
  afterEach(() => {
    delete (document as any).elementsFromPoint;
  });

  it("drops a card on an allowed neighbouring column", () => {
    const onDrop = vi.fn();
    const request = makeRequest({ status: "pending" });
    render(<Harness enabled onDrop={onDrop} request={request} />);

    fireEvent.pointerDown(screen.getByTestId("card"), {
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    hitTest("approved");
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60 });
    expect(screen.getByRole("status")).toHaveTextContent(
      "dragging over approved"
    );
    fireEvent.pointerUp(window, { clientX: 60, clientY: 60 });

    expect(onDrop).toHaveBeenCalledWith(request, "approved");
    expect(screen.getByRole("status")).toHaveTextContent("idle");
  });

  it("ignores a drop on a column the status machine forbids", () => {
    const onDrop = vi.fn();
    render(
      <Harness
        enabled
        onDrop={onDrop}
        request={makeRequest({ status: "pending" })}
      />
    );
    fireEvent.pointerDown(screen.getByTestId("card"), {
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    hitTest("claimed");
    fireEvent.pointerMove(window, { clientX: 60, clientY: 60 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 60 });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does not start below the threshold, from a button, when disabled, or after Escape", () => {
    const onDrop = vi.fn();
    const request = makeRequest({ status: "pending" });
    const { rerender } = render(
      <Harness enabled onDrop={onDrop} request={request} />
    );
    hitTest("approved");

    fireEvent.pointerDown(screen.getByTestId("card"), {
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerMove(window, { clientX: 7, clientY: 7 });
    fireEvent.pointerUp(window, { clientX: 7, clientY: 7 });

    fireEvent.pointerDown(screen.getByRole("button", { name: "inner" }), {
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 90 });
    fireEvent.pointerUp(window, { clientX: 90, clientY: 90 });

    fireEvent.pointerDown(screen.getByTestId("card"), {
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 90 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 90, clientY: 90 });
    expect(onDrop).not.toHaveBeenCalled();

    rerender(<Harness enabled={false} onDrop={onDrop} request={request} />);
    fireEvent.pointerDown(screen.getByTestId("card"), {
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 90 });
    fireEvent.pointerUp(window, { clientX: 90, clientY: 90 });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
