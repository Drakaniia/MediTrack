import { AppleDatePicker } from "@cmis/ui/components/apple-date-picker";
import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import { cn } from "@cmis/ui/lib/utils";
import { addDays } from "@shared/dates";
import type { UserDto } from "@shared/schemas/users";
import { Search } from "lucide-react";
import { type ReactElement, useId } from "react";

import { type AuditFilters, EMPTY_AUDIT_FILTERS } from "../hooks/audit-queries";
import {
  AUDIT_ACTION_PREFIXES,
  AUDIT_ENTITY_TYPES,
} from "../lib/audit-actions";
import { SelectField } from "./form-controls";

export interface AuditFiltersBarProps {
  /** Everyone who can be an actor; `undefined` hides the actor filter (needs `users.manage`). */
  actors?: readonly UserDto[];
  filters: AuditFilters;
  onChange: (patch: Partial<AuditFilters>) => void;
  /** Why the date range is unusable, if it is. */
  rangeError?: string;
  /** Facility-local today, for the quick ranges. */
  today: string;
}

const ENTITY_OPTIONS = [
  { label: "Any record", value: "" },
  ...AUDIT_ENTITY_TYPES,
];

const QUICK_RANGES = [
  { days: 0, label: "Today" },
  { days: 6, label: "Last 7 days" },
  { days: 29, label: "Last 30 days" },
] as const;

function DateField({
  label,
  max,
  min,
  onChange,
  value,
}: {
  label: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  value: string;
}): ReactElement {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <AppleDatePicker
        aria-label={`${label} date`}
        className="h-9"
        id={id}
        max={max}
        min={min}
        onChange={onChange}
        value={value}
      />
    </div>
  );
}

function PrefixChips({
  onChange,
  value,
}: {
  onChange: (prefix: string) => void;
  value: string;
}): ReactElement {
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Action type</legend>
      <span aria-hidden className="text-muted-foreground text-xs">
        Action:
      </span>
      {AUDIT_ACTION_PREFIXES.map((entry) => {
        const pressed = value === entry.value;
        return (
          <button
            aria-pressed={pressed}
            className={cn(
              "rounded-full border px-3 py-1 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
              pressed && "border-ring bg-accent font-medium"
            )}
            key={entry.value}
            onClick={() => onChange(pressed ? "" : entry.value)}
            type="button"
          >
            {entry.label}
          </button>
        );
      })}
    </fieldset>
  );
}

/** Date range, actor, action-type chips, record type and free-text search for the audit log. */
export function AuditFiltersBar({
  actors,
  filters,
  onChange,
  rangeError,
  today,
}: AuditFiltersBarProps): ReactElement {
  const isFiltered =
    JSON.stringify(filters) !== JSON.stringify(EMPTY_AUDIT_FILTERS);
  return (
    <search aria-label="Filter audit log" className="grid gap-3 pb-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_1fr_1fr_1fr]">
        <DateField
          label="From"
          max={filters.to || undefined}
          onChange={(from) => onChange({ from })}
          value={filters.from}
        />
        <DateField
          label="To"
          min={filters.from || undefined}
          onChange={(to) => onChange({ to })}
          value={filters.to}
        />
        {actors ? (
          <SelectField
            label="Actor"
            onValueChange={(actorId) => onChange({ actorId })}
            options={[
              { label: "Anyone", value: "" },
              ...actors.map((user) => ({
                label: `${user.displayName} (${user.username})`,
                value: user.id,
              })),
            ]}
            value={filters.actorId}
          />
        ) : null}
        <SelectField
          label="Record type"
          onValueChange={(entityType) => onChange({ entityType })}
          options={ENTITY_OPTIONS}
          value={filters.entityType}
        />
        <div className="relative self-end">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
          />
          <Input
            aria-label="Search summary or actor"
            className="h-9 pl-8"
            onChange={(event) => onChange({ q: event.target.value })}
            placeholder="Search summary or actor"
            type="search"
            value={filters.q}
          />
        </div>
      </div>
      {rangeError ? (
        <p className="text-destructive text-xs" role="alert">
          {rangeError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_RANGES.map((range) => {
          const from = addDays(today, -range.days);
          const pressed = filters.from === from && filters.to === today;
          return (
            <Button
              aria-pressed={pressed}
              key={range.label}
              onClick={() => onChange({ from, to: today })}
              size="sm"
              variant={pressed ? "secondary" : "outline"}
            >
              {range.label}
            </Button>
          );
        })}
        {isFiltered ? (
          <Button
            onClick={() => onChange(EMPTY_AUDIT_FILTERS)}
            size="sm"
            variant="ghost"
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      <PrefixChips
        onChange={(prefix) => onChange({ prefix })}
        value={filters.prefix}
      />
    </search>
  );
}
