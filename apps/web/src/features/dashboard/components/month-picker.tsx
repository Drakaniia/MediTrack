import { Button } from "@cmis/ui/components/button";
import type { ReactElement } from "react";

import {
  joinMonth,
  MONTH_OPTIONS,
  splitMonth,
  yearOptions,
} from "../lib/months";

const SELECT_CLASS =
  "h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface MonthPickerProps {
  /** The facility's current month, `YYYY-MM`: the "This month" shortcut. */
  currentMonth: string;
  onChange: (month: string) => void;
  /** Selected month, `YYYY-MM`. */
  value: string;
}

/**
 * Month + year only (no day): two native selects, so the keyboard, screen readers and phone
 * pickers all work, and "This month" jumps back to the facility's current month.
 */
export function MonthPicker({
  currentMonth,
  onChange,
  value,
}: MonthPickerProps): ReactElement {
  const selected = splitMonth(value);
  const current = splitMonth(currentMonth);
  return (
    <div
      aria-label="Month filter"
      className="flex flex-wrap items-end gap-2"
      role="group"
    >
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-muted-foreground">Month</span>
        <select
          className={SELECT_CLASS}
          onChange={(event) =>
            onChange(joinMonth(selected.year, Number(event.target.value)))
          }
          value={String(selected.month)}
        >
          {MONTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs">
        <span className="font-medium text-muted-foreground">Year</span>
        <select
          className={SELECT_CLASS}
          onChange={(event) =>
            onChange(joinMonth(Number(event.target.value), selected.month))
          }
          value={String(selected.year)}
        >
          {yearOptions(selected.year, current.year).map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </select>
      </label>
      {value === currentMonth ? null : (
        <Button
          className="tap-target"
          onClick={() => onChange(currentMonth)}
          size="sm"
          variant="outline"
        >
          This month
        </Button>
      )}
    </div>
  );
}
