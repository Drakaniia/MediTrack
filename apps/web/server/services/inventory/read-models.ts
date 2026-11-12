/**
 * Inventory read models (FROZEN contract other slices import).
 *
 * Everything derived — expiry class, days until, FEFO rank, quarantine, available / on-hand,
 * low stock, nearest expiry, worst class — is computed at read time from the facility
 * timezone and the thresholds in settings; none of it is stored.
 *
 * Query budget is constant: summaries are ONE aggregate join (+ one COUNT), a detail is two
 * queries, the FEFO list is one window-function query. Id lists travel as a single JSON
 * parameter (`json_each`), so they never hit the 100-bound-parameter ceiling.
 */

import { todayInZone } from "../../../shared/dates";
import {
  classBoundaries,
  type ExpiryClass,
  type ExpiryThresholds,
  expiryClassCase,
} from "../../../shared/expiry";
import {
  fefoOrderSql,
  fefoRanks,
  splitBatchesForDisplay,
} from "../../../shared/fefo";
import type {
  BatchDto,
  FefoEntryDto,
  ItemDetailDto,
  ItemSummaryDto,
} from "../../../shared/schemas/inventory";
import type { D1DatabaseLike } from "../../env";
import { escapeLike } from "../../http";
import { loadSettings } from "../../settings-store";
import {
  BATCH_COLUMNS,
  type BatchRow,
  displayNameOf,
  type ItemRow,
  toBatchDto,
  toItemSummary,
} from "./row-mappers";

export interface ReadContext {
  thresholds: ExpiryThresholds;
  timezone: string;
  today: string;
}

export type StockLevel = "in_stock" | "low" | "out";

export interface ItemQuery {
  categoryId?: string;
  dir?: "asc" | "desc";
  ids?: string[];
  includeDeleted?: false;
  limit?: number;
  offset?: number;
  search?: string;
  sort?: "category" | "name" | "nearestExpiry" | "onHand" | "updated";
  status?: ExpiryClass[];
  stock?: StockLevel[];
}

export async function readContextFor(
  db: D1DatabaseLike,
  now: Date
): Promise<ReadContext> {
  const settings = await loadSettings(db);
  const { timezone } = settings.facility;
  return {
    thresholds: {
      nearDays: settings.expiry.nearDays,
      urgentDays: settings.expiry.urgentDays,
    },
    timezone,
    today: todayInZone(now, timezone),
  };
}

// ─── Item summaries ─────────────────────────────────────────────────────────

const AVAILABLE_SQL = "COALESCE(agg.available, 0)";
const WORST_RANK_BY_CLASS: Record<ExpiryClass, number> = {
  expired: 0,
  near_expiry: 2,
  safe: 3,
  urgent: 1,
};

const ITEM_COLUMNS = `i.id, i.name, i.strength, i.category_id, c.name AS category_name, i.unit, i.pack_unit, i.pack_size, i.supplier, i.sku, i.barcode, i.low_stock_threshold, i.has_expiry, i.notes, i.updated_at, ${AVAILABLE_SQL} AS available, COALESCE(agg.on_hand, 0) AS on_hand, COALESCE(agg.batch_count, 0) AS batch_count, agg.nearest_expiry, agg.worst_rank`;

const SORT_SQL: Record<
  NonNullable<ItemQuery["sort"]>,
  (dir: string) => string
> = {
  category: (dir) =>
    `c.name IS NULL, lower(c.name) ${dir}, lower(i.name), lower(i.strength), i.id`,
  name: (dir) => `lower(i.name) ${dir}, lower(i.strength) ${dir}, i.id`,
  nearestExpiry: (dir) =>
    `agg.nearest_expiry IS NULL, agg.nearest_expiry ${dir}, lower(i.name), i.id`,
  onHand: (dir) =>
    `COALESCE(agg.on_hand, 0) ${dir}, lower(i.name), lower(i.strength), i.id`,
  updated: (dir) => `i.updated_at ${dir}, i.id`,
};

interface SqlParts {
  params: (number | string)[];
  sql: string;
}

