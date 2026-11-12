/**
 * Quick Deduct (Ctrl+D, spec §7.5): one item, one quantity, one confirm, with a short undo window.
 *
 * The hand-over itself is the shared `dispenseStock` service (FEFO across batches, expired stock
 * excluded, per-batch record, ledger rows, conflict re-plan); this module only adds what is
 * specific to Quick Deduct: a `source = 'quick_deduct'` request created directly in Claimed, the
 * refusal of a short quantity (`allowPartial: false`), and the undo.
 */

import { QUICK_DEDUCT_UNDO_SECONDS } from "../../../shared/api";
import { zonedParts } from "../../../shared/dates";
import {
  type DispensingRecordDto,
  QUICK_DEDUCT_LABEL,
  type QuickDeductInput,
  type QuickDeductResultDto,
} from "../../../shared/schemas/requests";
import { actorOf, auditStatement } from "../../audit";
import type { D1DatabaseLike, D1PreparedStatement } from "../../env";
import { batchOrConflict, guardChanged } from "../../guards";
import { chunk, HttpError, placeholders } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import {
  CODE_SUBSELECT,
  codeBindings,
  counterBumpStatement,
  nextBoardPosition,
  quantityText,
} from "./create-service";
import { type DispenseOutcome, dispenseStock } from "./dispense";
import { findRecord } from "./dispensing-queries";
import { loadFacilityDay } from "./facility";
import { findLiveItem, itemLabel, movementStatement } from "./stock-sql";

const MS_PER_SECOND = 1000;

function undoDeadline(dispensedAt: string): Date {
  return new Date(
    new Date(dispensedAt).getTime() + QUICK_DEDUCT_UNDO_SECONDS * MS_PER_SECOND
  );
}

function requestStatements(
  ctx: ProtectedRouteContext,
  input: QuickDeductInput,
  requestId: string,
  itemName: string,
  unit: string,
  year: number,
  outcome: DispenseOutcome
): D1PreparedStatement[] {
  const { db, user } = ctx;
  return [
    counterBumpStatement(db, year),
    db
      .prepare(
        `INSERT INTO requests (id, code, item_id, item_name, unit, qty, dispensed_qty, status, source, reason, requestor_name, requested_by, board_position, submitted_at, claimed_at, updated_at) VALUES (?, ${CODE_SUBSELECT}, ?, ?, ?, ?, ?, 'claimed', 'quick_deduct', ?, ?, ?, ${nextBoardPosition("claimed")}, ?, ?, ?)`
      )
      .bind(
        requestId,
        ...codeBindings(year),
        input.itemId,
        itemName,
        unit,
        outcome.qty,
        outcome.qty,
        input.note ?? "",
        input.recipient ?? "",
        user.id,
        outcome.at,
        outcome.at,
        outcome.at
      ),
    db
      .prepare(
        "INSERT INTO request_events (id, request_id, at, from_status, to_status, actor_id, actor_name, note) VALUES (?, ?, ?, NULL, 'claimed', ?, ?, ?)"
      )
      .bind(
        newId(),
        requestId,
        outcome.at,
        user.id,
        user.displayName,
        QUICK_DEDUCT_LABEL
      ),
  ];
}

function batchSummary(outcome: DispenseOutcome): string {
  return outcome.takes
    .map((take) => `${take.qty} from ${take.batchNumber}`)
    .join(", ");
}

export async function quickDeduct(
  ctx: ProtectedRouteContext,
  input: QuickDeductInput
): Promise<QuickDeductResultDto> {
  const { db, now } = ctx;
  const { outcome } = await dispenseStock(ctx, async () => {
    const item = await findLiveItem(db, input.itemId);
    const { timezone } = await loadFacilityDay(db, now);
    const { year } = zonedParts(now, timezone);
    const requestId = newId();
    const itemName = itemLabel(item);
    return {
      allowPartial: false,
      finish: (done) => ({
        afterRecord: [
          auditStatement(db, {
            action: "quick_deduct.create",
            actor: actorOf(ctx.user),
            after: {
              qty: done.qty,
              recordId: done.recordId,
              takes: done.takes,
            },
            at: done.at,
            entityId: done.recordId,
            entityType: "dispensing_record",
            ip: ctx.ip,
            summary: `Quick deduct: ${quantityText(done.qty, item.unit)} of "${itemName}" (${batchSummary(done)})`,
          }),
        ],
        beforeRecord: requestStatements(
          ctx,
          input,
          requestId,
          itemName,
          item.unit,
          year,
          done
        ),
      }),
      itemId: item.id,
      itemName,
      note: input.note ?? "",
      qty: input.qty,
      recipientName: input.recipient ?? "",
      requestId,
      source: "quick_deduct",
      unit: item.unit,
    };
  });
  const record = await findRecord(db, outcome.recordId);
  if (!record) {
    throw new HttpError("internal_error", "The deduction was not recorded.");
  }
  return {
    record,
    undoUntil: undoDeadline(record.dispensedAt).toISOString(),
  };
}

// ─── Undo ───────────────────────────────────────────────────────────────────

