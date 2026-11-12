import { formatBatchCodeForDisplay, qrPayloadForBatch } from "@shared/batch-code";

import { formatDate } from "@/lib/format";

/**
 * The label model: sizes, how many labels fit a page, how long text is cut, and what each
 * label shows. Pure, so the layout math is unit-tested without rendering anything.
 */

export const LABEL_SIZE_IDS = ["50x30", "70x40", "a4-3x8"] as const;
export type LabelSizeId = (typeof LABEL_SIZE_IDS)[number];

export interface LabelSize {
  columns: number;
  description: string;
  id: LabelSizeId;
  labelHeightMm: number;
  labelWidthMm: number;
  /** Longest "name strength" line before it is cut with an ellipsis. */
  maxTitleChars: number;
  name: string;
  pageHeightMm: number;
  pageWidthMm: number;
  qrMm: number;
  rows: number;
}

export const LABEL_SIZES: Record<LabelSizeId, LabelSize> = {
  "50x30": {
    columns: 1,
    description: "One label per page, for a roll printer",
    id: "50x30",
    labelHeightMm: 30,
    labelWidthMm: 50,
    maxTitleChars: 28,
    name: "50 × 30 mm",
    pageHeightMm: 30,
    pageWidthMm: 50,
    qrMm: 20,
    rows: 1,
  },
  "70x40": {
    columns: 1,
    description: "One label per page, for a roll printer",
    id: "70x40",
    labelHeightMm: 40,
    labelWidthMm: 70,
    maxTitleChars: 36,
    name: "70 × 40 mm",
    pageHeightMm: 40,
    pageWidthMm: 70,
    qrMm: 27,
    rows: 1,
  },
  "a4-3x8": {
    columns: 3,
    description: "A4 sheet of 24 labels (3 across, 8 down)",
    id: "a4-3x8",
    labelHeightMm: 37,
    labelWidthMm: 70,
    maxTitleChars: 36,
    name: "A4 sheet 3 × 8",
    pageHeightMm: 297,
    pageWidthMm: 210,
    qrMm: 24,
    rows: 8,
  },
};

export const DEFAULT_LABEL_SIZE: LabelSizeId = "50x30";
export const MIN_COPIES = 1;
export const MAX_COPIES = 20;
const ELLIPSIS = "…";

export function isLabelSizeId(value: string): value is LabelSizeId {
  return (LABEL_SIZE_IDS as readonly string[]).includes(value);
}

/** Labels on one printed page. */
export function labelsPerPage(size: LabelSize): number {
  return size.columns * size.rows;
}

export function pageCount(labelCount: number, size: LabelSize): number {
  return Math.ceil(Math.max(0, labelCount) / labelsPerPage(size));
}

/** Splits labels into printed pages, in order; the last page may be partly empty. */
export function paginate<T>(labels: readonly T[], size: LabelSize): T[][] {
  const perPage = labelsPerPage(size);
  const pages: T[][] = [];
  for (let start = 0; start < labels.length; start += perPage) {
    pages.push(labels.slice(start, start + perPage));
  }
  return pages;
}

/** Cuts `text` to `max` characters including the ellipsis. */
export function truncateText(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}${ELLIPSIS}`;
}

/**
 * "Paracetamol 500 mg" cut to `max` characters. The strength is what tells two products apart,
 * so the NAME is shortened first and the strength is kept whole when it fits.
 */
export function truncateTitle(name: string, strength: string, max: number): string {
  const cleanName = name.trim();
  const cleanStrength = strength.trim();
  const full = cleanStrength === "" ? cleanName : `${cleanName} ${cleanStrength}`;
  if (full.length <= max) {
    return full;
  }
  const nameRoom = max - cleanStrength.length - 1;
  const strengthFits = cleanStrength !== "" && nameRoom >= 3;
  if (!strengthFits) {
    return truncateText(full, max);
  }
  return `${truncateText(cleanName, nameRoom)} ${cleanStrength}`;
}

/** A batch as the labels page knows it, whichever endpoint it came from. */
export interface LabelBatch {
  batchNumber: string;
  /** The 10-character batch code the QR carries. */
  code: string;
  /** `YYYY-MM-DD`, or null for stock that never expires. */
  expiry: string | null;
  id: string;
  itemName: string;
  strength: string;
}

export interface LabelModel {
  batchNumber: string;
  /** Short code in human form (`ABCDE-FGHJK`). */
  codeDisplay: string;
  expiryText: string;
  key: string;
  /** Exactly what the QR encodes: the normalised batch code and nothing else. */
  qrPayload: string;
  title: string;
}

export function buildLabel(
  batch: LabelBatch,
  size: LabelSize,
  copy = 1
): LabelModel {
  return {
    batchNumber: truncateText(batch.batchNumber, size.maxTitleChars),
    codeDisplay: formatBatchCodeForDisplay(batch.code),
    expiryText: batch.expiry ? `Exp ${formatDate(batch.expiry)}` : "No expiry",
    key: `${batch.id}:${copy}`,
    qrPayload: qrPayloadForBatch(batch.code),
    title: truncateTitle(batch.itemName, batch.strength, size.maxTitleChars),
  };
}

export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_COPIES;
  }
  return Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.trunc(value)));
}

/** One label per batch per copy, batches in the order given, copies of a batch together. */
export function buildLabels(
  batches: readonly LabelBatch[],
  size: LabelSize,
  copies = MIN_COPIES
): LabelModel[] {
  const count = clampCopies(copies);
  return batches.flatMap((batch) =>
    Array.from({ length: count }, (_, index) => buildLabel(batch, size, index + 1))
  );
}