function fromClause(rc: ReadContext): SqlParts {
  const boundaries = classBoundaries(rc.today, rc.thresholds);
  const classCase = expiryClassCase("expiry", boundaries);
  const worst = `MIN(CASE ${classCase.sql} WHEN 'expired' THEN 0 WHEN 'urgent' THEN 1 WHEN 'near_expiry' THEN 2 ELSE 3 END)`;
  return {
    params: [rc.today, rc.today, ...classCase.params],
    sql: `FROM items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN (SELECT item_id, SUM(CASE WHEN expiry IS NULL OR expiry >= ? THEN qty ELSE 0 END) AS available, SUM(qty) AS on_hand, COUNT(*) AS batch_count, MIN(CASE WHEN expiry >= ? THEN expiry END) AS nearest_expiry, ${worst} AS worst_rank FROM batches WHERE deleted_at IS NULL AND status = 'active' AND qty > 0 GROUP BY item_id) agg ON agg.item_id = i.id`,
  };
}

function statusCondition(classes: readonly ExpiryClass[]): string {
  const parts = classes.map((expiryClass) =>
    expiryClass === "safe"
      ? "(agg.worst_rank IS NULL OR agg.worst_rank = 3)"
      : `agg.worst_rank = ${WORST_RANK_BY_CLASS[expiryClass]}`
  );
  return `(${parts.join(" OR ")})`;
}

function stockCondition(levels: readonly StockLevel[]): string {
  const threshold = "i.low_stock_threshold";
  const parts = levels.map((level) => {
    if (level === "out") {
      return `(${threshold} > 0 AND ${AVAILABLE_SQL} <= 0)`;
    }
    if (level === "low") {
      return `(${threshold} > 0 AND ${AVAILABLE_SQL} > 0 AND ${AVAILABLE_SQL} < ${threshold})`;
    }
    return `(${threshold} <= 0 OR ${AVAILABLE_SQL} >= ${threshold})`;
  });
  return `(${parts.join(" OR ")})`;
}

