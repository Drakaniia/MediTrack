/**
 * THE dispensing service (spec §7.5). Queue hand-over (`POST /requests/:id/dispense`) and Quick
 * Deduct (`POST /quick-deduct`) both call `dispenseStock`, so FEFO planning, the expired-batch
 * exclusion, the per-batch record, the ledger rows and the conflict handling live in exactly one
 * place and the two surfaces cannot diverge. Their only differences are the `DispenseTarget`
 * they hand in (`allowPartial`, and the request / audit statements that ride in the same batch).
 *
 * Race safety: every attempt re-reads the target and the batches (`load`), plans with
 * `planDeduct`, and writes ONE `db.batch` of conditional updates (`qty >= ?`, still eligible)
 * each followed by `guardChanged`. A guard failure or a `CHECK (qty >= 0)` violation means the
 * world changed under us: re-plan once from fresh data, then give up with 409 `stock_conflict`.
 * Stock can never go negative: the CHECK constraint rolls the whole batch back.
 */

import {
  type DeductPlan,
  type PlanTake,
  planDeduct,
} from "../../../shared/deduct-plan";
import { isQuarantined } from "../../../shared/fefo";
import type { RequestSource } from "../../../shared/schemas/requests";
import type { D1PreparedStatement } from "../../env";
import { guardChanged, isCheckViolation, isGuardFailure } from "../../guards";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import { loadFacilityDay } from "./facility";
import {
  loadItemBatches,
  movementStatement,
  stockConflictError,
} from "./stock-sql";

/** One planning pass plus one re-plan after a lost race. */
const MAX_ATTEMPTS = 2;

export interface DispenseOutcome {
  at: string;
  /** Quantity that actually left the shelf. */
  qty: number;
  recordId: string;
  /** Quantity asked for but not handed over (only when `allowPartial`). */
  short: number;
  takes: PlanTake[];
}

export interface DispenseStatements {
  /** After the record and its lines (audit rows). */
  afterRecord: D1PreparedStatement[];
  /** After the stock writes, BEFORE the record (the request row the record points at). */
  beforeRecord: D1PreparedStatement[];
}

export interface DispenseTarget {
  /** Queue: hand over what is available when asked to; Quick Deduct: refuse a short quantity. */
  allowPartial: boolean;
  /** Builds the request / audit statements that must commit together with the stock writes. */
  finish: (outcome: DispenseOutcome) => DispenseStatements;
  itemId: string;
  itemName: string;
  note: string;
  /** Quantity wanted now. */
  qty: number;
  recipientName: string;
  requestId: string | null;
  source: RequestSource;
  unit: string;
}

/** Re-reads whatever the hand-over depends on; called afresh on every attempt. */
export type DispenseLoader = () => Promise<DispenseTarget>;

function insufficientStock(
  message: string,
  available: number,
  requested: number,
  expired: number
): HttpError {
  const suffix =
    expired > 0 ? ` ${expired} more are expired and cannot be dispensed.` : "";
  return new HttpError("insufficient_stock", `${message}${suffix}`, {
    available,
    expired,
    requested,
  });
}

function takeStatements(
  ctx: ProtectedRouteContext,
  target: DispenseTarget,
  recordId: string,
  take: PlanTake,
  today: string
): D1PreparedStatement[] {
  const { db, now, user } = ctx;
  return [
    db
      .prepare(
        "UPDATE batches SET qty = qty - ?, updated_at = ? WHERE id = ? AND qty >= ? AND status = 'active' AND deleted_at IS NULL AND (expiry IS NULL OR expiry >= ?)"
      )
      .bind(take.qty, now.toISOString(), take.batchId, take.qty, today),
    guardChanged(db, 1),
    movementStatement(db, {
      batchId: take.batchId,
      batchNumber: take.batchNumber,
      delta: -take.qty,
      itemId: target.itemId,
      itemName: target.itemName,
      kind: "dispense",
      note: target.note,
      now,
      reason: target.source === "queue" ? "Request hand-over" : "Quick deduct",
      recordId,
      user,
    }),
  ];
}

function recordStatements(
  ctx: ProtectedRouteContext,
  target: DispenseTarget,
  outcome: DispenseOutcome
): D1PreparedStatement[] {
  const { db, user } = ctx;
  const record = db
    .prepare(
      "INSERT INTO dispensing_records (id, request_id, item_id, item_name, unit, qty, source, recipient_name, dispensed_by, dispensed_by_name, dispensed_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      outcome.recordId,
      target.requestId,
      target.itemId,
      target.itemName,
      target.unit,
      outcome.qty,
      target.source,
      target.recipientName,
      user.id,
      user.displayName,
      outcome.at,
      target.note
    );
  const lines = outcome.takes.map((take) =>
    db
      .prepare(
        "INSERT INTO dispensing_lines (id, record_id, batch_id, batch_number, expiry, qty) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        newId(),
        outcome.recordId,
        take.batchId,
        take.batchNumber,
        take.expiry,
        take.qty
      )
  );
  return [record, ...lines];
}

function buildOutcome(
  ctx: ProtectedRouteContext,
  plan: DeductPlan
): DispenseOutcome {
  return {
    at: ctx.now.toISOString(),
    qty: plan.take,
    recordId: newId(),
    short: plan.remaining,
    takes: plan.takes,
  };
}

function isRaceFailure(error: unknown): boolean {
  return isGuardFailure(error) || isCheckViolation(error);
}

async function attempt(
  ctx: ProtectedRouteContext,
  load: DispenseLoader,
  attemptsLeft: number
): Promise<{ outcome: DispenseOutcome; target: DispenseTarget }> {
  const target = await load();
  const { today } = await loadFacilityDay(ctx.db, ctx.now);
  const batches = await loadItemBatches(ctx.db, target.itemId);
  const planned = planDeduct({
    allowPartial: target.allowPartial,
    batches,
    requested: target.qty,
    today,
    unit: target.unit,
  });
  if (!planned.ok) {
    const expired = batches
      .filter((batch) => isQuarantined(batch, today))
      .reduce((sum, batch) => sum + batch.qty, 0);
    throw insufficientStock(
      planned.message,
      planned.available,
      target.qty,
      expired
    );
  }

  const outcome = buildOutcome(ctx, planned.plan);
  const finish = target.finish(outcome);
  const statements = [
    ...outcome.takes.flatMap((take) =>
      takeStatements(ctx, target, outcome.recordId, take, today)
    ),
    ...finish.beforeRecord,
    ...recordStatements(ctx, target, outcome),
    ...finish.afterRecord,
  ];
  try {
    await ctx.db.batch(statements);
    return { outcome, target };
  } catch (error) {
    if (!isRaceFailure(error)) {
      throw error;
    }
    if (attemptsLeft <= 1) {
      throw stockConflictError();
    }
    return await attempt(ctx, load, attemptsLeft - 1);
  }
}

/**
 * Plans (FEFO, expired excluded) and commits one hand-over. Throws 409 `insufficient_stock`
 * naming what is on the shelf when nothing (or, without `allowPartial`, not enough) can be
 * dispensed, and 409 `stock_conflict` when two re-plans in a row lose a race.
 */
export async function dispenseStock(
  ctx: ProtectedRouteContext,
  load: DispenseLoader
): Promise<{ outcome: DispenseOutcome; target: DispenseTarget }> {
  return await attempt(ctx, load, MAX_ATTEMPTS);
}
