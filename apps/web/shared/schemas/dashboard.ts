/**
 * DASH slice contract: `GET /api/dashboard?month=YYYY-MM` (spec §7.1).
 *
 * The payload is role-shaped. A field the role may not see is OMITTED (the key is absent), never
 * sent empty: `pendingRequests` needs `requests.view`, `recentDispensing` needs `dispensing.view`
 * and `activity` needs `analytics.view`. Expiry classes are computed at read time.
 */

import { z } from "zod";

import { isIsoMonth } from "../dates";
import type { ExpiryClass, ExpiryThresholds } from "../expiry";
import type { FefoEntryDto } from "./inventory";

/** Rows in every short list on the dashboard (expiring, use first, recent dispensing). */
export const DASHBOARD_LIST_LIMIT = 8;
/** Oldest pending requests shown on the dashboard. */
export const DASHBOARD_PENDING_LIMIT = 5;

export const dashboardQuerySchema = z.object({
  month: z
    .string()
    .refine(isIsoMonth, { error: "Use YYYY-MM." })
    .optional(),
});
export type DashboardQuery = z.output<typeof dashboardQuerySchema>;

export interface DashboardClassCountDto {
  batches: number;
  units: number;
}

export interface DashboardTotalsDto {
  /** Batches holding stock, per class. Expired = past expiry and still holding stock. */
  classes: Record<ExpiryClass, DashboardClassCountDto>;
  /** Live items. */
  itemCount: number;
  /** Items with a threshold whose `available` is below it (out-of-stock items included). */
  lowStockCount: number;
  /** Items with a threshold and nothing available. */
  outOfStockCount: number;
}

export interface ExpiringBatchDto {
  batchId: string;
  batchNumber: string;
  daysUntil: number;
  /** `YYYY-MM-DD`. */
  expiry: string;
  expiryClass: ExpiryClass;
  itemId: string;
  itemName: string;
  qty: number;
  unit: string;
}

export interface ExpiringThisMonthDto {
  /** Batches holding stock that expire in the month. */
  batches: number;
  /** The first batches of the month by expiry (at most `DASHBOARD_LIST_LIMIT`). */
  items: ExpiringBatchDto[];
  /** `YYYY-MM`, facility calendar. */
  month: string;
  units: number;
}

export const PENDING_CARD_STATUSES = ["pending", "approved", "ready"] as const;
export type PendingCardStatus = (typeof PENDING_CARD_STATUSES)[number];

export interface PendingRequestDto {
  code: string;
  id: string;
  itemId: string | null;
  itemName: string;
  qty: number;
  requestorName: string;
  submittedAt: string;
  unit: string;
}

export interface PendingRequestsCardDto {
  counts: Record<PendingCardStatus, number>;
  /** Oldest first, at most `DASHBOARD_PENDING_LIMIT`. */
  oldestPending: PendingRequestDto[];
}

export interface RecentDispensingBatchDto {
  batchNumber: string;
  qty: number;
}

export interface RecentDispensingDto {
  batches: RecentDispensingBatchDto[];
  dispensedAt: string;
  dispensedByName: string;
  id: string;
  itemId: string | null;
  itemName: string;
  qty: number;
  source: "queue" | "quick_deduct";
  unit: string;
}

export interface DashboardActivityDto {
  disposals: { count: number; units: number };
  month: string;
  unitsDispensed: number;
  unitsReceived: number;
}

export interface DashboardDto {
  /** `analytics.view` only. */
  activity?: DashboardActivityDto;
  expiringThisMonth: ExpiringThisMonthDto;
  /** ISO-UTC instant the payload was computed. */
  generatedAt: string;
  /** The selected month, `YYYY-MM`. */
  month: string;
  /** `requests.view` only. */
  pendingRequests?: PendingRequestsCardDto;
  /** `dispensing.view` only (not nurses). */
  recentDispensing?: RecentDispensingDto[];
  thresholds: ExpiryThresholds;
  timezone: string;
  /** Facility-local date, `YYYY-MM-DD`. */
  today: string;
  totals: DashboardTotalsDto;
  /** FEFO shortlist: each item's next eligible batch, earliest expiry first. Every role. */
  useFirst: FefoEntryDto[];
}
