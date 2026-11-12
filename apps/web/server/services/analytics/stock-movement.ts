/** "Stock movement" widget: received / dispensed / disposed units per facility-local day, zero-filled. */

import type {
  StockMovementDayDto,
  StockMovementDto,
} from "../../../shared/schemas/analytics";
import type { D1DatabaseLike } from "../../env";
import {
  bucketDate,
  bucketSql,
  categoryFilter,
  dayIndex,
  listDays,
  type RangeBounds,
} from "./range";

interface MovementRow {
  bucket: string;
  delta: number;
  kind: string;
}

const MOVEMENT_SQL = `SELECT ${bucketSql("m.at")} AS bucket, m.kind AS kind, SUM(m.qty_delta) AS delta
  FROM stock_movements m LEFT JOIN items i ON i.id = m.item_id
  WHERE m.at >= ? AND m.at < ?`;

function emptyDay(date: string): StockMovementDayDto {
  return { adjusted: 0, date, dispensed: 0, disposed: 0, received: 0 };
}

function addToDay(day: StockMovementDayDto, row: MovementRow): void {
  switch (row.kind) {
    case "receive":
      day.received += row.delta;
      break;
    case "dispense":
    case "undo_dispense":
      day.dispensed -= row.delta;
      break;
    case "dispose":
      day.disposed -= row.delta;
      break;
    case "adjust":
      day.adjusted += row.delta;
      break;
    default:
      break;
  }
}

export function foldMovementRows(
  rows: readonly MovementRow[],
  bounds: RangeBounds
): StockMovementDto {
  const days = listDays(bounds).map(emptyDay);
  for (const row of rows) {
    const index = dayIndex(bounds, bucketDate(row.bucket, bounds.timezone));
    if (index >= 0) {
      addToDay(days[index], row);
    }
  }
  return { days };
}

export async function loadStockMovement(
  db: D1DatabaseLike,
  bounds: RangeBounds,
  categoryId: string | null
): Promise<StockMovementDto> {
  const filter = categoryFilter(categoryId);
  const { results } = await db
    .prepare(`${MOVEMENT_SQL}${filter.sql} GROUP BY bucket, m.kind`)
    .bind(bounds.startUtc, bounds.endUtc, ...filter.params)
    .all<MovementRow>();
  return foldMovementRows(results, bounds);
}
