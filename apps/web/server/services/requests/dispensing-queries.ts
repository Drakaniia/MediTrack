/** Dispensing records: DTO mapping, the paged log and the monthly per-batch totals (spec §7.5). */

import {
  addDays,
  startOfDayUtc,
  utcRangeForMonth,
} from "../../../shared/dates";
import type {
  DispensingLineDto,
  DispensingListQuery,
  DispensingRecordDto,
  MonthlyBatchDto,
  MonthlyDispensingDto,
  MonthlyItemDto,
  RequestSource,
} from "../../../shared/schemas/requests";
import type { D1DatabaseLike } from "../../env";
import { chunk, type Paging, placeholders } from "../../http";
import { loadFacilityDay } from "./facility";
import { type Clause, compact, joinWhere, likePattern } from "./sql";

interface RecordRow {
  dispensed_at: string;
  dispensed_by: string;
  dispensed_by_name: string;
  id: string;
  item_id: string | null;
  item_name: string;
  note: string;
  qty: number;
  recipient_name: string;
  request_code: string | null;
  request_id: string | null;
  source: RequestSource;
  undone_at: string | null;
  undone_by: string | null;
  unit: string;
}

interface LineRow {
  batch_id: string | null;
  batch_number: string;
  expiry: string | null;
  id: string;
  qty: number;
  record_id: string;
}

export const RECORD_SELECT =
  "SELECT d.id, d.request_id, r.code AS request_code, d.item_id, d.item_name, d.unit, d.qty, d.source, d.recipient_name, d.dispensed_by, d.dispensed_by_name, d.dispensed_at, d.undone_at, d.undone_by, d.note FROM dispensing_records d LEFT JOIN requests r ON r.id = d.request_id";

function toLine(row: LineRow): DispensingLineDto {
  return {
    batchId: row.batch_id,
    batchNumber: row.batch_number,
    expiry: row.expiry,
    id: row.id,
    qty: row.qty,
  };
}

function toRecord(
  row: RecordRow,
  lines: DispensingLineDto[]
): DispensingRecordDto {
  return {
    dispensedAt: row.dispensed_at,
    dispensedBy: row.dispensed_by,
    dispensedByName: row.dispensed_by_name,
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    lines,
    note: row.note,
    qty: row.qty,
    recipientName: row.recipient_name,
    requestCode: row.request_code,
    requestId: row.request_id,
    source: row.source,
    undoneAt: row.undone_at,
    undoneBy: row.undone_by,
    unit: row.unit,
  };
}

async function linesByRecord(
  db: D1DatabaseLike,
  recordIds: readonly string[]
): Promise<Map<string, DispensingLineDto[]>> {
  const grouped = new Map<string, DispensingLineDto[]>();
  for (const ids of chunk(recordIds)) {
    const { results } = await db
      .prepare(
        `SELECT id, record_id, batch_id, batch_number, expiry, qty FROM dispensing_lines WHERE record_id IN (${placeholders(ids.length)}) ORDER BY rowid`
      )
      .bind(...ids)
      .all<LineRow>();
    for (const row of results) {
      const list = grouped.get(row.record_id) ?? [];
      list.push(toLine(row));
      grouped.set(row.record_id, list);
    }
  }
  return grouped;
}

async function hydrate(
  db: D1DatabaseLike,
  rows: readonly RecordRow[]
): Promise<DispensingRecordDto[]> {
  const lines = await linesByRecord(
    db,
    rows.map((row) => row.id)
  );
  return rows.map((row) => toRecord(row, lines.get(row.id) ?? []));
}

export async function findRecord(
  db: D1DatabaseLike,
  recordId: string
): Promise<DispensingRecordDto | null> {
  const row = await db
    .prepare(`${RECORD_SELECT} WHERE d.id = ?`)
    .bind(recordId)
    .first<RecordRow>();
  if (!row) {
    return null;
  }
  const [record] = await hydrate(db, [row]);
  return record;
}

/** Hand-overs of the given requests, oldest first, keyed by request id. */
export async function recordsByRequest(
  db: D1DatabaseLike,
  requestIds: readonly string[]
): Promise<Map<string, DispensingRecordDto[]>> {
  const rows: RecordRow[] = [];
  for (const ids of chunk(requestIds)) {
    const { results } = await db
      .prepare(
        `${RECORD_SELECT} WHERE d.request_id IN (${placeholders(ids.length)}) ORDER BY d.dispensed_at, d.id`
      )
      .bind(...ids)
      .all<RecordRow>();
    rows.push(...results);
  }
  const records = await hydrate(db, rows);
  const grouped = new Map<string, DispensingRecordDto[]>();
  for (const record of records) {
    if (record.requestId === null) {
      continue;
    }
    const list = grouped.get(record.requestId) ?? [];
    list.push(record);
    grouped.set(record.requestId, list);
  }
  return grouped;
}

