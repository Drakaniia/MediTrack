/**
 * "Usage" donut and "Top dispensed" table. Both read the same grouped ledger rows
 * (`dispense` + `undo_dispense` net out, so an undone quick deduct never counts).
 */

import {
  TOP_DISPENSED_BATCH_LIMIT,
  TOP_DISPENSED_LIMIT,
  type TopDispensedItemDto,
  UNCATEGORIZED_LABEL,
  type UsageSliceDto,
  type UsageWidgetDto,
} from "../../../shared/schemas/analytics";
import type { D1DatabaseLike } from "../../env";
import { categoryFilter, type RangeBounds } from "./range";

interface DispensedRow {
  batch_number: string;
  category_id: string | null;
  category_name: string | null;
  item_id: string | null;
  item_label: string;
  unit: string | null;
  units: number;
}

const DISPENSED_SQL = `SELECT m.item_id AS item_id,
    CASE WHEN i.id IS NULL THEN m.item_name WHEN i.strength = '' THEN i.name ELSE i.name || ' ' || i.strength END AS item_label,
    i.unit AS unit, i.category_id AS category_id, c.name AS category_name,
    m.batch_number AS batch_number, -SUM(m.qty_delta) AS units
  FROM stock_movements m
  LEFT JOIN items i ON i.id = m.item_id
  LEFT JOIN categories c ON c.id = i.category_id
  WHERE m.kind IN ('dispense', 'undo_dispense') AND m.at >= ? AND m.at < ?`;

export interface DispensedWidgets {
  topDispensed: TopDispensedItemDto[];
  usage: UsageWidgetDto;
}

async function loadRows(
  db: D1DatabaseLike,
  bounds: RangeBounds,
  categoryId: string | null
): Promise<DispensedRow[]> {
  const filter = categoryFilter(categoryId);
  const { results } = await db
    .prepare(
      `${DISPENSED_SQL}${filter.sql} GROUP BY COALESCE(m.item_id, m.item_name), m.batch_number HAVING units <> 0`
    )
    .bind(bounds.startUtc, bounds.endUtc, ...filter.params)
    .all<DispensedRow>();
  return results;
}

function buildUsage(rows: readonly DispensedRow[]): UsageWidgetDto {
  const byCategory = new Map<string, UsageSliceDto>();
  for (const row of rows) {
    const key = row.category_id ?? "";
    const slice = byCategory.get(key) ?? {
      categoryId: row.category_id,
      name: row.category_name ?? UNCATEGORIZED_LABEL,
      units: 0,
    };
    slice.units += row.units;
    byCategory.set(key, slice);
  }
  const slices = [...byCategory.values()]
    .filter((slice) => slice.units > 0)
    .sort(
      (left, right) =>
        right.units - left.units || left.name.localeCompare(right.name)
    );
  return {
    slices,
    totalUnits: slices.reduce((sum, slice) => sum + slice.units, 0),
  };
}

function buildTopDispensed(rows: readonly DispensedRow[]): TopDispensedItemDto[] {
  const byItem = new Map<string, TopDispensedItemDto>();
  for (const row of rows) {
    const key = row.item_id ?? `name:${row.item_label}`;
    const item = byItem.get(key) ?? {
      batchCount: 0,
      batches: [],
      itemId: row.item_id,
      name: row.item_label,
      unit: row.unit ?? "",
      units: 0,
    };
    item.units += row.units;
    if (row.units > 0) {
      item.batches.push({ batchNumber: row.batch_number, units: row.units });
    }
    byItem.set(key, item);
  }
  return [...byItem.values()]
    .filter((item) => item.units > 0)
    .sort(
      (left, right) =>
        right.units - left.units || left.name.localeCompare(right.name)
    )
    .slice(0, TOP_DISPENSED_LIMIT)
    .map((item) => {
      const batches = item.batches.sort(
        (left, right) =>
          right.units - left.units ||
          left.batchNumber.localeCompare(right.batchNumber)
      );
      return {
        ...item,
        batchCount: batches.length,
        batches: batches.slice(0, TOP_DISPENSED_BATCH_LIMIT),
      };
    });
}

export async function loadDispensedWidgets(
  db: D1DatabaseLike,
  bounds: RangeBounds,
  categoryId: string | null
): Promise<DispensedWidgets> {
  const rows = await loadRows(db, bounds, categoryId);
  return { topDispensed: buildTopDispensed(rows), usage: buildUsage(rows) };
}
