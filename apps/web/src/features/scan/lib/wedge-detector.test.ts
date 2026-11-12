import { describe, expect, it } from "vitest";

import { createWedgeDetector, type WedgeKeyEvent } from "./wedge-detector";

const FAST_GAP_MS = 10;
const SLOW_GAP_MS = 120;

/** Types `text` then Enter, `gap` ms apart, starting at `start`; returns every push result. */
function type(
  detector: ReturnType<typeof createWedgeDetector>,
  text: string,
  gap: number,
  start = 0,
  extra: Partial<WedgeKeyEvent> = {}
): { end: number; results: (string | null)[] } {
  const results: (string | null)[] = [];
  let at = start;
  for (const key of text) {
    results.push(detector.push({ key, timeStamp: at, ...extra }));
    at += gap;
  }
  results.push(detector.push({ key: "Enter", timeStamp: at }));
  return { end: at, results };
}

describe("createWedgeDetector", () => {
  it("reports a fast burst terminated by Enter", () => {
    const detector = createWedgeDetector();
    const { results } = type(detector, "ABCDEFGHJK", FAST_GAP_MS);
    expect(results.at(-1)).toBe("ABCDEFGHJK");
    expect(results.slice(0, -1).every((value) => value === null)).toBe(true);
  });

  it("does not treat slow typing as a scan", () => {
    const detector = createWedgeDetector();
    expect(type(detector, "ABCDEFGHJK", SLOW_GAP_MS).results.at(-1)).toBeNull();
  });

  it("accepts gaps up to the limit and rejects just beyond it", () => {
    const detector = createWedgeDetector({ maxGapMs: 50 });
    expect(type(detector, "ABCDE", 50).results.at(-1)).toBe("ABCDE");
    expect(type(detector, "ABCDE", 51, 10_000).results.at(-1)).toBeNull();
  });

  it("honours a custom gap and minimum length", () => {
    const detector = createWedgeDetector({ maxGapMs: 200, minLength: 2 });
    expect(type(detector, "AB", 150).results.at(-1)).toBe("AB");
  });

  it("ignores bursts shorter than four characters", () => {
    const detector = createWedgeDetector();
    expect(type(detector, "ABC", FAST_GAP_MS).results.at(-1)).toBeNull();
  });

  it("abandons a partial burst: no Enter, no scan, and the next burst starts clean", () => {
    const detector = createWedgeDetector();
    for (const [index, key] of [..."XYZ"].entries()) {
      detector.push({ key, timeStamp: index * FAST_GAP_MS });
    }
    const { results } = type(detector, "ABCDEF", FAST_GAP_MS, 5000);
    expect(results.at(-1)).toBe("ABCDEF");
  });

  it("drops characters typed slowly before the burst", () => {
    const detector = createWedgeDetector();
    detector.push({ key: "q", timeStamp: 0 });
    detector.push({ key: "w", timeStamp: 1000 });
    const { results } = type(detector, "ABCDEF", FAST_GAP_MS, 2000);
    expect(results.at(-1)).toBe("ABCDEF");
  });

  it("requires Enter to follow the last character quickly", () => {
    const detector = createWedgeDetector();
    for (const [index, key] of [..."ABCDEF"].entries()) {
      detector.push({ key, timeStamp: index * FAST_GAP_MS });
    }
    expect(detector.push({ key: "Enter", timeStamp: 5000 })).toBeNull();
    expect(detector.pending()).toBe("");
  });

  it("ignores Shift and other bare modifier presses inside a burst", () => {
    const detector = createWedgeDetector();
    const keys = ["Shift", "A", "B", "Shift", "C", "D", "E"];
    keys.forEach((key, index) => {
      detector.push({ key, timeStamp: index * FAST_GAP_MS });
    });
    expect(detector.push({ key: "Enter", timeStamp: keys.length * FAST_GAP_MS })).toBe("ABCDE");
  });

  it("ignores Ctrl/Meta/Alt combos and resets the burst", () => {
    const detector = createWedgeDetector();
    detector.push({ key: "A", timeStamp: 0 });
    detector.push({ key: "B", timeStamp: 10 });
    detector.push({ ctrlKey: true, key: "v", timeStamp: 20 });
    expect(detector.pending()).toBe("");
    const meta = type(detector, "ABCDE", FAST_GAP_MS, 100, { metaKey: true });
    expect(meta.results.at(-1)).toBeNull();
    const alt = type(detector, "ABCDE", FAST_GAP_MS, 1000, { altKey: true });
    expect(alt.results.at(-1)).toBeNull();
  });

  it("accepts AltGr (Ctrl+Alt) characters", () => {
    const detector = createWedgeDetector();
    const { results } = type(detector, "A@BCD", FAST_GAP_MS, 0, {
      altKey: true,
      ctrlKey: true,
    });
    expect(results.at(-1)).toBe("A@BCD");
  });

  it("resets on other keys such as Escape or Backspace", () => {
    const detector = createWedgeDetector();
    for (const [index, key] of [..."ABCDE"].entries()) {
      detector.push({ key, timeStamp: index * FAST_GAP_MS });
    }
    detector.push({ key: "Backspace", timeStamp: 60 });
    expect(detector.push({ key: "Enter", timeStamp: 70 })).toBeNull();
  });

  it("reports a second scan after the first", () => {
    const detector = createWedgeDetector();
    const first = type(detector, "FIRST1", FAST_GAP_MS);
    const second = type(detector, "SECOND2", FAST_GAP_MS, first.end + 500);
    expect(first.results.at(-1)).toBe("FIRST1");
    expect(second.results.at(-1)).toBe("SECOND2");
  });
});
