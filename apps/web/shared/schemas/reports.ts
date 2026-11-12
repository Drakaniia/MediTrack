/**
 * ANALYTICS slice contract: `GET /api/reports/stock?month=YYYY-MM` and
 * `GET /api/reports/expiry?month=YYYY-MM` (spec §7.8).
 *
 * The month is month + year only (facility calendar). PDF / XLSX files are produced in the
 * browser from these payloads. Quantities are reconstructed from the append-only
 * `stock_movements` ledger: `closing = current qty − movements after the month`,
 * `opening = closing − movements inside the month`.
 */

import { z } from "zod";

import { isIsoMonth } from "../dates";
import type { ExpiryClass, ExpiryThresholds } from "../expiry";
import type { LowStockStatus } from "./inventory";

export const reportQuerySchema = z.object({
  month: z
    .string()
    .refine(isIsoMonth, { error: "Use YYYY-MM." })
    .optional(),
});
export type ReportQuery = z.output<typeof reportQuerySchema>;

export const REPORT_EXPORT_FORMATS = ["pdf", "xlsx"] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

/**
 * `GET /api/reports/{stock,expiry}/export?month=YYYY-MM&format=pdf|xlsx`: the same payload as
 * the on-screen report, but guarded by `reports.export` and audited. The browser builds the
 * PDF / XLSX file only from this response.
 */
export const reportExportQuerySchema = reportQuerySchema.extend({
  format: z.enum(REPORT_EXPORT_FORMATS),
});
export type ReportExportQuery = z.output<typeof reportExportQuerySchema>;

export interface ReportClassCountDto {
  batches: number;
  units: number;
}

export type ReportClassSplitDto = Record<ExpiryClass, ReportClassCountDto>;

/** Fields every report carries so a printed or exported copy stands alone. */
export interface ReportHeaderDto {
  facilityName: string;
  /** ISO-UTC instant the payload was computed. */
  generatedAt: string;
  /** Last day of the month, `YYYY-MM-DD`. */
  monthEnd: string;
  /** The selected month, `YYYY-MM`. */
  month: string;
  /** First day of the month. */
  monthStart: string;
  /**
   * The facility date the figures are as of: the last day of the month for a past month,
   * today for the current (or a future) month.
   */
  asOf: string;
  thresholds: ExpiryThresholds;
  timezone: string;
  /** Facility-local today, `YYYY-MM-DD`. */
  today: string;
}

// ─── Stock report ───────────────────────────────────────────────────────────

export interface StockReportBatchDto {
  /** Net `adjust` movements in the month (signed). */
  adjusted: number;
  batchId: string;
  batchNumber: string;
  closingQty: number;
  /** `dispense` + `undo_dispense` in the month, so an undone quick deduct nets out. */
  dispensed: number;
  disposed: number;
  /** `YYYY-MM-DD`, null = no expiry. */
  expiry: string | null;
  /** Class at `asOf`. */
  expiryClass: ExpiryClass;
  openingQty: number;
  received: number;
}

export interface StockReportItemDto {
  adjusted: number;
  /** Units on batches that can still be used at `asOf`. */
  available: number;
  /** Batches holding stock at `asOf`. */
  batchCount: number;
  /** Per-batch monthly activity (spec §7.5): batches with stock or movement in the month. */
  byBatch: StockReportBatchDto[];
  categoryId: string | null;
  classCounts: ReportClassSplitDto;
  closingQty: number;
  dispensed: number;
  disposed: number;
  displayName: string;
  itemId: string;
  name: string;
  /** Earliest expiry on or after `asOf` among batches holding stock. */
  nearestExpiry: string | null;
  onHand: number;
  openingQty: number;
  received: number;
  status: LowStockStatus;
  strength: string;
  threshold: number;
  unit: string;
}

export interface StockReportCategoryDto {
  /** Null = items without a category; always listed last. */
  categoryId: string | null;
  items: StockReportItemDto[];
  name: string;
}

export interface StockReportSummaryDto {
  /** Categories that have at least one item (Uncategorized counts when used). */
  categories: number;
  classes: ReportClassSplitDto;
  dispensed: number;
  disposed: number;
  /** Items with a threshold and nothing available. */
  lowStockOut: number;
  /** Items with a threshold whose available stock is below it (out-of-stock included). */
  lowStockItems: number;
  /** Live items in the report. */
  medicines: number;
  received: number;
  /** Total units on hand at `asOf`. */
  units: number;
}

export interface StockReportDto extends ReportHeaderDto {
  categories: StockReportCategoryDto[];
  summary: StockReportSummaryDto;
}

// ─── Expiry report ──────────────────────────────────────────────────────────

/** `expiring` = expiry falls inside the month; `expired` = expired before it, still holding stock. */
export type ExpiryReportSection = "expired" | "expiring";

export interface ExpiryReportRowDto {
  batchId: string;
  batchNumber: string;
  categoryId: string | null;
  categoryName: string;
  /** Class at the month's last day. */
  classAtMonthEnd: ExpiryClass;
  /** Class at `asOf`. */
  classNow: ExpiryClass;
  /** `expiry − monthEnd`, in days (negative = already expired by month end). */
  daysUntilMonthEnd: number;
  /** `expiry − asOf`, in days. */
  daysUntilNow: number;
  /** Units written off through disposals in the month. */
  disposed: number;
  expiry: string;
  itemId: string;
  itemName: string;
  /** Units at the start of the month. */
  openingQty: number;
  /** Units held at `asOf` (month end for past months). */
  qty: number;
  section: ExpiryReportSection;
  unit: string;
}

export interface ExpiryReportSummaryDto {
  /** By class at the month's last day. */
  classes: ReportClassSplitDto;
  /** By class at `asOf`. */
  classesNow: ReportClassSplitDto;
  expired: ReportClassCountDto;
  expiring: ReportClassCountDto;
  total: ReportClassCountDto;
}

export interface ExpiryReportDto extends ReportHeaderDto {
  /** Expiring batches first (by expiry), then already-expired ones. */
  rows: ExpiryReportRowDto[];
  summary: ExpiryReportSummaryDto;
}
