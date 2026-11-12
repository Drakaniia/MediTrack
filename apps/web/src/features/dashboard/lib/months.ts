/**
 * Month + year helpers for the dashboard's month filter. The filter has NO day: a month is the
 * string `YYYY-MM` (facility calendar), the same value the API takes as `?month=`.
 */

import { isIsoMonth } from "@shared/dates";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Years offered before / after the current one. */
const YEARS_BACK = 5;
const YEARS_AHEAD = 5;
const MONTH_PAD = 2;

export interface MonthParts {
  /** 1–12. */
  month: number;
  year: number;
}

export function splitMonth(value: string): MonthParts {
  if (!isIsoMonth(value)) {
    throw new RangeError(`Invalid month: ${value}`);
  }
  const [year, month] = value.split("-").map(Number);
  return { month, year };
}

export function joinMonth(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(MONTH_PAD, "0")}`;
}

/** "November 2026". */
export function formatMonthLabel(value: string): string {
  const { month, year } = splitMonth(value);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Years for the year select: a window around today that always contains the selection. */
export function yearOptions(selectedYear: number, currentYear: number): number[] {
  const first = Math.min(currentYear - YEARS_BACK, selectedYear);
  const last = Math.max(currentYear + YEARS_AHEAD, selectedYear);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

export const MONTH_OPTIONS: readonly { label: string; value: string }[] =
  MONTH_NAMES.map((name, index) => ({
    label: name,
    value: String(index + 1),
  }));

