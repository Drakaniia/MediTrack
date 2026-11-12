/**
 * SCAN slice: `GET /api/scan?code=` request and response shapes (spec §7.3).
 *
 * A scan resolves one code to a batch, an item, or several candidate items. Scans are read-only
 * and high volume, so they are NOT audited.
 */

import { z } from "zod";

import { isBatchCode, normalizeBatchCode } from "../batch-code";
import type { BatchDto, ItemSummaryDto } from "./inventory";

/** What the signed-in role may do with the scanned stock; the SPA renders exactly these buttons. */
export const SCAN_ACTIONS = [
  "view",
  "request",
  "quick_deduct",
  "dispose",
  "adjust",
  "label",
  "edit",
] as const;

export type ScanAction = (typeof SCAN_ACTIONS)[number];

export const MAX_SCAN_CODE_LENGTH = 200;

export const scanQuerySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Enter or scan a code.")
    .max(MAX_SCAN_CODE_LENGTH, "That code is too long."),
});

export type ScanQuery = z.infer<typeof scanQuerySchema>;

export interface ScanBatchResult {
  allowedActions: ScanAction[];
  batch: BatchDto;
  /**
   * The item's FEFO rank 1 batch (the one to use first); the scanned batch itself when it is
   * rank 1, null when nothing is dispensable. Lets the UI name the batch to use instead.
   */
  fefoBatch: BatchDto | null;
  item: ItemSummaryDto;
  kind: "batch";
}

export interface ScanItemResult {
  allowedActions: ScanAction[];
  /** The batch to use first (FEFO rank 1), or null when nothing is dispensable. */
  fefoBatch: BatchDto | null;
  item: ItemSummaryDto;
  kind: "item";
}

export interface ScanAmbiguousResult {
  items: ItemSummaryDto[];
  kind: "ambiguous";
}

export type ScanResult =
  | ScanAmbiguousResult
  | ScanBatchResult
  | ScanItemResult;

/** `details` of the `404 scan_not_found` error. */
export interface ScanNotFoundDetails {
  canRegister: boolean;
  code: string;
}

const MT_COLON_PREFIX = /^MT\s*:\s*/i;

export interface ScanCandidates {
  /** Normalised batch code to try first, or null when the input cannot be a batch code. */
  batchCode: string | null;
  /** The text compared against barcodes (exact) and SKUs (case-insensitive). */
  text: string;
}

/**
 * Turns whatever a person typed or a scanner sent into lookup keys: trimmed, an `MT:` prefix
 * dropped, and, when the text is shaped like a batch code (`ABCDE-FGHJK`, `mt:abcdefghjk`,
 * look-alike letters), its canonical form.
 */
export function scanCandidates(input: string): ScanCandidates {
  const trimmed = input.trim();
  return {
    batchCode: isBatchCode(trimmed) ? normalizeBatchCode(trimmed) : null,
    text: trimmed.replace(MT_COLON_PREFIX, "").trim(),
  };
}

/** True when the scan result holds a single batch. */
export function isBatchScan(result: ScanResult): result is ScanBatchResult {
  return result.kind === "batch";
}
