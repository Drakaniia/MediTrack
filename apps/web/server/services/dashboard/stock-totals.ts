/** Dashboard totals: batches/units per expiry class and the low-stock counts (spec §7.1). */

import {
  classBoundaries,
  EXPIRY_CLASSES,
  type ExpiryClass,
  expiryClassWhere,
} from "../../../shared/expiry";
import type {
  DashboardClassCountDto,
  DashboardTotalsDto,
} from "../../../shared/schemas/dashboard";
import type { D1DatabaseLike } from "../../env";
import type { ReadContext } from "../inventory/read-models";

/** A batch that still holds stock and belongs to a live item. */
export const LIVE_STOCK_BATCH =
  "b.deleted_at IS NULL AND b.status = 'active' AND b.qty > 0";
const LIVE_ITEM_JOIN = "JOIN items i ON i.id = b.item_id AND i.deleted_at IS NULL";

type ClassRow = Record<string, number | null>;

interface ClassAggregate {
  params: string[];
  select: string;
}

/** One `COUNT`/`SUM` pair per class; the range predicates come from `expiryClassWhere`. */
function classAggregate(rc: ReadContext): ClassAggregate {
  const boundaries = classBoundaries(rc.today, rc.thresholds);
  const select: string[] = [];
  const params: string[] = [];
  for (const expiryClass of EXPIRY_CLASSES) {
    const where = expiryClassWhere("b.expiry", expiryClass, boundaries);
    select.push(
      `COUNT(CASE WHEN ${where.sql} THEN 1 END) AS ${expiryClass}_batches`,
      `COALESCE(SUM(CASE WHEN ${where.sql} THEN b.qty END), 0) AS ${expiryClass}_units`
    );
    params.push(...where.params, ...where.params);
  }
  return { params, select: select.join(", ") };
}

function readClassCount(
  row: ClassRow | null,
  expiryClass: ExpiryClass
): DashboardClassCountDto {
  return {
    batches: row?.[`${expiryClass}_batches`] ?? 0,
    units: row?.[`${expiryClass}_units`] ?? 0,
  };
}

export async function loadClassCounts(
  db: D1DatabaseLike,
  rc: ReadContext
): Promise<DashboardTotalsDto["classes"]> {
  const aggregate = classAggregate(rc);
  const row = await db
    .prepare(
      `SELECT ${aggregate.select} FROM batches b ${LIVE_ITEM_JOIN} WHERE ${LIVE_STOCK_BATCH}`
    )
    .bind(...aggregate.params)
    .first<ClassRow>();
  return {
    expired: readClassCount(row, "expired"),
    near_expiry: readClassCount(row, "near_expiry"),
    safe: readClassCount(row, "safe"),
    urgent: readClassCount(row, "urgent"),
  };
}

interface ItemCountRow {
  item_count: number;
  low_count: number | null;
  out_count: number | null;
}

/** `available` = FEFO-eligible quantity (not expired), the same definition the banner uses. */
export async function loadItemCounts(
  db: D1DatabaseLike,
  rc: ReadContext
): Promise<Pick<DashboardTotalsDto, "itemCount" | "lowStockCount" | "outOfStockCount">> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS item_count,
        SUM(CASE WHEN i.low_stock_threshold > 0 AND COALESCE(a.available, 0) < i.low_stock_threshold THEN 1 ELSE 0 END) AS low_count,
        SUM(CASE WHEN i.low_stock_threshold > 0 AND COALESCE(a.available, 0) = 0 THEN 1 ELSE 0 END) AS out_count
       FROM items i
       LEFT JOIN (SELECT item_id, SUM(qty) AS available FROM batches WHERE deleted_at IS NULL AND status = 'active' AND qty > 0 AND (expiry IS NULL OR expiry >= ?) GROUP BY item_id) a ON a.item_id = i.id
       WHERE i.deleted_at IS NULL`
    )
    .bind(rc.today)
    .first<ItemCountRow>();
  return {
    itemCount: row?.item_count ?? 0,
    lowStockCount: row?.low_count ?? 0,
    outOfStockCount: row?.out_count ?? 0,
  };
}

export async function loadTotals(
  db: D1DatabaseLike,
  rc: ReadContext
): Promise<DashboardTotalsDto> {
  const [classes, items] = await Promise.all([
    loadClassCounts(db, rc),
    loadItemCounts(db, rc),
  ]);
  return { classes, ...items };
}
