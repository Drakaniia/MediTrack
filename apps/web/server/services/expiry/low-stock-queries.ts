/**
 * `GET /api/low-stock`: items whose AVAILABLE stock (FEFO-eligible: active, in date, not trashed)
 * is below their threshold. Expired stock awaiting disposal does not count towards it, so a
 * shelf of expired boxes can never hide a shortage. A threshold of 0 never alerts.
 */

import {
  classifyLowStock,
  gap,
  suggestedReorderQty,
} from "../../../shared/low-stock";
import type {
  LowStockListStatus,
  LowStockQuery,
  LowStockRowDto,
  SortDirection,
} from "../../../shared/schemas/expiry";
import type { D1DatabaseLike } from "../../env";
import type { ExpiryContext } from "./context";
import type { Page, PageRequest } from "./expiry-queries";
import {
  type Clause,
  categoryClause,
  compact,
  displayName,
  joinWhere,
  likePattern,
} from "./sql";

interface LowStockRow {
  available: number;
  category_id: string | null;
  category_name: string | null;
  id: string;
  low_stock_threshold: number;
  name: string;
  nearest_expiry: string | null;
  on_hand: number;
  strength: string;
  supplier: string;
  unit: string;
}

const AVAILABLE = "COALESCE(a.available, 0)";

const COLUMNS = `i.id, i.name, i.strength, i.unit, i.supplier, i.low_stock_threshold, i.category_id, c.name AS category_name, ${AVAILABLE} AS available, COALESCE(h.on_hand, 0) AS on_hand, a.nearest_expiry`;

/** Eligible stock per item (the `today` placeholder is the FIRST bound value of the statement). */
const FROM = `FROM items i LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN (SELECT item_id, SUM(qty) AS available, MIN(expiry) AS nearest_expiry FROM batches WHERE deleted_at IS NULL AND status = 'active' AND qty > 0 AND (expiry IS NULL OR expiry >= ?) GROUP BY item_id) a ON a.item_id = i.id LEFT JOIN (SELECT item_id, SUM(qty) AS on_hand FROM batches WHERE deleted_at IS NULL AND status = 'active' AND qty > 0 GROUP BY item_id) h ON h.item_id = i.id`;

const BASE_WHERE = `i.deleted_at IS NULL AND i.low_stock_threshold > 0 AND ${AVAILABLE} < i.low_stock_threshold`;

function statusClause(statuses: readonly LowStockListStatus[]): Clause | null {
  const low = statuses.includes("low");
  const out = statuses.includes("out");
  if (low === out) {
    return null;
  }
  return { params: [], sql: `${AVAILABLE} ${out ? "= 0" : "> 0"}` };
}

function searchClause(search: string | undefined): Clause | null {
  if (search === undefined) {
    return null;
  }
  const pattern = likePattern(search);
  return {
    params: [pattern, pattern, pattern],
    sql: "lower(i.name || ' ' || i.strength) LIKE ? ESCAPE '\\' OR lower(i.supplier) LIKE ? ESCAPE '\\' OR lower(COALESCE(i.sku, '')) LIKE ? ESCAPE '\\'",
  };
}

function orderBy(sort: LowStockQuery["sort"], dir: SortDirection): string {
  const direction = dir === "desc" ? "DESC" : "ASC";
  const tail = "lower(i.name), lower(i.strength), i.id";
  switch (sort) {
    case "gap":
      return `(i.low_stock_threshold - ${AVAILABLE}) ${direction}, ${tail}`;
    case "item":
      return `lower(i.name) ${direction}, lower(i.strength) ${direction}, i.id`;
    case "available":
      return `${AVAILABLE} ${direction}, ${tail}`;
    default:
      // "Out" (nothing available) first, then the biggest shortfall.
      return `(${AVAILABLE} > 0) ${direction}, (i.low_stock_threshold - ${AVAILABLE}) DESC, ${tail}`;
  }
}

function toRow(row: LowStockRow): LowStockRowDto {
  const input = {
    available: row.available,
    threshold: row.low_stock_threshold,
  };
  const status = classifyLowStock(input);
  return {
    available: row.available,
    categoryId: row.category_id,
    categoryName: row.category_name,
    displayName: displayName(row.name, row.strength),
    gap: gap(input),
    itemId: row.id,
    lowStockThreshold: row.low_stock_threshold,
    name: row.name,
    nearestExpiry: row.nearest_expiry,
    onHand: row.on_hand,
    // The query only returns items below their threshold, so this is never "in_stock".
    status: status === "out" ? "out" : "low",
    strength: row.strength,
    suggestedReorderQty: suggestedReorderQty(input),
    supplier: row.supplier,
    unit: row.unit,
  };
}

export async function listLowStock(
  db: D1DatabaseLike,
  context: ExpiryContext,
  query: LowStockQuery,
  paging: PageRequest
): Promise<Page<LowStockRowDto>> {
  const where = joinWhere(
    BASE_WHERE,
    compact([
      statusClause(query.status),
      categoryClause(query.categoryId),
      searchClause(query.search),
    ])
  );
  const params = [context.today, ...where.params];
  const [count, list] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total ${FROM} WHERE ${where.sql}`)
      .bind(...params)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT ${COLUMNS} ${FROM} WHERE ${where.sql} ORDER BY ${orderBy(query.sort, query.dir)} LIMIT ? OFFSET ?`
      )
      .bind(...params, paging.limit, paging.offset)
      .all<LowStockRow>(),
  ]);
  return { rows: list.results.map(toRow), total: count?.total ?? 0 };
}
