/** `GET /api/expiry` and `GET /api/expiry/summary`: read models over batches holding stock. */

import { monthOf, monthRange } from "../../../shared/dates";
import {
  assessExpiry,
  type ClassBoundaries,
  EXPIRY_CLASSES,
  type ExpiryClass,
  expiryClassCase,
  expiryClassWhere,
} from "../../../shared/expiry";
import { fefoOrderSql } from "../../../shared/fefo";
import type {
  ExpiryClassCountDto,
  ExpiryQuery,
  ExpiryRowDto,
  ExpirySummaryDto,
  SortDirection,
} from "../../../shared/schemas/expiry";
import type { D1DatabaseLike } from "../../env";
import { chunk, placeholders } from "../../http";
import type { ExpiryContext } from "./context";
import {
  BATCH_JOINS,
  batchSearchClause,
  type Clause,
  categoryClause,
  compact,
  displayName,
  joinWhere,
  LIVE_STOCK_BATCH,
} from "./sql";

/** Bound-parameter budget for one `IN (…)` list (the id list plus a few fixed values). */
const RANK_CHUNK_SIZE = 80;

export interface BatchRow {
  batch_id: string;
  batch_number: string;
  category_id: string | null;
  category_name: string | null;
  code: string;
  expiry: string | null;
  item_id: string;
  item_name: string;
  qty: number;
  status: "active" | "disposed";
  strength: string;
  unit: string;
}

export const BATCH_COLUMNS =
  "b.id AS batch_id, b.batch_number, i.category_id, c.name AS category_name, b.code, b.expiry, b.item_id, i.name AS item_name, b.qty, b.status, i.strength, i.unit";

export interface PageRequest {
  limit: number;
  offset: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

/** Index-friendly OR of the selected classes. All four selected = no filter. */
export function classClause(
  classes: readonly ExpiryClass[],
  boundaries: ClassBoundaries
): Clause | null {
  if (EXPIRY_CLASSES.every((entry) => classes.includes(entry))) {
    return null;
  }
  const fragments = classes.map((entry) =>
    expiryClassWhere("b.expiry", entry, boundaries)
  );
  return {
    params: fragments.flatMap((fragment) => fragment.params),
    sql: fragments.map((fragment) => fragment.sql).join(" OR "),
  };
}

function rangeClause(
  from: string | undefined,
  to: string | undefined
): Clause | null {
  const parts: string[] = [];
  const params: string[] = [];
  if (from !== undefined) {
    parts.push("b.expiry >= ?");
    params.push(from);
  }
  if (to !== undefined) {
    parts.push("b.expiry <= ?");
    params.push(to);
  }
  return parts.length === 0 ? null : { params, sql: parts.join(" AND ") };
}

const EXPIRY_TAIL = "b.expiry IS NULL, b.expiry, b.id";

/** `ORDER BY` for the expiry list. Identifiers come from this whitelist only. */
function orderBy(sort: ExpiryQuery["sort"], dir: SortDirection): string {
  const direction = dir === "desc" ? "DESC" : "ASC";
  switch (sort) {
    case "item":
      return `lower(i.name) ${direction}, lower(i.strength) ${direction}, ${EXPIRY_TAIL}`;
    case "qty":
      return `b.qty ${direction}, ${EXPIRY_TAIL}`;
    case "class":
      // Severity follows the date: expired < urgent < near < safe, and "no expiry" is safe.
      return dir === "desc"
        ? "b.expiry IS NULL DESC, b.expiry DESC, b.id"
        : EXPIRY_TAIL;
    default:
      return dir === "desc"
        ? "b.expiry IS NULL, b.expiry DESC, b.id"
        : EXPIRY_TAIL;
  }
}

/**
 * 1-based FEFO position of every eligible batch of the given items (one query per ≤80 items,
 * never one per row). Ineligible batches (expired, empty, disposed, trashed) get no entry.
 */
export async function loadFefoRanks(
  db: D1DatabaseLike,
  itemIds: readonly string[],
  today: string
): Promise<Map<string, number>> {
  const ranks = new Map<string, number>();
  const counters = new Map<string, number>();
  const groups = chunk([...new Set(itemIds)], RANK_CHUNK_SIZE);
  const pages = await Promise.all(
    groups.map((ids) =>
      db
        .prepare(
          `SELECT id, item_id FROM batches WHERE item_id IN (${placeholders(ids.length)}) AND deleted_at IS NULL AND status = 'active' AND qty > 0 AND (expiry IS NULL OR expiry >= ?) ORDER BY item_id, ${fefoOrderSql()}`
        )
        .bind(...ids, today)
        .all<{ id: string; item_id: string }>()
    )
  );
  // Each item sits in exactly one group, so the per-item counters never mix.
  for (const { results } of pages) {
    for (const row of results) {
      const next = (counters.get(row.item_id) ?? 0) + 1;
      counters.set(row.item_id, next);
      ranks.set(row.id, next);
    }
  }
  return ranks;
}

export function toExpiryRow(
  row: BatchRow,
  context: ExpiryContext,
  ranks: ReadonlyMap<string, number>
): ExpiryRowDto {
  const { daysUntil, expiryClass } = assessExpiry(
    row.expiry,
    context.today,
    context.thresholds
  );
  return {
    batchId: row.batch_id,
    batchNumber: row.batch_number,
    categoryId: row.category_id,
    categoryName: row.category_name,
    code: row.code,
    daysUntil,
    displayName: displayName(row.item_name, row.strength),
    expiry: row.expiry,
    expiryClass,
    fefoRank: ranks.get(row.batch_id) ?? null,
    itemId: row.item_id,
    itemName: row.item_name,
    qty: row.qty,
    quarantined:
      row.status === "active" &&
      row.qty > 0 &&
      row.expiry !== null &&
      row.expiry < context.today,
    status: row.status,
    unit: row.unit,
  };
}

export async function listExpiry(
  db: D1DatabaseLike,
  context: ExpiryContext,
  query: ExpiryQuery,
  paging: PageRequest
): Promise<Page<ExpiryRowDto>> {
  const where = joinWhere(
    LIVE_STOCK_BATCH,
    compact([
      classClause(query.class, context.boundaries),
      categoryClause(query.categoryId),
      batchSearchClause(query.search),
      rangeClause(query.from, query.to),
    ])
  );
  const [count, list] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total ${BATCH_JOINS} WHERE ${where.sql}`)
      .bind(...where.params)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT ${BATCH_COLUMNS} ${BATCH_JOINS} WHERE ${where.sql} ORDER BY ${orderBy(query.sort, query.dir)} LIMIT ? OFFSET ?`
      )
      .bind(...where.params, paging.limit, paging.offset)
      .all<BatchRow>(),
  ]);
  const ranks = await loadFefoRanks(
    db,
    list.results.map((row) => row.item_id),
    context.today
  );
  return {
    rows: list.results.map((row) => toExpiryRow(row, context, ranks)),
    total: count?.total ?? 0,
  };
}

