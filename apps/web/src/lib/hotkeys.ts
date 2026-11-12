import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts.
 *
 * `useHotkey("mod+n", handler, { enabled })` registers a shortcut for as long as
 * the calling component is mounted and `enabled` is true. One `keydown` listener
 * on `document` serves every registration; the most recently registered
 * shortcut for a combo wins, so a dialog can shadow a page shortcut while open.
 *
 * Combo syntax: modifiers and one key joined by `+`, case-insensitive.
 *   modifiers  mod (Ctrl on Windows/Linux, Cmd on macOS) · ctrl · meta/cmd · alt · shift
 *   keys       a letter or digit, a punctuation key (`/`), or a name (`escape`, `enter`, `space`)
 * Modifiers must match exactly: `mod+k` does not fire for Ctrl+Shift+K.
 */

export interface HotkeyOptions {
  /**
   * Fire while an input, textarea, select or contenteditable has focus.
   * Default false: typing "?" in a search box must not open the shortcuts dialog.
   * Modifier combos (`mod+k`, `mod+n`) do not type text, so they can opt in.
   */
  allowInInput?: boolean;
  /** Register only while true (e.g. gated by a permission). Default true. */
  enabled?: boolean;
}

export type HotkeyHandler = (event: KeyboardEvent) => void;

export interface HotkeyDefinition {
  combo: string;
  description: string;
  id: string;
}

/**
 * The reserved shortcuts (ARCHITECTURE §6). The future shortcuts dialog renders
 * this list; the palette/dialog owners register the ones still unclaimed.
 */
export const HOTKEYS: readonly HotkeyDefinition[] = [
  {
    combo: "mod+k",
    description: "Open the command palette",
    id: "command-palette",
  },
  { combo: "mod+n", description: "Create a new request", id: "new-request" },
  { combo: "mod+d", description: "Quick deduct stock", id: "quick-deduct" },
  {
    combo: "shift+/",
    description: "Show keyboard shortcuts",
    id: "shortcuts",
  },
  {
    combo: "escape",
    description: "Close the open dialog or menu",
    id: "dismiss",
  },
];

type ModifierName = "alt" | "ctrl" | "meta" | "mod" | "shift";

interface ParsedCombo {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  mod: boolean;
  shift: boolean;
}

const MODIFIER_ALIASES: Partial<Record<string, ModifierName>> = {
  alt: "alt",
  cmd: "meta",
  command: "meta",
  control: "ctrl",
  ctrl: "ctrl",
  meta: "meta",
  mod: "mod",
  option: "alt",
  shift: "shift",
};

const KEY_ALIASES: Partial<Record<string, string>> = {
  esc: "escape",
  plus: "+",
  return: "enter",
  slash: "/",
  space: " ",
  spacebar: " ",
};

/** Physical-key fallback for punctuation, whose `event.key` changes with Shift and layout. */
const CODE_BY_KEY: Partial<Record<string, string>> = {
  "-": "Minus",
  ",": "Comma",
  ";": "Semicolon",
  ".": "Period",
  "[": "BracketLeft",
  "]": "BracketRight",
  "/": "Slash",
  "\\": "Backslash",
  "`": "Backquote",
  "=": "Equal",
};

const KEY_LABELS: Partial<Record<string, string>> = {
  " ": "Space",
  enter: "Enter",
  escape: "Esc",
};

const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;
const EDITABLE_SELECTOR = '[contenteditable="true"], [contenteditable=""]';

export function parseCombo(combo: string): ParsedCombo {
  const parsed: ParsedCombo = {
    alt: false,
    ctrl: false,
    key: "",
    meta: false,
    mod: false,
    shift: false,
  };
  for (const rawPart of combo.toLowerCase().split("+")) {
    const part = rawPart.trim();
    const modifier = MODIFIER_ALIASES[part];
    if (modifier) {
      parsed[modifier] = true;
    } else {
      parsed.key = KEY_ALIASES[part] ?? part;
    }
  }
  return parsed;
}

/** True on macOS/iOS, where `mod` means Cmd. Read per event so tests can change the platform. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return APPLE_PLATFORM.test(navigator.platform || navigator.userAgent);
}

function matchesKey(key: string, event: KeyboardEvent): boolean {
  const eventKey = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (eventKey === key) {
    return true;
  }
  const code = CODE_BY_KEY[key];
  return code !== undefined && event.code === code;
}

function matches(
  parsed: ParsedCombo,
  event: KeyboardEvent,
  apple: boolean
): boolean {
  const wantsCtrl = parsed.ctrl || (parsed.mod && !apple);
  const wantsMeta = parsed.meta || (parsed.mod && apple);
  return (
    event.ctrlKey === wantsCtrl &&
    event.metaKey === wantsMeta &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    matchesKey(parsed.key, event)
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable || target.closest(EDITABLE_SELECTOR)) {
    return true;
  }
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return (
    target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type)
  );
}

interface Registration {
  allowInInput: boolean;
  combo: ParsedCombo;
  handlerRef: { current: HotkeyHandler };
}

const registrations: Registration[] = [];
let listening = false;

function handleKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.repeat) {
    return;
  }
  const apple = isApplePlatform();
  const typing = isTypingTarget(event.target);
  // Newest registration first: it is the one the user most recently opened.
  for (const registration of [...registrations].reverse()) {
    if (typing && !registration.allowInInput) {
      continue;
    }
    if (matches(registration.combo, event, apple)) {
      event.preventDefault();
      registration.handlerRef.current(event);
      return;
    }
  }
}

function attach(): void {
  if (!listening) {
    document.addEventListener("keydown", handleKeyDown);
    listening = true;
  }
}

function detachWhenIdle(): void {
  if (listening && registrations.length === 0) {
    document.removeEventListener("keydown", handleKeyDown);
    listening = false;
  }
}

export function useHotkey(
  combo: string,
  handler: HotkeyHandler,
  options: HotkeyOptions = {}
): void {
  const { allowInInput = false, enabled = true } = options;
  const handlerRef = useRef(handler);

  // Always call the latest handler without re-registering on every render.
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const registration: Registration = {
      allowInInput,
      combo: parseCombo(combo),
      handlerRef,
    };
    registrations.push(registration);
    attach();
    return () => {
      const index = registrations.indexOf(registration);
      if (index !== -1) {
        registrations.splice(index, 1);
      }
      detachWhenIdle();
    };
  }, [allowInInput, combo, enabled]);
}

/** Human label for a combo: `Ctrl+K` on Windows/Linux, `⌘K` on macOS. */
export function formatHotkey(
  combo: string,
  apple: boolean = isApplePlatform()
): string {
  const parsed = parseCombo(combo);
  const parts: string[] = [];
  if (parsed.mod) {
    parts.push(apple ? "⌘" : "Ctrl");
  }
  if (parsed.ctrl) {
    parts.push(apple ? "⌃" : "Ctrl");
  }
  if (parsed.alt) {
    parts.push(apple ? "⌥" : "Alt");
  }
  if (parsed.shift) {
    parts.push(apple ? "⇧" : "Shift");
  }
  if (parsed.meta) {
    parts.push(apple ? "⌘" : "Win");
  }
  parts.push(KEY_LABELS[parsed.key] ?? parsed.key.toUpperCase());
  return parts.join(apple ? "" : "+");
}
