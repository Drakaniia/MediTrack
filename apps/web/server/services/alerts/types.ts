/** Shapes shared by the alert generator, the daily job and their callers. */

import type { ExpiryClass } from "../../../shared/expiry";
import type { AppSettings } from "../../../shared/settings";

/** A class a batch can be alerted about (everything but `safe`). */
export type AlertClass = Exclude<ExpiryClass, "safe">;

export interface BatchTransition {
  batchId: string;
  batchNumber: string;
  /** Whole days from facility-local today to expiry (negative once expired). */
  daysUntil: number;
  /** `YYYY-MM-DD`. */
  expiry: string;
  /** The class last notified for this batch (`safe` when it was never tracked). */
  from: ExpiryClass;
  itemId: string;
  /** "Paracetamol 500 mg". */
  itemName: string;
  to: AlertClass;
}

export interface LowStockEntry {
  /** FEFO-eligible total (expired stock does not count). */
  available: number;
  itemId: string;
  itemName: string;
  threshold: number;
  unit: string;
}

export interface GenerationCounts {
  expired: number;
  /** Items currently below their threshold (not only the newly low ones). */
  lowStock: number;
  nearExpiry: number;
  /** Live batches that are safe, including those with no expiry date. */
  safe: number;
  urgent: number;
}

export interface GenerationResult {
  counts: GenerationCounts;
  /** Facility-local date the run was computed for. */
  localDate: string;
  /** Items that NEWLY dropped below their threshold in this run. */
  lowStock: LowStockEntry[];
  notificationsCreated: number;
  /** Notifications marked resolved in this run. */
  resolved: number;
  /** Batches that got WORSE since the last run (what push and the digest announce). */
  transitions: BatchTransition[];
}

export interface GenerationOptions {
  now: Date;
  settings: AppSettings;
}
