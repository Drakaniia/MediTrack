/**
 * Board mutations that do not move stock: status transitions, cancel, edits, ordering, archive.
 * Every one is ONE `db.batch` (write + `request_events` + audit) guarded against a concurrent
 * change of the same row (`guardChanged` → 409 `conflict`).
 */

import { can } from "../../../shared/permissions";
import {
  canCancel,
  canEdit,
  canMove,
  type RequestStatus,
} from "../../../shared/request-transitions";
import type {
  ArchiveResultDto,
  CancelInput,
  ReorderInput,
  RequestDto,
  TransitionInput,
  UpdateRequestInput,
} from "../../../shared/schemas/requests";
import { actorOf, auditStatement } from "../../audit";
import type { D1DatabaseLike, D1PreparedStatement } from "../../env";
import { batchOrConflict, guardChanged } from "../../guards";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import { nextBoardPosition } from "./create-service";
import {
  findRequestRow,
  loadRequestDto,
  type RequestRow,
} from "./request-read";

function requestChanged(): HttpError {
  return new HttpError(
    "conflict",
    "The request changed while you were working. Refresh and try again."
  );
}

function invalidTransition(message: string): HttpError {
  return new HttpError("invalid_transition", message);
}

function eventStatement(
  ctx: ProtectedRouteContext,
  row: RequestRow,
  toStatus: RequestStatus,
  note: string
): D1PreparedStatement {
  const { db, now, user } = ctx;
  return db
    .prepare(
      "INSERT INTO request_events (id, request_id, at, from_status, to_status, actor_id, actor_name, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      newId(),
      row.id,
      now.toISOString(),
      row.status,
      toStatus,
      user.id,
      user.displayName,
      note
    );
}

function assertOwnerOrProcessor(
  ctx: ProtectedRouteContext,
  row: RequestRow
): void {
  const isOwner = row.requested_by !== null && row.requested_by === ctx.user.id;
  if (!(isOwner || can(ctx.user.role, "requests.process"))) {
    throw new HttpError(
      "forbidden",
      "Only the person who made the request or a pharmacist can change it."
    );
  }
}

function assertDirectMove(row: RequestRow, to: RequestStatus): void {
  if (to === "claimed") {
    throw invalidTransition(
      "A request is claimed by handing it over: use Dispense."
    );
  }
  if (to === "cancelled") {
    throw invalidTransition("Use Cancel to withdraw a request.");
  }
  if (!canMove(row.status, to)) {
    throw invalidTransition(`A ${row.status} request cannot become ${to}.`);
  }
  if (row.dispensed_qty > 0) {
    throw invalidTransition(
      "Part of this request was already handed over, so it can only be completed."
    );
  }
}

function deniedNoteOf(input: TransitionInput): string {
  return [input.deniedReason, input.deniedNote, input.note]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" · ");
}

export async function transitionRequest(
  ctx: ProtectedRouteContext,
  requestId: string,
  input: TransitionInput
): Promise<RequestDto> {
  const { db, now, user } = ctx;
  const row = await findRequestRow(db, requestId);
  assertDirectMove(row, input.to);

  const at = now.toISOString();
  const denied = input.to === "denied";
  const note = denied ? deniedNoteOf(input) : (input.note ?? "");
  await batchOrConflict(
    db,
    [
      db
        .prepare(
          `UPDATE requests SET status = ?, denied_reason = ?, denied_note = ?, board_position = ${nextBoardPosition(input.to)}, updated_at = ? WHERE id = ? AND status = ?`
        )
        .bind(
          input.to,
          denied ? (input.deniedReason ?? null) : null,
          denied ? (input.deniedNote ?? "") : "",
          at,
          row.id,
          row.status
        ),
      guardChanged(db, 1),
      eventStatement(ctx, row, input.to, note),
      auditStatement(db, {
        action: "request.transition",
        actor: actorOf(user),
        after: {
          status: input.to,
          ...(denied ? { deniedReason: input.deniedReason } : {}),
        },
        at,
        before: { status: row.status },
        entityId: row.id,
        entityType: "request",
        ip: ctx.ip,
        summary: `${row.code}: ${row.status} → ${input.to}`,
      }),
    ],
    requestChanged()
  );
  return await loadRequestDto(db, row.id, now);
}

