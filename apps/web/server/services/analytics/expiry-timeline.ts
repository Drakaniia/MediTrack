/** "Expiry timeline": stock expiring in each of the next 12 facility months, split by expiry class. */

import { monthOf, monthRange } from "../../../shared/dates";
import {
  classBoundaries,
  EXPIRY_CLASSES,
  type ExpiryClass,
  expiryClassCase,
  type ExpiryThresholds,
} from "../../../shared/expiry";
import {
  type ClassCountDto,
  type ClassSplitDto,
  EXPIRY_TIMELINE_MONTHS,
  type ExpiryTimelineDto,
  type ExpiryTimelineMonthDto,
} from "../../../shared/schemas/analytics";
import type { D1DatabaseLike } from "../../env";
import { categoryFilter } from "./range";

interface TimelineRow {
  batches: number;
  bucket: string;
  class: ExpiryClass;
  units: number;
}

export function emptyClassSplit(): ClassSplitDto {
  const split = {} as ClassSplitDto;
  for (const expiryClass of EXPIRY_CLASSES) {
    split[expiryClass] = { batches: 0, units: 0 };
  }
  return split;
}

/** The `count` consecutive months starting with `firstMonth` (`YYYY-MM`). */
export function monthWindow(firstMonth: string, count: number): string[] {
  const months: string[] = [];
  let current = firstMonth;
  for (let index = 0; index < count; index += 1) {
    months.push(current);
    current = monthOf(monthRange(current).endExclusive);
  }
  return months;
}

function emptyMonth(month: string): ExpiryTimelineMonthDto {
  return { batches: 0, classes: emptyClassSplit(), month, units: 0 };
}

function addTo(target: ClassCountDto, row: TimelineRow): void {
  target.batches += row.batches;
  target.units += row.units;
}

export function foldTimelineRows(
  rows: readonly TimelineRow[],
  months: readonly string[]
): ExpiryTimelineDto {
  const byMonth = new Map(months.map((month) => [month, emptyMonth(month)]));
  const earlier: ClassCountDto = { batches: 0, units: 0 };
  for (const row of rows) {
    if (row.bucket === "earlier") {
      addTo(earlier, row);
      continue;
    }
    const month = byMonth.get(row.bucket);
    if (month) {
      addTo(month, row);
      addTo(month.classes[row.class], row);
    }
  }
  return { earlier, months: [...byMonth.values()] };
}

export async function loadExpiryTimeline(
  db: D1DatabaseLike,
  today: string,
  thresholds: ExpiryThresholds,
  categoryId: string | null
): Promise<ExpiryTimelineDto> {
  const months = monthWindow(monthOf(today), EXPIRY_TIMELINE_MONTHS);
  const windowStart = monthRange(months[0]).start;
  const windowEnd = monthRange(months.at(-1) ?? months[0]).endExclusive;
  const classCase = expiryClassCase(
    "b.expiry",
    classBoundaries(today, thresholds)
  );
  const filter = categoryFilter(categoryId);
  const { results } = await db
    .prepare(
      `SELECT CASE WHEN b.expiry < ? THEN 'earlier' ELSE substr(b.expiry, 1, 7) END AS bucket, ${classCase.sql} AS class, COUNT(*) AS batches, SUM(b.qty) AS units
       FROM batches b JOIN items i ON i.id = b.item_id AND i.deleted_at IS NULL
       WHERE b.deleted_at IS NULL AND b.status = 'active' AND b.qty > 0 AND b.expiry IS NOT NULL AND b.expiry < ?${filter.sql}
       GROUP BY bucket, class`
    )
    .bind(windowStart, ...classCase.params, windowEnd, ...filter.params)
    .all<TimelineRow>();
  return foldTimelineRows(results, months);
}