function whereClause(q: ItemQuery): SqlParts {
  const conditions = ["i.deleted_at IS NULL"];
  const params: (number | string)[] = [];
  if (q.ids) {
    conditions.push("i.id IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(q.ids));
  }
  if (q.categoryId) {
    conditions.push("i.category_id = ?");
    params.push(q.categoryId);
  }
  const term = q.search?.trim().toLowerCase();
  if (term) {
    const pattern = `%${escapeLike(term)}%`;
    conditions.push(
      "(lower(i.name || ' ' || i.strength) LIKE ? ESCAPE '\\' OR lower(i.sku) LIKE ? ESCAPE '\\' OR lower(i.barcode) LIKE ? ESCAPE '\\')"
    );
    params.push(pattern, pattern, pattern);
  }
  if (q.status && q.status.length > 0) {
    conditions.push(statusCondition(q.status));
  }
  if (q.stock && q.stock.length > 0) {
    conditions.push(stockCondition(q.stock));
  }
  return { params, sql: `WHERE ${conditions.join(" AND ")}` };
}

function orderClause(q: ItemQuery): string {
  const dir = q.dir === "desc" ? "DESC" : "ASC";
  return `ORDER BY ${SORT_SQL[q.sort ?? "name"](dir)}`;
}

interface ItemRowsResult {
  rows: ItemRow[];
  total: number;
}

/** Shared by summaries and the detail (which also needs `notes`). */
export async function queryItemRows(
  db: D1DatabaseLike,
  rc: ReadContext,
  q: ItemQuery = {}
): Promise<ItemRowsResult> {
  const from = fromClause(rc);
  const where = whereClause(q);
  const base = [...from.params, ...where.params];
  const paging = q.limit === undefined ? "" : " LIMIT ? OFFSET ?";
  const pagingParams = q.limit === undefined ? [] : [q.limit, q.offset ?? 0];
  const [rows, count] = await Promise.all([
    db
      .prepare(
        `SELECT ${ITEM_COLUMNS} ${from.sql} ${where.sql} ${orderClause(q)}${paging}`
      )
      .bind(...base, ...pagingParams)
      .all<ItemRow>(),
    db
      .prepare(`SELECT COUNT(*) AS total ${from.sql} ${where.sql}`)
      .bind(...base)
      .first<{ total: number }>(),
  ]);
  return { rows: rows.results, total: count?.total ?? 0 };
}

export async function loadItemSummaries(
  db: D1DatabaseLike,
  rc: ReadContext,
  q: ItemQuery = {}
): Promise<{ items: ItemSummaryDto[]; total: number }> {
  const { rows, total } = await queryItemRows(db, rc, q);
  return { items: rows.map(toItemSummary), total };
}

// ─── Batches ────────────────────────────────────────────────────────────────

function batchDtosWithRanks(rows: BatchRow[], rc: ReadContext): BatchDto[] {
  const plain = rows.map((row) => toBatchDto(row, rc, null));
  const ranks = fefoRanks(plain, rc.today);
  return plain.map((dto) => ({ ...dto, fefoRank: ranks.get(dto.id) ?? null }));
}

async function loadLiveBatchRows(
  db: D1DatabaseLike,
  itemId: string
): Promise<BatchRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${BATCH_COLUMNS} FROM batches b WHERE b.item_id = ? AND b.deleted_at IS NULL`
    )
    .bind(itemId)
    .all<BatchRow>();
  return results;
}

export async function loadItemDetail(
  db: D1DatabaseLike,
  rc: ReadContext,
  itemId: string
): Promise<ItemDetailDto | null> {
  const [{ rows }, batchRows] = await Promise.all([
    queryItemRows(db, rc, { ids: [itemId], limit: 1 }),
    loadLiveBatchRows(db, itemId),
  ]);
  const [row] = rows;
  if (!row) {
    return null;
  }
  const groups = splitBatchesForDisplay(
    batchDtosWithRanks(batchRows, rc),
    rc.today
  );
  return {
    ...toItemSummary(row),
    batches: [...groups.eligible, ...groups.quarantined, ...groups.inactive],
    notes: row.notes,
  };
}

export async function loadBatchDto(
  db: D1DatabaseLike,
  rc: ReadContext,
  batchId: string
): Promise<BatchDto | null> {
  const row = await db
    .prepare(
      `SELECT ${BATCH_COLUMNS} FROM batches b WHERE b.id = ? AND b.deleted_at IS NULL`
    )
    .bind(batchId)
    .first<BatchRow>();
  if (!row) {
    return null;
  }
  const siblings = await loadLiveBatchRows(db, row.item_id);
  return (
    batchDtosWithRanks(siblings, rc).find((dto) => dto.id === batchId) ?? null
  );
}

// ─── FEFO list ──────────────────────────────────────────────────────────────

interface FefoRow extends BatchRow {
  category_name: string | null;
  item_name: string;
  item_strength: string;
  item_unit: string;
}

const MAX_FEFO_ROWS = 1000;

export async function loadFefoList(
  db: D1DatabaseLike,
  rc: ReadContext,
  opts: { categoryId?: string; limit?: number } = {}
): Promise<FefoEntryDto[]> {
  const params: (number | string)[] = [rc.today];
  let categoryFilter = "";
  if (opts.categoryId) {
    categoryFilter = " AND i.category_id = ?";
    params.push(opts.categoryId);
  }
  params.push(Math.min(opts.limit ?? MAX_FEFO_ROWS, MAX_FEFO_ROWS));
  const { results } = await db
    .prepare(
      `SELECT ${BATCH_COLUMNS}, i.name AS item_name, i.strength AS item_strength, i.unit AS item_unit, c.name AS category_name FROM (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.item_id ORDER BY ${fefoOrderSql("x")}) AS rn FROM batches x WHERE x.deleted_at IS NULL AND x.status = 'active' AND x.qty > 0 AND (x.expiry IS NULL OR x.expiry >= ?)) b JOIN items i ON i.id = b.item_id AND i.deleted_at IS NULL LEFT JOIN categories c ON c.id = i.category_id WHERE b.rn = 1${categoryFilter} ORDER BY b.expiry IS NULL, b.expiry, b.received_on, lower(i.name), b.id LIMIT ?`
    )
    .bind(...params)
    .all<FefoRow>();
  return results.map((row) => ({
    batch: toBatchDto(row, rc, 1),
    item: {
      categoryName: row.category_name,
      displayName: displayNameOf(row.item_name, row.item_strength),
      id: row.item_id,
      name: row.item_name,
      strength: row.item_strength,
      unit: row.item_unit,
    },
  }));
}
