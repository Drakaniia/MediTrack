/** Reading requests: row → DTO mapping, history events, hand-overs and live availability. */

import type {
  DenyReason,
  RequestStatus,
} from "../../../shared/request-transitions";
import type {
  RequestDto,
  RequestEventDto,
  RequestSource,
} from "../../../shared/schemas/requests";
import type { D1DatabaseLike } from "../../env";
import { chunk, HttpError, placeholders } from "../../http";
import { recordsByRequest } from "./dispensing-queries";
import { loadFacilityDay } from "./facility";

export interface RequestRow {
  archived_at: string | null;
  board_position: number;
  claimed_at: string | null;
  code: string;
  denied_note: string;
  denied_reason: DenyReason | null;
  dispensed_qty: number;
  id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  reason: string;
  requested_by: string | null;
  requested_by_name: string | null;
  requestor_email: string;
  requestor_name: string;
  requestor_ref: string;
  source: RequestSource;
  status: RequestStatus;
  submitted_at: string;
  unit: string;
  updated_at: string;
}

export const REQUEST_SELECT =
  "SELECT r.id, r.code, r.item_id, r.item_name, r.unit, r.qty, r.dispensed_qty, r.status, r.source, r.reason, r.requestor_name, r.requestor_ref, r.requestor_email, r.requested_by, u.display_name AS requested_by_name, r.denied_reason, r.denied_note, r.board_position, r.submitted_at, r.claimed_at, r.archived_at, r.updated_at FROM requests r LEFT JOIN users u ON u.id = r.requested_by";

interface EventRow {
  actor_name: string;
  at: string;
  from_status: RequestStatus | null;
  id: string;
  note: string;
  request_id: string;
  to_status: RequestStatus;
}

export async function findRequestRow(
  db: D1DatabaseLike,
  requestId: string
): Promise<RequestRow> {
  const row = await db
    .prepare(`${REQUEST_SELECT} WHERE r.id = ?`)
    .bind(requestId)
    .first<RequestRow>();
  if (!row) {
    throw new HttpError("not_found", "The request was not found.");
  }
  return row;
}

async function eventsByRequest(
  db: D1DatabaseLike,
  requestIds: readonly string[]
): Promise<Map<string, RequestEventDto[]>> {
  const grouped = new Map<string, RequestEventDto[]>();
  for (const ids of chunk(requestIds)) {
    const { results } = await db
      .prepare(
        `SELECT id, request_id, at, from_status, to_status, actor_name, note FROM request_events WHERE request_id IN (${placeholders(ids.length)}) ORDER BY at, rowid`
      )
      .bind(...ids)
      .all<EventRow>();
    for (const row of results) {
      const list = grouped.get(row.request_id) ?? [];
      list.push({
        actorName: row.actor_name,
        at: row.at,
        fromStatus: row.from_status,
        id: row.id,
        note: row.note,
        toStatus: row.to_status,
      });
      grouped.set(row.request_id, list);
    }
  }
  return grouped;
}

/** Σ qty of FEFO-eligible batches (active, qty > 0, not expired, not trashed) per item. */
async function availabilityByItem(
  db: D1DatabaseLike,
  itemIds: readonly string[],
  today: string
): Promise<Map<string, number>> {
  const available = new Map<string, number>();
  for (const ids of chunk(itemIds, 80)) {
    const { results } = await db
      .prepare(
        `SELECT b.item_id, SUM(b.qty) AS available FROM batches b JOIN items i ON i.id = b.item_id WHERE b.item_id IN (${placeholders(ids.length)}) AND b.deleted_at IS NULL AND i.deleted_at IS NULL AND b.status = 'active' AND b.qty > 0 AND (b.expiry IS NULL OR b.expiry >= ?) GROUP BY b.item_id`
      )
      .bind(...ids, today)
      .all<{ available: number; item_id: string }>();
    for (const row of results) {
      available.set(row.item_id, row.available);
    }
  }
  return available;
}

function uniqueItemIds(rows: readonly RequestRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.item_id !== null) {
      ids.add(row.item_id);
    }
  }
  return [...ids];
}

/** Full DTOs (history, hand-overs, availability) for `rows`, in the same order. */
export async function toRequestDtos(
  db: D1DatabaseLike,
  rows: readonly RequestRow[],
  now: Date
): Promise<RequestDto[]> {
  if (rows.length === 0) {
    return [];
  }
  const { today } = await loadFacilityDay(db, now);
  const ids = rows.map((row) => row.id);
  const [events, records, available] = await Promise.all([
    eventsByRequest(db, ids),
    recordsByRequest(db, ids),
    availabilityByItem(db, uniqueItemIds(rows), today),
  ]);
  return rows.map((row) => ({
    archivedAt: row.archived_at,
    availableNow: row.item_id === null ? 0 : (available.get(row.item_id) ?? 0),
    boardPosition: row.board_position,
    claimedAt: row.claimed_at,
    code: row.code,
    deniedNote: row.denied_note,
    deniedReason: row.denied_reason,
    dispensedQty: row.dispensed_qty,
    dispensing: records.get(row.id) ?? [],
    events: events.get(row.id) ?? [],
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    qty: row.qty,
    reason: row.reason,
    remaining: Math.max(row.qty - row.dispensed_qty, 0),
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name ?? "",
    requestor: {
      email: row.requestor_email,
      name: row.requestor_name,
      ref: row.requestor_ref,
    },
    source: row.source,
    status: row.status,
    submittedAt: row.submitted_at,
    unit: row.unit,
    updatedAt: row.updated_at,
  }));
}

export async function loadRequestDto(
  db: D1DatabaseLike,
  requestId: string,
  now: Date
): Promise<RequestDto> {
  const row = await findRequestRow(db, requestId);
  const [dto] = await toRequestDtos(db, [row], now);
  return dto;
}
