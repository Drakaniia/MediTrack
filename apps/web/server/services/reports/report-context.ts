/** Month, timezone and header fields shared by the stock and expiry reports. */

import {
  addDays,
  monthOf,
  monthRange,
  todayInZone,
  utcRangeForMonth,
} from "../../../shared/dates";
import type { ReportHeaderDto } from "../../../shared/schemas/reports";
import type { D1DatabaseLike } from "../../env";
import { loadSettings } from "../../settings-store";

export interface ReportContext {
  /** ISO-UTC, exclusive. */
  endUtc: string;
  header: ReportHeaderDto;
  /** ISO-UTC, inclusive. */
  startUtc: string;
}

/** `asOf`: the month's last day for a past month, otherwise today. */
export function reportAsOf(
  month: string,
  today: string,
  monthEnd: string
): string {
  return month < monthOf(today) ? monthEnd : today;
}

export async function loadReportContext(
  db: D1DatabaseLike,
  now: Date,
  requestedMonth: string | undefined
): Promise<ReportContext> {
  const settings = await loadSettings(db);
  const { name: facilityName, timezone } = settings.facility;
  const today = todayInZone(now, timezone);
  const month = requestedMonth ?? monthOf(today);
  const range = monthRange(month);
  const monthEnd = addDays(range.endExclusive, -1);
  const utc = utcRangeForMonth(month, timezone);
  return {
    endUtc: utc.endUtc,
    header: {
      asOf: reportAsOf(month, today, monthEnd),
      facilityName,
      generatedAt: now.toISOString(),
      month,
      monthEnd,
      monthStart: range.start,
      thresholds: {
        nearDays: settings.expiry.nearDays,
        urgentDays: settings.expiry.urgentDays,
      },
      timezone,
      today,
    },
    startUtc: utc.startUtc,
  };
}