export async function cancelRequest(
  ctx: ProtectedRouteContext,
  requestId: string,
  input: CancelInput
): Promise<RequestDto> {
  const { db, now, user } = ctx;
  const row = await findRequestRow(db, requestId);
  assertOwnerOrProcessor(ctx, row);
  if (!canCancel(row.status) || row.dispensed_qty > 0) {
    throw invalidTransition(
      row.dispensed_qty > 0
        ? "Part of this request was already handed over, so it cannot be cancelled."
        : `A ${row.status} request cannot be cancelled.`
    );
  }
  const at = now.toISOString();
  await batchOrConflict(
    db,
    [
      db
        .prepare(
          "UPDATE requests SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = ? AND dispensed_qty = 0"
        )
        .bind(at, row.id, row.status),
      guardChanged(db, 1),
      eventStatement(ctx, row, "cancelled", input.note ?? "Cancelled"),
      auditStatement(db, {
        action: "request.cancel",
        actor: actorOf(user),
        after: { status: "cancelled" },
        at,
        before: { status: row.status },
        entityId: row.id,
        entityType: "request",
        ip: ctx.ip,
        summary: `${row.code} cancelled`,
      }),
    ],
    requestChanged()
  );
  return await loadRequestDto(db, row.id, now);
}

export async function updateRequest(
  ctx: ProtectedRouteContext,
  requestId: string,
  input: UpdateRequestInput
): Promise<RequestDto> {
  const { db, now, user } = ctx;
  const row = await findRequestRow(db, requestId);
  assertOwnerOrProcessor(ctx, row);
  if (!canEdit(row.status)) {
    throw invalidTransition("Only pending or approved requests can be edited.");
  }
  const at = now.toISOString();
  const requestor = input.requestor ?? {};
  await batchOrConflict(
    db,
    [
      db
        .prepare(
          "UPDATE requests SET reason = COALESCE(?, reason), requestor_name = COALESCE(?, requestor_name), requestor_ref = COALESCE(?, requestor_ref), requestor_email = COALESCE(?, requestor_email), updated_at = ? WHERE id = ? AND status = ?"
        )
        .bind(
          input.reason ?? null,
          requestor.name ?? null,
          requestor.ref ?? null,
          requestor.email ?? null,
          at,
          row.id,
          row.status
        ),
      guardChanged(db, 1),
      auditStatement(db, {
        action: "request.update",
        actor: actorOf(user),
        after: input,
        at,
        before: {
          reason: row.reason,
          requestor: {
            email: row.requestor_email,
            name: row.requestor_name,
            ref: row.requestor_ref,
          },
        },
        entityId: row.id,
        entityType: "request",
        ip: ctx.ip,
        summary: `${row.code} details edited`,
      }),
    ],
    requestChanged()
  );
  return await loadRequestDto(db, row.id, now);
}

/** Board order of one column: `orderedIds[0]` is the top card. Ids of another column are ignored. */
export async function reorderRequests(
  ctx: ProtectedRouteContext,
  input: ReorderInput
): Promise<{ reordered: number }> {
  const { db, now, user } = ctx;
  const moves = input.orderedIds.map((id, index) =>
    db
      .prepare(
        "UPDATE requests SET board_position = ? WHERE id = ? AND status = ?"
      )
      .bind(index, id, input.status)
  );
  await db.batch([
    ...moves,
    auditStatement(db, {
      action: "request.reorder",
      actor: actorOf(user),
      after: { orderedIds: input.orderedIds, status: input.status },
      at: now.toISOString(),
      entityType: "request",
      ip: ctx.ip,
      summary: `Reordered ${input.orderedIds.length} ${input.status} request(s)`,
    }),
  ]);
  return { reordered: input.orderedIds.length };
}

async function countUnarchivedClaimed(db: D1DatabaseLike): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS total FROM requests WHERE status = 'claimed' AND archived_at IS NULL"
    )
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Clears the Claimed lane: the rows stay in the database and in the dispensing log. */
export async function archiveClaimed(
  ctx: ProtectedRouteContext
): Promise<ArchiveResultDto> {
  const { db, now, user } = ctx;
  const archived = await countUnarchivedClaimed(db);
  if (archived === 0) {
    return { archived: 0 };
  }
  const at = now.toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE requests SET archived_at = ?, updated_at = ? WHERE status = 'claimed' AND archived_at IS NULL"
      )
      .bind(at, at),
    auditStatement(db, {
      action: "request.archive",
      actor: actorOf(user),
      after: { archived },
      at,
      entityType: "request",
      ip: ctx.ip,
      summary: `Cleared ${archived} claimed request(s) from the board`,
    }),
  ]);
  return { archived };
}
