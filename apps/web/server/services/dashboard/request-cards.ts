/** Pending requests and recent dispensing cards. */

import {
  DASHBOARD_LIST_LIMIT,
  DASHBOARD_PENDING_LIMIT,
  PENDING_CARD_STATUSES,
  type PendingCardStatus,
  type PendingRequestDto,
  type PendingRequestsCardDto,
  type RecentDispensingBatchDto,
  type RecentDispensingDto,
} from "../../../shared/schemas/dashboard";
import type { D1DatabaseLike } from "../../env";

interface StatusCountRow {
  n: number;
  status: PendingCardStatus;
}

interface PendingRow {
  code: string;
  id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  requested_by_name: string | null;
  requestor_name: string;
  submitted_at: string;
  unit: string;
}

function toPending(row: PendingRow): PendingRequestDto {
  return {
    code: row.code,
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    qty: row.qty,
    requestorName: row.requestor_name || row.requested_by_name || "",
    submittedAt: row.submitted_at,
    unit: row.unit,
  };
}

const STATUS_LIST = PENDING_CARD_STATUSES.map((status) => `'${status}'`).join(
  ", "
);

export async function loadPendingRequests(
  db: D1DatabaseLike
): Promise<PendingRequestsCardDto> {
  const [counts, oldest] = await Promise.all([
    db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM requests WHERE archived_at IS NULL AND status IN (${STATUS_LIST}) GROUP BY status`
      )
      .all<StatusCountRow>(),
    db
      .prepare(
        "SELECT r.id, r.code, r.item_id, r.item_name, r.unit, r.qty, r.requestor_name, u.display_name AS requested_by_name, r.submitted_at FROM requests r LEFT JOIN users u ON u.id = r.requested_by WHERE r.archived_at IS NULL AND r.status = 'pending' ORDER BY r.submitted_at, r.id LIMIT ?"
      )
      .bind(DASHBOARD_PENDING_LIMIT)
      .all<PendingRow>(),
  ]);
  const byStatus: Record<PendingCardStatus, number> = {
    approved: 0,
    pending: 0,
    ready: 0,
  };
  for (const row of counts.results) {
    byStatus[row.status] = row.n;
  }
  return { counts: byStatus, oldestPending: oldest.results.map(toPending) };
}

interface RecentRow {
  dispensed_at: string;
  dispensed_by_name: string;
  id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  source: "queue" | "quick_deduct";
  unit: string;
}

interface LineRow {
  batch_number: string;
  qty: number;
  record_id: string;
}

function groupLines(
  rows: readonly LineRow[]
): Map<string, RecentDispensingBatchDto[]> {
  const grouped = new Map<string, RecentDispensingBatchDto[]>();
  for (const row of rows) {
    const list = grouped.get(row.record_id) ?? [];
    list.push({ batchNumber: row.batch_number, qty: row.qty });
    grouped.set(row.record_id, list);
  }
  return grouped;
}

/** The latest hand-overs that were not undone, newest first, with the batches they drew from. */
export async function loadRecentDispensing(
  db: D1DatabaseLike
): Promise<RecentDispensingDto[]> {
  const { results: records } = await db
    .prepare(
      "SELECT id, item_id, item_name, unit, qty, source, dispensed_by_name, dispensed_at FROM dispensing_records WHERE undone_at IS NULL ORDER BY dispensed_at DESC, id DESC LIMIT ?"
    )
    .bind(DASHBOARD_LIST_LIMIT)
    .all<RecentRow>();
  if (records.length === 0) {
    return [];
  }
  const { results: lines } = await db
    .prepare(
      "SELECT record_id, batch_number, qty FROM dispensing_lines WHERE record_id IN (SELECT value FROM json_each(?)) ORDER BY rowid"
    )
    .bind(JSON.stringify(records.map((record) => record.id)))
    .all<LineRow>();
  const batches = groupLines(lines);
  return records.map((record) => ({
    batches: batches.get(record.id) ?? [],
    dispensedAt: record.dispensed_at,
    dispensedByName: record.dispensed_by_name,
    id: record.id,
    itemId: record.item_id,
    itemName: record.item_name,
    qty: record.qty,
    source: record.source,
    unit: record.unit,
  }));
}
