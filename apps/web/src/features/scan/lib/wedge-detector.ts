/**
 * Keyboard-wedge scanner detection (spec §7.3).
 *
 * A handheld scanner in "keyboard wedge" mode types the code like a very fast keyboard and
 * ends with Enter. A person cannot type that fast, so a scan is: at least `minLength` printable
 * characters, each arriving within `maxGapMs` of the one before, terminated by Enter (also
 * within `maxGapMs`). Anything slower is ordinary typing and is never reported as a scan.
 *
 * The detector is pure: feed it key events with timestamps (ms), it returns the code when an
 * Enter completes a burst. It owns no timers, so tests drive it with plain numbers.
 */

export const DEFAULT_WEDGE_MAX_GAP_MS = 50;
export const DEFAULT_WEDGE_MIN_LENGTH = 4;

export interface WedgeKeyEvent {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  /** Milliseconds on any monotonic clock (`KeyboardEvent.timeStamp`). */
  timeStamp: number;
}

export interface WedgeOptions {
  /** Longest pause between two keys of the same burst. */
  maxGapMs?: number;
  /** Fewest characters that make a scan. */
  minLength?: number;
}

export interface WedgeDetector {
  /** Characters collected in the current burst (for tests and UI hints). */
  pending: () => string;
  /** Feeds one key; returns the scanned code when this key (Enter) completes a burst. */
  push: (event: WedgeKeyEvent) => string | null;
  reset: () => void;
}

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Meta",
  "Shift",
]);

function isPrintable(key: string): boolean {
  return [...key].length === 1;
}

/** AltGr is reported as Ctrl+Alt on Windows and types real characters (`@`, `€`). */
function isCommand(event: WedgeKeyEvent): boolean {
  const altGraph = Boolean(event.ctrlKey) && Boolean(event.altKey);
  if (altGraph) {
    return Boolean(event.metaKey);
  }
  return Boolean(event.ctrlKey || event.metaKey || event.altKey);
}

export function createWedgeDetector(options: WedgeOptions = {}): WedgeDetector {
  const maxGapMs = options.maxGapMs ?? DEFAULT_WEDGE_MAX_GAP_MS;
  const minLength = options.minLength ?? DEFAULT_WEDGE_MIN_LENGTH;
  let buffer = "";
  let lastAt = Number.NEGATIVE_INFINITY;

  const reset = (): void => {
    buffer = "";
    lastAt = Number.NEGATIVE_INFINITY;
  };

  const withinGap = (at: number): boolean => at - lastAt <= maxGapMs;

  const push = (event: WedgeKeyEvent): string | null => {
    if (MODIFIER_KEYS.has(event.key)) {
      return null;
    }
    if (isCommand(event)) {
      reset();
      return null;
    }
    if (isPrintable(event.key)) {
      buffer = buffer !== "" && withinGap(event.timeStamp) ? buffer + event.key : event.key;
      lastAt = event.timeStamp;
      return null;
    }
    const complete =
      event.key === "Enter" && buffer.length >= minLength && withinGap(event.timeStamp);
    const code = complete ? buffer : null;
    reset();
    return code;
  };

  return { pending: () => buffer, push, reset };
}
