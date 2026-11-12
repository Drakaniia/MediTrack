/**
 * EXP slice contract: expiry list, low-stock list, quarantine, stock adjustment, disposal.
 *
 * Input schemas are used by the API (server) AND by the SPA forms (they validate with the same
 * rules). DTOs are the response shapes. Derived values (`expiryClass`, `daysUntil`, `available`,
 * `status`) are computed at read time from the facility timezone and the settings thresholds;
 * nothing here is stored.
 */

import { z } from "zod";

import { isIsoDate } from "../dates";
import { EXPIRY_CLASSES, type ExpiryClass } from "../expiry";
import type { LowStockStatus } from "./inventory";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default `class` filter of `GET /api/expiry`: everything that needs attention. */
export const DEFAULT_EXPIRY_LIST_CLASSES: readonly ExpiryClass[] = [
  "urgent",
  "near_expiry",
  "expired",
];

export const EXPIRY_SORTS = ["expiry", "item", "qty", "class"] as const;
export type ExpirySort = (typeof EXPIRY_SORTS)[number];

export const LOW_STOCK_SORTS = ["status", "gap", "item", "available"] as const;
export type LowStockSort = (typeof LOW_STOCK_SORTS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const ADJUST_REASONS = [
  "count_correction",
  "damaged",
  "found",
  "other",
] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

export const ADJUST_REASON_LABELS: Record<AdjustReason, string> = {
  count_correction: "Count correction",
  damaged: "Damaged",
  found: "Found",
  other: "Other",
};

export const DISPOSAL_REASONS = [
  "expired",
  "damaged",
  "recalled",
  "other",
] as const;
export type DisposalReason = (typeof DISPOSAL_REASONS)[number];

export const DISPOSAL_REASON_LABELS: Record<DisposalReason, string> = {
  damaged: "Damaged",
  expired: "Expired",
  other: "Other",
  recalled: "Recalled",
};

/** Typo guard for quantities and thresholds, not a business rule. */
export const MAX_STOCK_QTY = 10_000_000;
export const MAX_NOTE_LENGTH = 500;
export const MAX_SEARCH_LENGTH = 100;

export const LOW_STOCK_STATUSES = ["low", "out"] as const;
export type LowStockListStatus = Extract<LowStockStatus, "low" | "out">;

// ─── Query parsing helpers ──────────────────────────────────────────────────

/** A comma-separated list of enum members. Missing or empty → `fallback`. */
function csvEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: readonly T[number][]
) {
  return z
    .string()
    .optional()
    .transform((raw) => {
      const parts = (raw ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
      return parts.length === 0 ? [...fallback] : [...new Set(parts)];
    })
    .pipe(z.array(z.enum(values)));
}

/** Optional free text: trimmed, empty → undefined. */
const optionalText = z
  .string()
  .trim()
  .max(MAX_SEARCH_LENGTH)
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const optionalIsoDate = z
  .string()
  .optional()
  .transform((value) => (value === "" ? undefined : value))
  .pipe(
    z
      .string()
      .refine(isIsoDate, { message: "Use a date like 2026-11-12." })
      .optional()
  );

// ─── Query schemas ──────────────────────────────────────────────────────────

export const expiryQuerySchema = z.object({
  categoryId: optionalText,
  class: csvEnum(EXPIRY_CLASSES, DEFAULT_EXPIRY_LIST_CLASSES),
  dir: z.enum(SORT_DIRECTIONS).default("asc"),
  from: optionalIsoDate,
  search: optionalText,
  sort: z.enum(EXPIRY_SORTS).default("expiry"),
  to: optionalIsoDate,
});
export type ExpiryQuery = z.output<typeof expiryQuerySchema>;

export const lowStockQuerySchema = z.object({
  categoryId: optionalText,
  dir: z.enum(SORT_DIRECTIONS).default("asc"),
  search: optionalText,
  sort: z.enum(LOW_STOCK_SORTS).default("status"),
  status: csvEnum(LOW_STOCK_STATUSES, LOW_STOCK_STATUSES),
});
export type LowStockQuery = z.output<typeof lowStockQuerySchema>;

export const quarantineQuerySchema = z.object({
  categoryId: optionalText,
  search: optionalText,
});
export type QuarantineQuery = z.output<typeof quarantineQuerySchema>;

export const disposalsQuerySchema = z.object({
  from: optionalIsoDate,
  reason: csvEnum(DISPOSAL_REASONS, DISPOSAL_REASONS),
  search: optionalText,
  to: optionalIsoDate,
});
export type DisposalsQuery = z.output<typeof disposalsQuerySchema>;

// ─── Body schemas ───────────────────────────────────────────────────────────

const noteField = z.string().trim().max(MAX_NOTE_LENGTH).default("");

/** Exactly one of `newQty` (absolute) or `delta` (relative, non-zero). */
export const adjustInputSchema = z
  .object({
    delta: z
      .number()
      .int()
      .min(-MAX_STOCK_QTY)
      .max(MAX_STOCK_QTY)
      .refine((value) => value !== 0, {
        message: "Enter a change of 1 or more.",
      })
      .optional(),
    newQty: z.number().int().min(0).max(MAX_STOCK_QTY).optional(),
    note: noteField,
    reason: z.enum(ADJUST_REASONS, { message: "Choose a reason." }),
  })
  .superRefine((value, ctx) => {
    const hasNewQty = value.newQty !== undefined;
    const hasDelta = value.delta !== undefined;
    if (hasNewQty === hasDelta) {
      ctx.addIssue({
        code: "custom",
        message: "Send either newQty or delta, not both or neither.",
        path: [hasNewQty ? "delta" : "newQty"],
      });
    }
  });
export type AdjustInput = z.output<typeof adjustInputSchema>;

export const disposeInputSchema = z.object({
  note: noteField,
  reason: z.enum(DISPOSAL_REASONS, { message: "Choose a reason." }),
});
export type DisposeInput = z.output<typeof disposeInputSchema>;

export const thresholdInputSchema = z.object({
  lowStockThreshold: z.number().int().min(0).max(MAX_STOCK_QTY),
});
export type ThresholdInput = z.output<typeof thresholdInputSchema>;

// ─── DTOs ───────────────────────────────────────────────────────────────────

/** One batch holding stock, on the Expiry page. */
export interface ExpiryRowDto {
  batchId: string;
  batchNumber: string;
  categoryId: string | null;
  categoryName: string | null;
  /** Short opaque QR payload of the batch. */
  code: string;
  /** Whole days from facility-local today; negative = expired; null = no expiry. */
  daysUntil: number | null;
  /** "Paracetamol 500 mg". */
  displayName: string;
  /** `YYYY-MM-DD`, or null for stock that never expires. */
  expiry: string | null;
  expiryClass: ExpiryClass;
  /** 1-based position among the item's FEFO-eligible batches; null when not eligible (expired). */
  fefoRank: number | null;
  itemId: string;
  itemName: string;
  qty: number;
  /** Expired, active, still holding stock: waits for disposal. */
  quarantined: boolean;
  status: "active" | "disposed";
  unit: string;
}

export interface ExpiryClassCountDto {
  batches: number;
  /** Total units across those batches. */
  units: number;
}

export interface ExpirySummaryDto {
  counts: Record<ExpiryClass, ExpiryClassCountDto>;
  /** Batches whose expiry date falls in the facility-local calendar month of `today`. */
  expiringThisMonth: ExpiryClassCountDto;
  /** `YYYY-MM` (facility-local). */
  month: string;
  /** Thresholds in force, so the page can say "Urgent ≤ 7 days". */
  thresholds: { nearDays: number; urgentDays: number };
  today: string;
}

export interface LowStockRowDto {
  /** Σqty over FEFO-eligible batches (expired stock does not count). */
  available: number;
  categoryId: string | null;
  categoryName: string | null;
  displayName: string;
  /** Units short of the threshold. */
  gap: number;
  itemId: string;
  lowStockThreshold: number;
  name: string;
  /** Earliest expiry among eligible batches. */
  nearestExpiry: string | null;
  /** Σqty over active batches, including expired stock awaiting disposal. */
  onHand: number;
  status: LowStockListStatus;
  strength: string;
  suggestedReorderQty: number;
  supplier: string;
  unit: string;
}

/** An expired batch still holding stock. */
export interface QuarantineRowDto {
  batchId: string;
  batchNumber: string;
  /** Whether the CURRENT user may dispose of it (`stock.dispose`). */
  canDispose: boolean;
  categoryId: string | null;
  categoryName: string | null;
  code: string;
  /** Whole days past the expiry date (1 = expired yesterday). */
  daysOverdue: number;
  displayName: string;
  expiry: string;
  itemId: string;
  itemName: string;
  qty: number;
  unit: string;
}

export interface DisposalDto {
  batchId: string | null;
  batchNumber: string;
  disposedAt: string;
  disposedByName: string;
  expiry: string | null;
  id: string;
  itemId: string | null;
  itemName: string;
  note: string;
  qty: number;
  reason: DisposalReason;
}

/** `POST /api/batches/:id/adjust` answers with the updated `BatchDto` (see `schemas/inventory.ts`). */

export interface ThresholdResultDto {
  itemId: string;
  lowStockThreshold: number;
  previous: number;
}
