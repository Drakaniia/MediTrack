/**
 * Low-stock classification, ported from the desktop `classifyLowStock` and
 * moved onto AVAILABLE stock (FEFO-eligible total), not on-hand: expired stock
 * awaiting disposal must not hide a shortage.
 *
 * A threshold of 0 (or less) means "never alert" — the item is `in_stock` even
 * at zero available.
 */

import type { LowStockStatus } from "./schemas/inventory";

export interface LowStockInput {
  /** Σqty over FEFO-eligible batches. */
  available: number;
  /** `items.low_stock_threshold`; 0 disables the alert. */
  threshold: number;
}

const PERCENT = 100;
const REORDER_COVER_FACTOR = 2;

export const LOW_STOCK_LABELS: Record<LowStockStatus, string> = {
  in_stock: "In stock",
  low: "Low",
  out: "Out",
};

export function classifyLowStock(input: LowStockInput): LowStockStatus {
  const { available, threshold } = input;
  if (threshold <= 0) {
    return "in_stock";
  }
  if (available <= 0) {
    return "out";
  }
  return available < threshold ? "low" : "in_stock";
}

/** How many units short of the threshold; 0 when at or above it. */
export function gap(input: LowStockInput): number {
  return Math.max(0, input.threshold - input.available);
}

/**
 * Stock as a share of the threshold, clamped to 0..100 (the fill level of the
 * low-stock bar). With no threshold there is nothing to measure against: full
 * when anything is available, empty otherwise.
 */
export function gapPercent(input: LowStockInput): number {
  const { available, threshold } = input;
  if (threshold <= 0) {
    return available > 0 ? PERCENT : 0;
  }
  return Math.min(PERCENT, Math.max(0, (available / threshold) * PERCENT));
}

/** Order up to twice the threshold, but never less than the threshold itself. */
export function suggestedReorderQty(input: LowStockInput): number {
  const { available, threshold } = input;
  if (threshold <= 0) {
    return 0;
  }
  return Math.max(threshold * REORDER_COVER_FACTOR - available, threshold);
}
