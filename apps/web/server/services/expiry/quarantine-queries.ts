/** `GET /api/quarantine`: expired batches still holding stock, oldest expiry first. */

import { daysBetween } from "../../../shared/dates";
import type {
  QuarantineQuery,
  QuarantineRowDto,
} from "../../../shared/schemas/expiry";
import type { D1DatabaseLike } from "../../env";
import type { ExpiryContext } from "./context";
import {
  BATCH_COLUMNS,
  type BatchRow,
  type Page,
  type PageRequest,
} from "./expiry-queries";
import {
  BATCH_JOINS,
  batchSearchClause,
  categoryClause,
  compact,
  displayName,
  joinWhere,
  LIVE_STOCK_BATCH,
} from "./sql";

export interface QuarantineViewer {
  /** `can(role, "stock.dispose")` of the signed-in user. */
  canDispose: boolean;
}

export async function listQuarantine(
  db: D1DatabaseLike,
  context: ExpiryContext,
  query: QuarantineQuery,
  paging: PageRequest,
  viewer: QuarantineViewer
): Promise<Page<QuarantineRowDto>> {
  const where = joinWhere(`${LIVE_STOCK_BATCH} AND b.expiry < ?`, [
    ...compact([
      categoryClause(query.categoryId),
      batchSearchClause(query.search),
    ]),
  ]);
  // The date bound sits in the base condition, so it binds before the optional clauses.
  const params = [context.today, ...where.params];
  const [count, list] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total ${BATCH_JOINS} WHERE ${where.sql}`)
      .bind(...params)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT ${BATCH_COLUMNS} ${BATCH_JOINS} WHERE ${where.sql} ORDER BY b.expiry, b.received_on, b.batch_number_lower, b.id LIMIT ? OFFSET ?`
      )
      .bind(...params, paging.limit, paging.offset)
      .all<BatchRow>(),
  ]);
  return {
    rows: list.results.map((row) => toQuarantineRow(row, context, viewer)),
    total: count?.total ?? 0,
  };
}

function toQuarantineRow(
  row: BatchRow,
  context: ExpiryContext,
  viewer: QuarantineViewer
): QuarantineRowDto {
  // The query only returns dated batches that expired before today.
  const expiry = row.expiry ?? context.today;
  return {
    batchId: row.batch_id,
    batchNumber: row.batch_number,
    canDispose: viewer.canDispose,
    categoryId: row.category_id,
    categoryName: row.category_name,
    code: row.code,
    daysOverdue: daysBetween(expiry, context.today),
    displayName: displayName(row.item_name, row.strength),
    expiry,
    itemId: row.item_id,
    itemName: row.item_name,
    qty: row.qty,
    unit: row.unit,
  };
}
