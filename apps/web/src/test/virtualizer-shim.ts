/**
 * Test-only stand-in for `@tanstack/react-virtual`.
 *
 * jsdom has no layout engine, so the real virtualizer measures a viewport of
 * zero height and renders nothing — every row would be absent from the DOM and
 * a row-interaction test would assert against an empty list. Windowing is the
 * library's concern; which rows exist and how they respond to a click, a key,
 * or a focus is ours, so the shim renders every row at its estimated size and
 * keeps the same accessor shape the components use.
 *
 * Use it with
 * `vi.mock("@tanstack/react-virtual", () => import("@/test/virtualizer-shim"))`.
 */

interface VirtualizerOptions {
  count: number;
  estimateSize: (index: number) => number;
}

export function useVirtualizer({ count, estimateSize }: VirtualizerOptions) {
  const sizes = Array.from({ length: count }, (_, index) =>
    estimateSize(index)
  );
  const starts: number[] = [];
  let offset = 0;
  for (const size of sizes) {
    starts.push(offset);
    offset += size;
  }
  return {
    getTotalSize: () => offset,
    getVirtualItems: () =>
      sizes.map((size, index) => ({
        index,
        key: index,
        size,
        start: starts[index] ?? 0,
      })),
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  };
}
