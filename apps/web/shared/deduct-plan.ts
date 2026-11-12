/**
 * The pure arithmetic every deduction runs on (spec §6.3, §6.4, §7.5).
 *
 * Requests hand-over and Quick Deduct both plan through `planDeduct`, so the
 * two surfaces can never disagree about what "deduct" means; their policy
 * difference is only `allowPartial`. Nothing here touches the database or the
 * clock: `today` is the facility-local `YYYY-MM-DD`.
 *
 * A refusal is a value, not an exception, so callers can show the operator's
 * words ("Only 3 tabs in stock.") instead of failing silently.
 */

import {
  type FefoBatchLike,
  fefoOrder,
  isFefoEligible,
  isQuarantined,
} from "./fefo";

/** How much of a deduction comes out of one batch. */
export interface PlanTake {
  batchId: string;
  batchNumber: string;
  expiry: string | null;
  qty: number;
}

export interface DeductPlan {
  /** Quantity still outstanding afterwards (`requested - take`). */
  remaining: number;
  /** Quantity that will actually leave the shelf. */
  take: number;
  /** One entry per batch drawn on, earliest FEFO first. */
  takes: PlanTake[];
}

export interface PlanDeductInput {
  /** Partial hand-over (queue) vs refuse a short quantity (Quick Deduct). */
  allowPartial: boolean;
  /** Every batch of the item; ineligible ones are ignored. */
  batches: readonly FefoBatchLike[];
  requested: number;
  /** Facility-local `YYYY-MM-DD`. */
  today: string;
  /** Only used to phrase a refusal, e.g. `tabs`. */
  unit?: string;
}

export type DeductPlanFailureCode =
  | "insufficient"
  | "invalid_quantity"
  | "nothing_available";

export type DeductPlanOutcome =
  | { ok: true; plan: DeductPlan }
  | {
      /** How much could have left the shelf. */
      available: number;
      code: DeductPlanFailureCode;
      message: string;
      ok: false;
    };

export type PlanProblemReason = "expired" | "missing" | "short";

export interface PlanProblem {
  /** What can still be dispensed from this batch (0 for expired/missing). */
  available: number;
  batchId: string;
  reason: PlanProblemReason;
}

export interface PlanRevalidation {
  problems: PlanProblem[];
  valid: boolean;
}

const INVALID_QUANTITY_MESSAGE =
  "Quantity must be a whole number greater than zero.";
const NOTHING_IN_STOCK_MESSAGE =
  "Nothing is in stock for this item. Stock in first.";
const ALL_EXPIRED_MESSAGE =
  "Every batch of this item is expired or empty — dispose of it or stock in.";

function withUnit(quantity: number, unit: string | undefined): string {
  const trimmed = (unit ?? "").trim();
  return trimmed === "" ? String(quantity) : `${quantity} ${trimmed}`;
}

function fail(
  code: DeductPlanFailureCode,
  available: number,
  message: string
): DeductPlanOutcome {
  return { available, code, message, ok: false };
}

function totalQty(batches: readonly { qty: number }[]): number {
  let total = 0;
  for (const batch of batches) {
    total += batch.qty;
  }
  return total;
}

/** Splits `quantity` across FEFO-ordered batches, continuing when one is exhausted. */
function splitAcross(
  ordered: readonly FefoBatchLike[],
  quantity: number
): PlanTake[] {
  const takes: PlanTake[] = [];
  let outstanding = quantity;
  for (const batch of ordered) {
    if (outstanding <= 0) {
      break;
    }
    const qty = Math.min(outstanding, batch.qty);
    takes.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiry: batch.expiry,
      qty,
    });
    outstanding -= qty;
  }
  return takes;
}

/**
 * Decides what a deduction of `requested` would take, or refuses it. Only
 * FEFO-eligible batches are drawn on: expired medicine never leaves the shelf.
 */
export function planDeduct(input: PlanDeductInput): DeductPlanOutcome {
  const { allowPartial, batches, requested, today, unit } = input;
  if (!(Number.isSafeInteger(requested) && requested > 0)) {
    return fail("invalid_quantity", 0, INVALID_QUANTITY_MESSAGE);
  }

  const ordered = fefoOrder(batches, today);
  const available = totalQty(ordered);
  if (available === 0) {
    const waitingForDisposal = batches.some((batch) =>
      isQuarantined(batch, today)
    );
    return fail(
      "nothing_available",
      0,
      waitingForDisposal ? ALL_EXPIRED_MESSAGE : NOTHING_IN_STOCK_MESSAGE
    );
  }

  const take = Math.min(requested, available);
  if (take < requested && !allowPartial) {
    return fail(
      "insufficient",
      available,
      `Only ${withUnit(available, unit)} in stock.`
    );
  }

  return {
    ok: true,
    plan: {
      remaining: requested - take,
      take,
      takes: splitAcross(ordered, take),
    },
  };
}

function problemFor(
  take: PlanTake,
  current: FefoBatchLike | undefined,
  today: string
): PlanProblem | null {
  if (!current || current.deleted === true) {
    return { available: 0, batchId: take.batchId, reason: "missing" };
  }
  if (isQuarantined(current, today)) {
    return { available: 0, batchId: take.batchId, reason: "expired" };
  }
  const available = isFefoEligible(current, today) ? current.qty : 0;
  if (available < take.qty) {
    return { available, batchId: take.batchId, reason: "short" };
  }
  return null;
}

/**
 * Hand-over re-validation (spec §6.4): which takes of an earlier plan can no
 * longer be honoured because the batch expired, was disposed/emptied, was
 * deleted, or now holds less than the plan wants.
 */
export function revalidatePlan(
  plan: { takes: readonly PlanTake[] },
  currentBatches: readonly FefoBatchLike[],
  today: string
): PlanRevalidation {
  const byId = new Map<string, FefoBatchLike>();
  for (const batch of currentBatches) {
    byId.set(batch.id, batch);
  }
  const problems: PlanProblem[] = [];
  for (const take of plan.takes) {
    const problem = problemFor(take, byId.get(take.batchId), today);
    if (problem) {
      problems.push(problem);
    }
  }
  return { problems, valid: problems.length === 0 };
}
