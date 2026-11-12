/** Live items with their category, the shared base of both reports. */

import type { D1DatabaseLike } from "../../env";

export interface ReportItem {
  categoryId: string | null;
  categoryName: string | null;
  categoryOrder: number;
  id: string;
  name: string;
  strength: string;
  threshold: number;
  unit: string;
}

interface ItemRow {
  category_id: string | null;
  category_name: string | null;
  category_order: number | null;
  id: string;
  name: string;
  strength: string;
  threshold: number;
  unit: string;
}

const ITEMS_SQL = `SELECT i.id AS id, i.name AS name, i.strength AS strength, i.unit AS unit, i.low_stock_threshold AS threshold,
    i.category_id AS category_id, c.name AS category_name, c.sort_order AS category_order
  FROM items i LEFT JOIN categories c ON c.id = i.category_id
  WHERE i.deleted_at IS NULL`;

export async function loadReportItems(
  db: D1DatabaseLike
): Promise<ReportItem[]> {
  const { results } = await db.prepare(ITEMS_SQL).all<ItemRow>();
  return results.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryOrder: row.category_order ?? 0,
    id: row.id,
    name: row.name,
    strength: row.strength,
    threshold: row.threshold,
    unit: row.unit,
  }));
}

export function displayNameOf(item: Pick<ReportItem, "name" | "strength">): string {
  return item.strength === "" ? item.name : `${item.name} ${item.strength}`;
}

export function compareText(left: string, right: string): number {
  return left.toLowerCase().localeCompare(right.toLowerCase());
}
