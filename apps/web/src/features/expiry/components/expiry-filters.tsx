import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import { cn } from "@cmis/ui/lib/utils";
import { EXPIRY_CLASS_LABELS, type ExpiryClass } from "@shared/expiry";
import type { ExpirySort } from "@shared/schemas/expiry";
import type { CategoryDto } from "@shared/schemas/inventory";
import { Search } from "lucide-react";
import { type ReactElement, useId } from "react";

import type { ExpiryFilterState } from "../hooks/use-expiry-filters";
import { CLASS_DISPLAY_ORDER } from "../hooks/use-expiry-filters";
import { FilterSelect } from "./filter-select";

const SORT_OPTIONS: { label: string; value: ExpirySort }[] = [
  { label: "Expiry date", value: "expiry" },
  { label: "Product", value: "item" },
  { label: "Quantity", value: "qty" },
  { label: "Severity", value: "class" },
];

export interface ExpiryFiltersProps {
  categories: readonly CategoryDto[];
  state: ExpiryFilterState;
}

function ClassChip({
  expiryClass,
  onToggle,
  pressed,
}: {
  expiryClass: ExpiryClass;
  onToggle: (expiryClass: ExpiryClass) => void;
  pressed: boolean;
}): ReactElement {
  return (
    <button
      aria-pressed={pressed}
      className={cn(
        "rounded-full border px-3 py-1 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
        pressed && "border-ring bg-accent font-medium"
      )}
      onClick={() => onToggle(expiryClass)}
      type="button"
    >
      {EXPIRY_CLASS_LABELS[expiryClass]}
    </button>
  );
}

function DateField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}): ReactElement {
  const id = useId();
  return (
    <div className="grid gap-1 text-xs">
      <Label className="font-medium text-muted-foreground" htmlFor={id}>
        {label}
      </Label>
      <Input
        className="h-8"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </div>
  );
}

/** Class chips, category, search, expiry date range and sort for the Expiry page. */
export function ExpiryFilters({
  categories,
  state,
}: ExpiryFiltersProps): ReactElement {
  const { filters, patch, reset, search, setSearch, toggleClass } = state;
  return (
    <search aria-label="Filter expiry list" className="grid gap-3 pb-4">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
        />
        <Input
          aria-label="Search batches"
          className="pl-8"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search product, strength or batch number"
          type="search"
          value={search}
        />
      </div>
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Expiry class</legend>
        {CLASS_DISPLAY_ORDER.map((entry) => (
          <ClassChip
            expiryClass={entry}
            key={entry}
            onToggle={toggleClass}
            pressed={filters.classes.includes(entry)}
          />
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <FilterSelect
          label="Category"
          onChange={(categoryId) => patch({ categoryId })}
          options={[
            { label: "All categories", value: "" },
            ...categories.map((category) => ({
              label: category.name,
              value: category.id,
            })),
          ]}
          value={filters.categoryId}
        />
        <DateField
          label="Expires from"
          onChange={(from) => patch({ from })}
          value={filters.from}
        />
        <DateField
          label="Expires to"
          onChange={(to) => patch({ to })}
          value={filters.to}
        />
        <FilterSelect
          label="Sort by"
          onChange={(sort) => patch({ sort: sort as ExpirySort })}
          options={SORT_OPTIONS}
          value={filters.sort}
        />
        <div className="flex items-end gap-2">
          <Button
            onClick={() =>
              patch({ dir: filters.dir === "asc" ? "desc" : "asc" })
            }
            variant="outline"
          >
            {filters.dir === "asc" ? "Ascending" : "Descending"}
          </Button>
          {state.isFiltered ? (
            <Button onClick={reset} variant="ghost">
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>
    </search>
  );
}
