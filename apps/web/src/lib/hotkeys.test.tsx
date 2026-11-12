import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatHotkey,
  HOTKEYS,
  type HotkeyOptions,
  parseCombo,
  useHotkey,
} from "./hotkeys";

function Listener({
  combo,
  handler,
  options,
}: {
  combo: string;
  handler: () => void;
  options?: HotkeyOptions;
}) {
  useHotkey(combo, handler, options);
  return null;
}

/** `fireEvent` returns false when the event's default was prevented. */
function press(init: KeyboardEventInit, target: Element = document.body) {
  return fireEvent.keyDown(target, init);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useHotkey", () => {
  it("fires mod+k on Ctrl+K and prevents the browser default", () => {
    const handler = vi.fn();
    render(<Listener combo="mod+k" handler={handler} />);

    const notPrevented = press({ ctrlKey: true, key: "k" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it("matches letters case-insensitively", () => {
    const handler = vi.fn();
    render(<Listener combo="mod+n" handler={handler} />);
    press({ ctrlKey: true, key: "N" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fires mod+d and mod+n independently", () => {
    const newRequest = vi.fn();
    const quickDeduct = vi.fn();
    render(
      <>
        <Listener combo="mod+n" handler={newRequest} />
        <Listener combo="mod+d" handler={quickDeduct} />
      </>
    );

    press({ ctrlKey: true, key: "d" });

    expect(quickDeduct).toHaveBeenCalledTimes(1);
    expect(newRequest).not.toHaveBeenCalled();
  });

  it("requires the modifiers to match exactly", () => {
    const handler = vi.fn();
    render(<Listener combo="mod+k" handler={handler} />);

    const notPrevented = press({ ctrlKey: true, key: "k", shiftKey: true });
    press({ key: "k" });
    press({ altKey: true, ctrlKey: true, key: "k" });

    expect(handler).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it("fires shift+/ for the physical slash key even though it types '?'", () => {
    const handler = vi.fn();
    render(<Listener combo="shift+/" handler={handler} />);
    press({ code: "Slash", key: "?", shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fires escape", () => {
    const handler = vi.fn();
    render(<Listener combo="escape" handler={handler} />);
    press({ key: "Escape" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores plain-key shortcuts while typing in a field, unless allowInInput", () => {
    const plain = vi.fn();
    const forced = vi.fn();
    render(
      <>
        <input aria-label="Search" />
        <Listener combo="shift+/" handler={plain} />
        <Listener
          combo="mod+k"
          handler={forced}
          options={{ allowInInput: true }}
        />
      </>
    );
    const input = screen.getByLabelText("Search");

    press({ code: "Slash", key: "?", shiftKey: true }, input);
    press({ ctrlKey: true, key: "k" }, input);

    expect(plain).not.toHaveBeenCalled();
    expect(forced).toHaveBeenCalledTimes(1);
  });

  it("does not register while enabled is false, and starts when it turns true", () => {
    const handler = vi.fn();
    const { rerender } = render(
      <Listener combo="mod+n" handler={handler} options={{ enabled: false }} />
    );
    const notPrevented = press({ ctrlKey: true, key: "n" });
    expect(handler).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);

    rerender(
      <Listener combo="mod+n" handler={handler} options={{ enabled: true }} />
    );
    press({ ctrlKey: true, key: "n" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("calls the latest handler without re-registering", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Listener combo="mod+k" handler={first} />);
    rerender(<Listener combo="mod+k" handler={second} />);

    press({ ctrlKey: true, key: "k" });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("lets the most recently mounted listener win (a dialog shadows the page)", () => {
    const page = vi.fn();
    const dialog = vi.fn();
    render(
      <>
        <Listener combo="escape" handler={page} />
        <Listener combo="escape" handler={dialog} />
      </>
    );

    press({ key: "Escape" });

    expect(dialog).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
  });

  it("uses ONE shared keydown listener and removes it when the last hotkey unmounts", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const noop = vi.fn();

    const { unmount } = render(
      <>
        <Listener combo="mod+k" handler={noop} />
        <Listener combo="mod+n" handler={noop} />
        <Listener combo="mod+d" handler={noop} />
      </>
    );
    expect(add.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(
      1
    );

    unmount();
    expect(
      remove.mock.calls.filter(([type]) => type === "keydown")
    ).toHaveLength(1);
  });

  it("ignores key repeat and events already handled elsewhere", () => {
    const handler = vi.fn();
    render(<Listener combo="mod+k" handler={handler} />);

    press({ ctrlKey: true, key: "k", repeat: true });
    document.body.addEventListener(
      "keydown",
      (event) => event.preventDefault(),
      { once: true }
    );
    press({ ctrlKey: true, key: "k" });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("HOTKEYS", () => {
  it("lists the reserved shortcuts", () => {
    expect(HOTKEYS.map((hotkey) => hotkey.combo)).toEqual([
      "mod+k",
      "mod+n",
      "mod+d",
      "shift+/",
      "escape",
    ]);
    for (const hotkey of HOTKEYS) {
      expect(hotkey.description).not.toBe("");
    }
  });
});

describe("parseCombo / formatHotkey", () => {
  it("parses modifiers and aliases", () => {
    expect(parseCombo("Mod+Shift+K")).toMatchObject({
      key: "k",
      mod: true,
      shift: true,
    });
    expect(parseCombo("esc").key).toBe("escape");
  });

  it("labels combos for the platform", () => {
    expect(formatHotkey("mod+k", false)).toBe("Ctrl+K");
    expect(formatHotkey("mod+k", true)).toBe("⌘K");
    expect(formatHotkey("shift+/", false)).toBe("Shift+/");
    expect(formatHotkey("escape", false)).toBe("Esc");
  });
});