interface ClassTotalRow {
  batches: number;
  expiry_class: ExpiryClass;
  units: number;
}

function emptyCount(): ExpiryClassCountDto {
  return { batches: 0, units: 0 };
}

/** Counts per class (batches and units) over every batch holding stock, plus this month's expiries. */
export async function expirySummary(
  db: D1DatabaseLike,
  context: ExpiryContext
): Promise<ExpirySummaryDto> {
  const classCase = expiryClassCase("b.expiry", context.boundaries);
  const month = monthRange(monthOf(context.today));
  const [byClass, thisMonth] = await Promise.all([
    db
      .prepare(
        `SELECT ${classCase.sql} AS expiry_class, COUNT(*) AS batches, COALESCE(SUM(b.qty), 0) AS units ${BATCH_JOINS} WHERE ${LIVE_STOCK_BATCH} GROUP BY expiry_class`
      )
      .bind(...classCase.params)
      .all<ClassTotalRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS batches, COALESCE(SUM(b.qty), 0) AS units ${BATCH_JOINS} WHERE ${LIVE_STOCK_BATCH} AND b.expiry >= ? AND b.expiry < ?`
      )
      .bind(month.start, month.endExclusive)
      .first<ExpiryClassCountDto>(),
  ]);
  const counts: Record<ExpiryClass, ExpiryClassCountDto> = {
    expired: emptyCount(),
    near_expiry: emptyCount(),
    safe: emptyCount(),
    urgent: emptyCount(),
  };
  for (const row of byClass.results) {
    counts[row.expiry_class] = { batches: row.batches, units: row.units };
  }
  return {
    counts,
    expiringThisMonth: thisMonth ?? emptyCount(),
    month: month.month,
    thresholds: context.thresholds,
    today: context.today,
  };
}
