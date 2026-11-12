/**
 * First-Expired-First-Out ordering (spec §6.3, §6.5).
 *
 * Pure and runtime-agnostic: `today` is the facility-local `YYYY-MM-DD` the
 * caller computed with `todayInZone()`, never read from a clock here. Expiry
 * dates are plain ISO calendar dates, so they compare correctly as strings.
 *
 * The SQL twin of `compareFefo` is `FEFO_ORDER_SQL`; keep the two in step.
 * `batch_number_lower` is the stored lower-cased batch number, so batch numbers
 * order lexicographically, NOT naturally: `b10` sorts before `b2`. That is
 * deliberate (it must match the SQL index) and only matters as a last tie-break
 * after expiry and received date.
 */

import type { BatchStatus } from "./schemas/inventory";

/** The fields FEFO reads. Any richer batch row satisfies it structurally. */
export interface FefoBatchLike {
  batchNumber: string;
  /** Soft-deleted rows (Trash). Absent means not deleted. */
  deleted?: boolean;
  /** `YYYY-MM-DD`, or null when the batch never expires. */
  expiry: string | null;
  id: string;
  qty: number;
  /** `YYYY-MM-DD`. */
  receivedOn: string;
  status: BatchStatus;
}

/** The strict shape the spec names; `FefoBatchLike` is what functions accept. */
export interface FefoBatch extends FefoBatchLike {
  deleted: boolean;
  quarantined?: never;
}

/** Just the fields `compareFefo` orders by. */
export type FefoSortKey = Pick<
  FefoBatchLike,
  "batchNumber" | "expiry" | "id" | "receivedOn"
>;

export interface DisplayBatchGroups<T extends FefoBatchLike> {
  /** Dispensable now, in FEFO order. */
  eligible: T[];
  /** Neither dispensable nor quarantined: empty or disposed. Soft-deleted rows are dropped. */
  inactive: T[];
  /** Expired but still holding stock, waiting for disposal; earliest expiry first. */
  quarantined: T[];
}

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

function hasExpiry(expiry: string | null): expiry is string {
  return typeof expiry === "string" && expiry !== "";
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** Earliest first; a batch with no expiry sorts after every dated one. */
function compareExpiry(a: string | null, b: string | null): number {
  const aDated = hasExpiry(a);
  const bDated = hasExpiry(b);
  if (aDated && bDated) {
    return compareText(a, b);
  }
  if (aDated) {
    return -1;
  }
  return bDated ? 1 : 0;
}

function isLive(batch: FefoBatchLike): boolean {
  return batch.deleted !== true && batch.status === "active" && batch.qty > 0;
}

/** Can this batch be dispensed today? Same-day expiry is still dispensable. */
export function isFefoEligible(batch: FefoBatchLike, today: string): boolean {
  if (!isLive(batch)) {
    return false;
  }
  return !hasExpiry(batch.expiry) || batch.expiry >= today;
}

/** Expired, still active, still holding stock: waits for the disposal flow. */
export function isQuarantined(batch: FefoBatchLike, today: string): boolean {
  return isLive(batch) && hasExpiry(batch.expiry) && batch.expiry < today;
}

/** expiry asc (none last), then received date, then batch number (case-insensitive), then id. */
export function compareFefo(a: FefoSortKey, b: FefoSortKey): number {
  return (
    compareExpiry(a.expiry, b.expiry) ||
    compareText(a.receivedOn, b.receivedOn) ||
    compareText(a.batchNumber.toLowerCase(), b.batchNumber.toLowerCase()) ||
    compareText(a.id, b.id)
  );
}

/** Eligible batches only, in FEFO order, as a new array. The input is not mutated. */
export function fefoOrder<T extends FefoBatchLike>(
  batches: readonly T[],
  today: string
): T[] {
  return batches
    .filter((batch) => isFefoEligible(batch, today))
    .sort(compareFefo);
}

/** Batch id → 1-based FEFO position. Ineligible batches have no entry. */
export function fefoRanks(
  batches: readonly FefoBatchLike[],
  today: string
): Map<string, number> {
  const ranks = new Map<string, number>();
  let rank = 1;
  for (const batch of fefoOrder(batches, today)) {
    ranks.set(batch.id, rank);
    rank += 1;
  }
  return ranks;
}

/** The batch to pull first, or undefined when nothing is dispensable. */
export function nextFefoBatch<T extends FefoBatchLike>(
  batches: readonly T[],
  today: string
): T | undefined {
  return fefoOrder(batches, today)[0];
}

/** Item-detail grouping: FEFO order, then quarantined, then empty/disposed. */
export function splitBatchesForDisplay<T extends FefoBatchLike>(
  batches: readonly T[],
  today: string
): DisplayBatchGroups<T> {
  const groups: DisplayBatchGroups<T> = {
    eligible: [],
    inactive: [],
    quarantined: [],
  };
  for (const batch of batches) {
    if (batch.deleted === true) {
      continue;
    }
    if (isFefoEligible(batch, today)) {
      groups.eligible.push(batch);
    } else if (isQuarantined(batch, today)) {
      groups.quarantined.push(batch);
    } else {
      groups.inactive.push(batch);
    }
  }
  groups.eligible.sort(compareFefo);
  groups.quarantined.sort(compareFefo);
  groups.inactive.sort(compareFefo);
  return groups;
}

/**
 * `ORDER BY` fragment matching `compareFefo`, optionally qualified with a table
 * alias (`fefoOrderSql("b")` → `b.expiry IS NULL, b.expiry, …`). The alias is
 * the only interpolated text, so it must be a plain identifier.
 */
export function fefoOrderSql(alias?: string): string {
  let prefix = "";
  if (alias !== undefined && alias !== "") {
    if (!SQL_IDENTIFIER.test(alias)) {
      throw new Error(`Invalid SQL alias: ${JSON.stringify(alias)}`);
    }
    prefix = `${alias}.`;
  }
  return [
    `${prefix}expiry IS NULL`,
    `${prefix}expiry`,
    `${prefix}received_on`,
    `${prefix}batch_number_lower`,
    `${prefix}id`,
  ].join(", ");
}

/** Unqualified `ORDER BY` fragment: `expiry IS NULL, expiry, received_on, batch_number_lower, id`. */
export const FEFO_ORDER_SQL: string = fefoOrderSql();
