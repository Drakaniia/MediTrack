/** `GET /api/requests`: board listing with filters (spec §7.4). */

import { addDays, startOfDayUtc } from "../../../shared/dates";
import { CLAIMED_ARCHIVE_HOURS } from "../../../shared/request-transitions";
import {
  DEFAULT_LIST_LIMIT,
  type RequestDto,
  type RequestListQuery,
} from "../../../shared/schemas/requests";
import type { D1DatabaseLike } from "../../env";
import { placeholders } from "../../http";
import { loadFacilityDay } from "./facility";
import { REQUEST_SELECT, type RequestRow, toRequestDtos } from "./request-read";
import { type Clause, compact, joinWhere, likePattern } from "./sql";

const MS_PER_HOUR = 3_600_000;
const LAST_7_DAYS = 6;
const LAST_30_DAYS = 29;

interface DayWindow {
  from: string | null;
  to: string | null;
}

/** Facility dates covered by the preset (`to` inclusive). */
function windowOf(query: RequestListQuery, today: string): DayWindow {
  switch (query.datePreset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -LAST_7_DAYS), to: today };
    case "30d":
      return { from: addDays(today, -LAST_30_DAYS), to: today };
    case "custom":
      return { from: query.from ?? null, to: query.to ?? null };
    default:
      return { from: null, to: null };
  }
}

function submittedWindow(window: DayWindow, timezone: string): Clause[] {
  const clauses: Clause[] = [];
  if (window.from !== null) {
    clauses.push({
      params: [startOfDayUtc(window.from, timezone).toISOString()],
      sql: "r.submitted_at >= ?",
    });
  }
  if (window.to !== null) {
    clauses.push({
      params: [startOfDayUtc(addDays(window.to, 1), timezone).toISOString()],
      sql: "r.submitted_at < ?",
    });
  }
  return clauses;
}

function statusClause(statuses: readonly string[]): Clause | null {
  if (statuses.length === 0) {
    return null;
  }
  return {
    params: [...statuses],
    sql: `r.status IN (${placeholders(statuses.length)})`,
  };
}

function searchClause(search: string | undefined): Clause | null {
  if (search === undefined || search === "") {
    return null;
  }
  const pattern = likePattern(search);
  return {
    params: [pattern, pattern, pattern, pattern],
    sql: "lower(r.code) LIKE ? ESCAPE '\\' OR lower(r.item_name) LIKE ? ESCAPE '\\' OR lower(r.requestor_name) LIKE ? ESCAPE '\\' OR lower(r.requestor_ref) LIKE ? ESCAPE '\\'",
  };
}

/** Claimed requests leave the board when archived or claimed more than 24 h ago. */
function archiveClause(includeArchived: boolean, now: Date): Clause | null {
  if (includeArchived) {
    return null;
  }
  const cutoff = new Date(now.getTime() - CLAIMED_ARCHIVE_HOURS * MS_PER_HOUR);
  return {
    params: [cutoff.toISOString()],
    sql: "NOT (r.status = 'claimed' AND (r.archived_at IS NOT NULL OR r.claimed_at <= ?))",
  };
}

export interface RequestPage {
  requests: RequestDto[];
  total: number;
}

export async function listRequests(
  db: D1DatabaseLike,
  query: RequestListQuery,
  userId: string,
  now: Date
): Promise<RequestPage> {
  const { timezone, today } = await loadFacilityDay(db, now);
  const where = joinWhere(
    "1 = 1",
    compact([
      statusClause(query.status),
      searchClause(query.search),
      ...submittedWindow(windowOf(query, today), timezone),
      query.mine ? { params: [userId], sql: "r.requested_by = ?" } : null,
      archiveClause(query.includeArchived, now),
    ])
  );
  const limit = query.limit ?? DEFAULT_LIST_LIMIT;
  const total = await db
    .prepare(`SELECT COUNT(*) AS total FROM requests r WHERE ${where.sql}`)
    .bind(...where.params)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `${REQUEST_SELECT} WHERE ${where.sql} ORDER BY r.status, r.board_position, r.submitted_at, r.id LIMIT ?`
    )
    .bind(...where.params, limit)
    .all<RequestRow>();
  return {
    requests: await toRequestDtos(db, results, now),
    total: total?.total ?? 0,
  };
}