// ─── The log ────────────────────────────────────────────────────────────────

function dateRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string
): Clause[] {
  const clauses: Clause[] = [];
  if (from !== undefined) {
    clauses.push({
      params: [startOfDayUtc(from, timezone).toISOString()],
      sql: "d.dispensed_at >= ?",
    });
  }
  if (to !== undefined) {
    clauses.push({
      params: [startOfDayUtc(addDays(to, 1), timezone).toISOString()],
      sql: "d.dispensed_at < ?",
    });
  }
  return clauses;
}

function searchClause(search: string | undefined): Clause | null {
  if (search === undefined || search === "") {
    return null;
  }
  const pattern = likePattern(search);
  return {
    params: [pattern, pattern, pattern, pattern, pattern],
    sql: "lower(d.item_name) LIKE ? ESCAPE '\\' OR lower(d.recipient_name) LIKE ? ESCAPE '\\' OR lower(d.dispensed_by_name) LIKE ? ESCAPE '\\' OR lower(COALESCE(r.code, '')) LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM dispensing_lines l WHERE l.record_id = d.id AND lower(l.batch_number) LIKE ? ESCAPE '\\')",
  };
}

function equalsClause(
  column: string,
  value: string | undefined
): Clause | null {
  return value === undefined ? null : { params: [value], sql: `${column} = ?` };
}

export interface DispensingPage {
  records: DispensingRecordDto[];
  total: number;
}

export async function listDispensing(
  db: D1DatabaseLike,
  query: DispensingListQuery,
  paging: Paging,
  now: Date
): Promise<DispensingPage> {
  const { timezone } = await loadFacilityDay(db, now);
  const where = joinWhere(
    query.includeUndone ? "1 = 1" : "d.undone_at IS NULL",
    compact([
      ...dateRange(query.from, query.to, timezone),
      searchClause(query.search),
      equalsClause("d.source", query.source),
      equalsClause("d.item_id", query.itemId),
      equalsClause("d.dispensed_by", query.dispensedBy),
    ])
  );
  const total = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM dispensing_records d LEFT JOIN requests r ON r.id = d.request_id WHERE ${where.sql}`
    )
    .bind(...where.params)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `${RECORD_SELECT} WHERE ${where.sql} ORDER BY d.dispensed_at DESC, d.id DESC LIMIT ? OFFSET ?`
    )
    .bind(...where.params, paging.limit, paging.offset)
    .all<RecordRow>();
  return { records: await hydrate(db, results), total: total?.total ?? 0 };
}

// ─── Monthly per-batch totals ───────────────────────────────────────────────

interface MonthlyRow {
  batch_id: string | null;
  batch_number: string;
  expiry: string | null;
  item_id: string | null;
  item_name: string;
  qty: number;
  records: number;
  unit: string;
}

function groupMonthly(rows: readonly MonthlyRow[]): MonthlyItemDto[] {
  const items = new Map<string, MonthlyItemDto>();
  for (const row of rows) {
    const key = row.item_id ?? `name:${row.item_name}`;
    const item = items.get(key) ?? {
      batches: [],
      itemId: row.item_id,
      itemName: row.item_name,
      totalQty: 0,
      unit: row.unit,
    };
    const batch: MonthlyBatchDto = {
      batchId: row.batch_id,
      batchNumber: row.batch_number,
      expiry: row.expiry,
      qty: row.qty,
      records: row.records,
    };
    item.batches.push(batch);
    item.totalQty += row.qty;
    items.set(key, item);
  }
  return [...items.values()];
}

/** Per item, per batch quantities handed over in a facility-local month; undone records excluded. */
export async function monthlyDispensing(
  db: D1DatabaseLike,
  month: string,
  now: Date
): Promise<MonthlyDispensingDto> {
  const { timezone } = await loadFacilityDay(db, now);
  const { startUtc, endUtc } = utcRangeForMonth(month, timezone);
  const { results } = await db
    .prepare(
      "SELECT d.item_id, d.item_name, d.unit, l.batch_id, l.batch_number, l.expiry, SUM(l.qty) AS qty, COUNT(DISTINCT d.id) AS records FROM dispensing_lines l JOIN dispensing_records d ON d.id = l.record_id WHERE d.dispensed_at >= ? AND d.dispensed_at < ? AND d.undone_at IS NULL GROUP BY d.item_id, d.item_name, d.unit, l.batch_id, l.batch_number, l.expiry ORDER BY lower(d.item_name), l.expiry IS NULL, l.expiry, l.batch_number"
    )
    .bind(startUtc, endUtc)
    .all<MonthlyRow>();
  const items = groupMonthly(results);
  return {
    items,
    month,
    timezone,
    totalQty: items.reduce((sum, item) => sum + item.totalQty, 0),
  };
}
