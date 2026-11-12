import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type ScanSubmission, useScanInput, useWedgeScanner } from "./use-wedge-scanner";

const FAST_MS = 8;
const SLOW_MS = 300;

/** A controllable clock for the hooks (`KeyboardEvent.timeStamp` is read-only). */
function createClock() {
  const state = { now: 0 };
  return {
    advance: (ms: number) => {
      state.now += ms;
    },
    read: () => state.now,
  };
}

function typeInto(
  target: Element,
  text: string,
  gap: number,
  clock: ReturnType<typeof createClock>,
  options: { enter?: boolean; syncValue?: boolean } = {}
): boolean {
  let typed = "";
  for (const key of text) {
    clock.advance(gap);
    fireEvent.keyDown(target, { key });
    typed += key;
    if (options.syncValue) {
      fireEvent.change(target, { target: { value: typed } });
    }
  }
  if (options.enter === false) {
    return false;
  }
  clock.advance(gap);
  // fireEvent returns false when a handler called preventDefault().
  return !fireEvent.keyDown(target, { key: "Enter" });
}

describe("useWedgeScanner (global capture)", () => {
  function setup(enabled = true) {
    const clock = createClock();
    const onScan = vi.fn();
    renderHook(() => useWedgeScanner({ enabled, getTime: clock.read, onScan }));
    return { clock, onScan };
  }

  it("reports a fast burst typed with nothing focused", () => {
    const { clock, onScan } = setup();
    typeInto(document.body, "ABCDEFGHJK", FAST_MS, clock);
    expect(onScan).toHaveBeenCalledExactlyOnceWith("ABCDEFGHJK");
  });

  it("prevents Enter from activating the focused control", () => {
    const { clock } = setup();
    expect(typeInto(document.body, "ABCDEF", FAST_MS, clock)).toBe(true);
  });

  it("ignores slow typing", () => {
    const { clock, onScan } = setup();
    typeInto(document.body, "ABCDEFGHJK", SLOW_MS, clock);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores a partial burst that never gets Enter, then catches the next scan", () => {
    const { clock, onScan } = setup();
    typeInto(document.body, "ABCDE", FAST_MS, clock, { enter: false });
    clock.advance(SLOW_MS * 4);
    typeInto(document.body, "WXYZ12", FAST_MS, clock);
    expect(onScan).toHaveBeenCalledExactlyOnceWith("WXYZ12");
  });

  it("ignores modifier combos", () => {
    const { clock, onScan } = setup();
    for (const key of "ABCDE") {
      clock.advance(FAST_MS);
      fireEvent.keyDown(document.body, { ctrlKey: true, key });
    }
    clock.advance(FAST_MS);
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onScan).not.toHaveBeenCalled();
  });

  it("stays out of editable elements", () => {
    const { clock, onScan } = setup();
    render(<input aria-label="Notes" />);
    typeInto(screen.getByLabelText("Notes"), "ABCDEFGHJK", FAST_MS, clock);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const { clock, onScan } = setup(false);
    typeInto(document.body, "ABCDEFGHJK", FAST_MS, clock);
    expect(onScan).not.toHaveBeenCalled();
  });
});

describe("useScanInput (per-field mode)", () => {
  function Field(props: {
    clock: ReturnType<typeof createClock>;
    onSubmit: (submission: ScanSubmission) => void;
  }) {
    const { inputProps } = useScanInput({
      getTime: props.clock.read,
      onSubmit: props.onSubmit,
    });
    return <input aria-label="Scan" {...inputProps} />;
  }

  function setup() {
    const clock = createClock();
    const onSubmit = vi.fn();
    render(<Field clock={clock} onSubmit={onSubmit} />);
    return { clock, input: screen.getByLabelText<HTMLInputElement>("Scan"), onSubmit };
  }

  it("submits a fast burst as a scanner entry and clears the field", () => {
    const { clock, input, onSubmit } = setup();
    typeInto(input, "ABCDEFGHJK", FAST_MS, clock, { syncValue: true });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ code: "ABCDEFGHJK", viaScanner: true });
    expect(input.value).toBe("");
  });

  it("submits slow typing on Enter, flagged as typed", () => {
    const { clock, input, onSubmit } = setup();
    typeInto(input, "ABC12", SLOW_MS, clock, { syncValue: true });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ code: "ABC12", viaScanner: false });
  });

  it("submits a short entry on Enter even without a burst", () => {
    const { clock, input, onSubmit } = setup();
    typeInto(input, "42", FAST_MS, clock, { syncValue: true });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ code: "42", viaScanner: false });
  });

  it("trims padding and control characters", () => {
    const { clock, input, onSubmit } = setup();
    fireEvent.change(input, { target: { value: "\u0002  ABC123 \t\u0003" } });
    clock.advance(SLOW_MS);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ code: "ABC123", viaScanner: false });
  });

  it("ignores Enter on an empty field", () => {
    const { input, onSubmit } = setup();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("never submits a partial burst without Enter", () => {
    const { clock, input, onSubmit } = setup();
    typeInto(input, "ABCDEFGH", FAST_MS, clock, { enter: false, syncValue: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe("ABCDEFGH");
  });
});
