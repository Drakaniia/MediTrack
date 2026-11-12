/** `GET /api/disposals`: the paged write-off log. */

import { addDays, startOfDayUtc } from "../../../shared/dates";
import {
  DISPOSAL_REASONS,
  type DisposalDto,
  type DisposalReason,
  type DisposalsQuery,
} from "../../../shared/schemas/expiry";
import type { D1DatabaseLike } from "../../env";
import type { ExpiryContext } from "./context";
import type { Page, PageRequest } from "./expiry-queries";
import { type Clause, compact, joinWhere, likePattern } from "./sql";

export interface DisposalRow {
  batch_id: string | null;
  batch_number: string;
  disposed_at: string;
  disposed_by_name: string;
  expiry: string | null;
  id: string;
  item_id: string | null;
  item_name: string;
  note: string;
  qty: number;
  reason: DisposalReason;
}

export const DISPOSAL_COLUMNS =
  "id, batch_id, item_id, item_name, batch_number, expiry, qty, reason, note, disposed_by_name, disposed_at";

export function toDisposalDto(row: DisposalRow): DisposalDto {
  return {
    batchId: row.batch_id,
    batchNumber: row.batch_number,
    disposedAt: row.disposed_at,
    disposedByName: row.disposed_by_name,
    expiry: row.expiry,
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    note: row.note,
    qty: row.qty,
    reason: row.reason,
  };
}

function reasonClause(reasons: readonly DisposalReason[]): Clause | null {
  if (reasons.length === DISPOSAL_REASONS.length) {
    return null;
  }
  return {
    params: [...reasons],
    sql: `reason IN (${reasons.map(() => "?").join(", ")})`,
  };
}

/** `from` / `to` are facility-local dates (inclusive); timestamps are UTC, so convert the bounds. */
function dateClause(query: DisposalsQuery, timezone: string): Clause | null {
  const parts: string[] = [];
  const params: string[] = [];
  if (query.from !== undefined) {
    parts.push("disposed_at >= ?");
    params.push(startOfDayUtc(query.from, timezone).toISOString());
  }
  if (query.to !== undefined) {
    parts.push("disposed_at < ?");
    params.push(startOfDayUtc(addDays(query.to, 1), timezone).toISOString());
  }
  return parts.length === 0 ? null : { params, sql: parts.join(" AND ") };
}

function searchClause(search: string | undefined): Clause | null {
  if (search === undefined) {
    return null;
  }
  const pattern = likePattern(search);
  return {
    params: [pattern, pattern, pattern, pattern],
    sql: "lower(item_name) LIKE ? ESCAPE '\\' OR lower(batch_number) LIKE ? ESCAPE '\\' OR lower(disposed_by_name) LIKE ? ESCAPE '\\' OR lower(note) LIKE ? ESCAPE '\\'",
  };
}

export async function listDisposals(
  db: D1DatabaseLike,
  context: ExpiryContext,
  query: DisposalsQuery,
  paging: PageRequest
): Promise<Page<DisposalDto>> {
  const where = joinWhere(
    "1 = 1",
    compact([
      reasonClause(query.reason),
      dateClause(query, context.timezone),
      searchClause(query.search),
    ])
  );
  const [count, list] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total FROM disposals WHERE ${where.sql}`)
      .bind(...where.params)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT ${DISPOSAL_COLUMNS} FROM disposals WHERE ${where.sql} ORDER BY disposed_at DESC, id DESC LIMIT ? OFFSET ?`
      )
      .bind(...where.params, paging.limit, paging.offset)
      .all<DisposalRow>(),
  ]);
  return {
    rows: list.results.map(toDisposalDto),
    total: count?.total ?? 0,
  };
}