interface RestorableBatch {
  deleted_at: string | null;
  id: string;
  status: string;
}

function undoConflict(message: string): HttpError {
  return new HttpError("conflict", message);
}

async function loadRestorable(
  db: D1DatabaseLike,
  record: DispensingRecordDto
): Promise<Map<string, RestorableBatch>> {
  const ids = record.lines.flatMap((line) =>
    line.batchId === null ? [] : [line.batchId]
  );
  const found = new Map<string, RestorableBatch>();
  for (const group of chunk(ids)) {
    const { results } = await db
      .prepare(
        `SELECT id, deleted_at, status FROM batches WHERE id IN (${placeholders(group.length)})`
      )
      .bind(...group)
      .all<RestorableBatch>();
    for (const row of results) {
      found.set(row.id, row);
    }
  }
  return found;
}

function assertUndoable(
  ctx: ProtectedRouteContext,
  record: DispensingRecordDto
): void {
  if (record.source !== "quick_deduct") {
    throw undoConflict("Only a Quick Deduct can be undone.");
  }
  if (record.undoneAt !== null) {
    throw undoConflict("This Quick Deduct was already undone.");
  }
  const { role, id } = ctx.user;
  if (!(id === record.dispensedBy || role === "admin")) {
    throw new HttpError(
      "forbidden",
      "Only the person who made the Quick Deduct can undo it."
    );
  }
  if (ctx.now.getTime() > undoDeadline(record.dispensedAt).getTime()) {
    throw undoConflict(
      `The ${QUICK_DEDUCT_UNDO_SECONDS}-second undo window has passed.`
    );
  }
}

function assertBatchesRestorable(
  record: DispensingRecordDto,
  batches: Map<string, RestorableBatch>
): void {
  for (const line of record.lines) {
    const batch = line.batchId === null ? undefined : batches.get(line.batchId);
    if (!batch || batch.deleted_at !== null || batch.status !== "active") {
      throw undoConflict(
        `Batch ${line.batchNumber} no longer exists or was disposed, so the stock cannot be put back.`
      );
    }
  }
}

function restoreStatements(
  ctx: ProtectedRouteContext,
  record: DispensingRecordDto
): D1PreparedStatement[] {
  const { db, now, user } = ctx;
  const at = now.toISOString();
  return record.lines.flatMap((line) => [
    db
      .prepare(
        "UPDATE batches SET qty = qty + ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND status = 'active'"
      )
      .bind(line.qty, at, line.batchId),
    guardChanged(db, 1),
    movementStatement(db, {
      batchId: line.batchId as string,
      batchNumber: line.batchNumber,
      delta: line.qty,
      itemId: record.itemId,
      itemName: record.itemName,
      kind: "undo_dispense",
      note: "",
      now,
      reason: "Quick deduct undone",
      recordId: record.id,
      user,
    }),
  ]);
}

function requestCancelStatements(
  ctx: ProtectedRouteContext,
  record: DispensingRecordDto
): D1PreparedStatement[] {
  if (record.requestId === null) {
    return [];
  }
  const { db, now, user } = ctx;
  const at = now.toISOString();
  return [
    db
      .prepare(
        "UPDATE requests SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'claimed'"
      )
      .bind(at, record.requestId),
    db
      .prepare(
        "INSERT INTO request_events (id, request_id, at, from_status, to_status, actor_id, actor_name, note) VALUES (?, ?, ?, 'claimed', 'cancelled', ?, ?, ?)"
      )
      .bind(
        newId(),
        record.requestId,
        at,
        user.id,
        user.displayName,
        "Quick deduct undone"
      ),
  ];
}

export async function undoQuickDeduct(
  ctx: ProtectedRouteContext,
  recordId: string
): Promise<DispensingRecordDto> {
  const { db, now, user } = ctx;
  const record = await findRecord(db, recordId);
  if (!record) {
    throw new HttpError("not_found", "The Quick Deduct was not found.");
  }
  assertUndoable(ctx, record);
  assertBatchesRestorable(record, await loadRestorable(db, record));

  const at = now.toISOString();
  await batchOrConflict(
    db,
    [
      db
        .prepare(
          "UPDATE dispensing_records SET undone_at = ?, undone_by = ? WHERE id = ? AND undone_at IS NULL"
        )
        .bind(at, user.id, record.id),
      guardChanged(db, 1),
      ...restoreStatements(ctx, record),
      ...requestCancelStatements(ctx, record),
      auditStatement(db, {
        action: "quick_deduct.undo",
        actor: actorOf(user),
        after: { undone: true },
        at,
        before: { lines: record.lines, qty: record.qty },
        entityId: record.id,
        entityType: "dispensing_record",
        ip: ctx.ip,
        summary: `Undid Quick Deduct of ${quantityText(record.qty, record.unit)} "${record.itemName}"`,
      }),
    ],
    undoConflict(
      "The stock changed while you were working, so the undo could not be completed."
    )
  );
  const updated = await findRecord(db, record.id);
  return updated ?? record;
}
