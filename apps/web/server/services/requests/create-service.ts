/**
 * `POST /api/requests`: one request per line (desktop behaviour), all or nothing.
 *
 * Codes are `REQ-<year>-<NNNN>` from `counters` (`request:<year>`, facility year). The counter
 * bump and the insert that reads it back are consecutive statements of the SAME `db.batch`, so
 * two concurrent creates can never read each other's number and a failed batch rolls the
 * counter back with everything else.
 */

import { zonedParts } from "../../../shared/dates";
import type {
  CreateRequestsInput,
  RequestDto,
  RequestLineInput,
} from "../../../shared/schemas/requests";
import { actorOf, auditStatement } from "../../audit";
import type { D1DatabaseLike, D1PreparedStatement } from "../../env";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import type { ProtectedRouteContext } from "../../route-types";
import { loadFacilityDay } from "./facility";
import { REQUEST_SELECT, type RequestRow, toRequestDtos } from "./request-read";
import { findLiveItem, itemLabel, type LiveItem } from "./stock-sql";

const CODE_PAD = 4;

export function counterName(year: number): string {
  return `request:${year}`;
}

/** Bumps the year's counter; the next `codeSubselect` of the same batch reads the new value. */
export function counterBumpStatement(
  db: D1DatabaseLike,
  year: number
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT (name) DO UPDATE SET value = value + 1"
    )
    .bind(counterName(year));
}

/** SQL for the `code` column; binds `[year, counterName]`. */
export const CODE_SUBSELECT = `(SELECT 'REQ-' || ? || '-' || printf('%0${CODE_PAD}d', value) FROM counters WHERE name = ?)`;

export function codeBindings(year: number): [string, string] {
  return [String(year), counterName(year)];
}

export function nextBoardPosition(status: string): string {
  return `(SELECT COALESCE(MAX(board_position), -1) + 1 FROM requests WHERE status = '${status}')`;
}

export function quantityText(qty: number, unit: string): string {
  return unit === "" ? String(qty) : `${qty} ${unit}`;
}

interface ResolvedLine {
  item: LiveItem;
  line: RequestLineInput;
}

async function resolveLines(
  db: D1DatabaseLike,
  lines: readonly RequestLineInput[]
): Promise<ResolvedLine[]> {
  const items = new Map<string, LiveItem>();
  for (const line of lines) {
    if (!items.has(line.itemId)) {
      items.set(line.itemId, await findLiveItem(db, line.itemId));
    }
  }
  return lines.map((line) => {
    const item = items.get(line.itemId);
    if (!item) {
      throw new HttpError("not_found", "The item was not found.");
    }
    return { item, line };
  });
}

function insertStatements(
  ctx: ProtectedRouteContext,
  input: CreateRequestsInput,
  resolved: ResolvedLine,
  year: number
): { id: string; statements: D1PreparedStatement[] } {
  const { db, now, user } = ctx;
  const id = newId();
  const at = now.toISOString();
  const unit = resolved.line.unit ?? resolved.item.unit;
  const itemName = itemLabel(resolved.item);
  const requestor = input.requestor ?? {};
  return {
    id,
    statements: [
      counterBumpStatement(db, year),
      db
        .prepare(
          `INSERT INTO requests (id, code, item_id, item_name, unit, qty, status, source, reason, requestor_name, requestor_ref, requestor_email, requested_by, board_position, submitted_at, updated_at) VALUES (?, ${CODE_SUBSELECT}, ?, ?, ?, ?, 'pending', 'queue', ?, ?, ?, ?, ?, ${nextBoardPosition("pending")}, ?, ?)`
        )
        .bind(
          id,
          ...codeBindings(year),
          resolved.item.id,
          itemName,
          unit,
          resolved.line.qty,
          input.reason,
          requestor.name ?? "",
          requestor.ref ?? "",
          requestor.email ?? "",
          user.id,
          at,
          at
        ),
      db
        .prepare(
          "INSERT INTO request_events (id, request_id, at, from_status, to_status, actor_id, actor_name, note) VALUES (?, ?, ?, NULL, 'pending', ?, ?, ?)"
        )
        .bind(newId(), id, at, user.id, user.displayName, "Request submitted"),
      auditStatement(db, {
        action: "request.create",
        actor: actorOf(user),
        after: { itemId: resolved.item.id, qty: resolved.line.qty, unit },
        at,
        entityId: id,
        entityType: "request",
        ip: ctx.ip,
        summary: `Requested ${quantityText(resolved.line.qty, unit)} of "${itemName}"`,
      }),
    ],
  };
}

export async function createRequests(
  ctx: ProtectedRouteContext,
  input: CreateRequestsInput
): Promise<RequestDto[]> {
  const { db, now } = ctx;
  const resolved = await resolveLines(db, input.lines);
  const { timezone } = await loadFacilityDay(db, now);
  const { year } = zonedParts(now, timezone);

  const built = resolved.map((line) =>
    insertStatements(ctx, input, line, year)
  );
  await db.batch(built.flatMap((entry) => entry.statements));

  const ids = built.map((entry) => entry.id);
  const rows: RequestRow[] = [];
  for (const id of ids) {
    const row = await db
      .prepare(`${REQUEST_SELECT} WHERE r.id = ?`)
      .bind(id)
      .first<RequestRow>();
    if (row) {
      rows.push(row);
    }
  }
  return await toRequestDtos(db, rows, now);
}
