/**
 * `POST /api/requests/:id/dispense`: the queue hand-over. A thin layer over the shared
 * `dispenseStock` service: it validates the request, decides how much to hand over now, and
 * supplies the request-row / history / audit statements that commit with the stock writes.
 *
 * Partial hand-over (spec §7.4): a smaller `qty`, or `allowPartial` with short availability,
 * leaves the request in Ready to Claim with `dispensed_qty` updated; the hand-over that
 * completes the quantity moves it to Claimed. Expired batches are never drawn on, so a request
 * approved while stock was fine is re-validated here against what is dispensable NOW.
 */

import type {
  DispenseInput,
  DispenseResultDto,
} from "../../../shared/schemas/requests";
import { actorOf, auditStatement } from "../../audit";
import type { D1PreparedStatement } from "../../env";
import { guardChanged } from "../../guards";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import { nextBoardPosition } from "./create-service";
import {
  type DispenseLoader,
  type DispenseOutcome,
  dispenseStock,
} from "./dispense";
import { findRecord } from "./dispensing-queries";
import {
  findRequestRow,
  loadRequestDto,
  type RequestRow,
} from "./request-read";

function assertDispensable(row: RequestRow): void {
  if (row.status !== "ready") {
    throw new HttpError(
      "invalid_transition",
      "Only a Ready to Claim request can be dispensed."
    );
  }
  if (row.item_id === null) {
    throw new HttpError(
      "conflict",
      "The item of this request no longer exists."
    );
  }
}

function wantedNow(row: RequestRow, input: DispenseInput): number {
  const outstanding = row.qty - row.dispensed_qty;
  const wanted = input.qty ?? outstanding;
  if (wanted > outstanding) {
    throw new HttpError(
      "validation_error",
      `Only ${outstanding} left to hand over for this request.`,
      { issues: [{ message: `At most ${outstanding}.`, path: "qty" }] }
    );
  }
  return wanted;
}

function requestStatements(
  ctx: ProtectedRouteContext,
  row: RequestRow,
  outcome: DispenseOutcome
): D1PreparedStatement[] {
  const { db, user } = ctx;
  const handedOver = row.dispensed_qty + outcome.qty;
  const complete = handedOver >= row.qty;
  const toStatus = complete ? "claimed" : "ready";
  const position = complete
    ? `, board_position = ${nextBoardPosition("claimed")}`
    : "";
  const note = complete
    ? `Handed over ${handedOver} of ${row.qty}`
    : `Partial hand-over: ${handedOver} of ${row.qty}`;
  return [
    db
      .prepare(
        `UPDATE requests SET dispensed_qty = ?, status = ?, claimed_at = ?, updated_at = ?${position} WHERE id = ? AND status = 'ready' AND dispensed_qty = ?`
      )
      .bind(
        handedOver,
        toStatus,
        complete ? outcome.at : null,
        outcome.at,
        row.id,
        row.dispensed_qty
      ),
    guardChanged(db, 1),
    db
      .prepare(
        "INSERT INTO request_events (id, request_id, at, from_status, to_status, actor_id, actor_name, note) VALUES (?, ?, ?, 'ready', ?, ?, ?, ?)"
      )
      .bind(
        newId(),
        row.id,
        outcome.at,
        toStatus,
        user.id,
        user.displayName,
        note
      ),
  ];
}

function batchSummary(outcome: DispenseOutcome): string {
  return outcome.takes
    .map((take) => `${take.qty} from ${take.batchNumber}`)
    .join(", ");
}

function auditStatements(
  ctx: ProtectedRouteContext,
  row: RequestRow,
  outcome: DispenseOutcome
): D1PreparedStatement[] {
  return [
    auditStatement(ctx.db, {
      action: "request.dispense",
      actor: actorOf(ctx.user),
      after: {
        dispensedQty: row.dispensed_qty + outcome.qty,
        recordId: outcome.recordId,
        takes: outcome.takes,
      },
      at: outcome.at,
      before: { dispensedQty: row.dispensed_qty, status: row.status },
      entityId: row.id,
      entityType: "request",
      ip: ctx.ip,
      summary: `${row.code}: handed over ${outcome.qty} of "${row.item_name}" (${batchSummary(outcome)})`,
    }),
  ];
}

export async function dispenseRequest(
  ctx: ProtectedRouteContext,
  requestId: string,
  input: DispenseInput
): Promise<DispenseResultDto> {
  const { db, now } = ctx;
  let before = 0;
  const load: DispenseLoader = async () => {
    const row = await findRequestRow(db, requestId);
    assertDispensable(row);
    before = row.qty - row.dispensed_qty;
    return {
      allowPartial: input.allowPartial,
      finish: (outcome) => ({
        afterRecord: auditStatements(ctx, row, outcome),
        beforeRecord: requestStatements(ctx, row, outcome),
      }),
      itemId: row.item_id as string,
      itemName: row.item_name,
      note: "",
      qty: wantedNow(row, input),
      recipientName: row.requestor_name,
      requestId: row.id,
      source: "queue",
      unit: row.unit,
    };
  };

  const { outcome } = await dispenseStock(ctx, load);
  const [record, request] = await Promise.all([
    findRecord(db, outcome.recordId),
    loadRequestDto(db, requestId, now),
  ]);
  if (!record) {
    throw new HttpError("internal_error", "The hand-over was not recorded.");
  }
  return { partial: outcome.qty < before, record, request };
}
