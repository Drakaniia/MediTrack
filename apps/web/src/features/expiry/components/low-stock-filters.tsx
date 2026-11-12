import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { cn } from "@cmis/ui/lib/utils";
import { LOW_STOCK_LABELS } from "@shared/low-stock";
import { LOW_STOCK_STATUSES, type LowStockSort } from "@shared/schemas/expiry";
import type { CategoryDto } from "@shared/schemas/inventory";
import { Search } from "lucide-react";
import type { ReactElement } from "react";

import type { LowStockFilterState } from "../hooks/use-low-stock-filters";
import { FilterSelect } from "./filter-select";

const SORT_OPTIONS: { label: string; value: LowStockSort }[] = [
  { label: "Most urgent", value: "status" },
  { label: "Shortfall", value: "gap" },
  { label: "Product", value: "item" },
  { label: "Available", value: "available" },
];

export interface LowStockFiltersProps {
  categories: readonly CategoryDto[];
  state: LowStockFilterState;
}

export function LowStockFilters({
  categories,
  state,
}: LowStockFiltersProps): ReactElement {
  const { filters, patch, reset, search, setSearch, toggleStatus } = state;
  return (
    <search aria-label="Filter low stock" className="grid gap-3 pb-4">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
        />
        <Input
          aria-label="Search items"
          className="pl-8"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, strength, supplier or SKU"
          type="search"
          value={search}
        />
      </div>
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Stock level</legend>
        {LOW_STOCK_STATUSES.map((status) => {
          const pressed = filters.statuses.includes(status);
          return (
            <button
              aria-pressed={pressed}
              className={cn(
                "rounded-full border px-3 py-1 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                pressed && "border-ring bg-accent font-medium"
              )}
              key={status}
              onClick={() => toggleStatus(status)}
              type="button"
            >
              {LOW_STOCK_LABELS[status]}
            </button>
          );
        })}
      </fieldset>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
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
        <FilterSelect
          label="Sort by"
          onChange={(sort) => patch({ sort: sort as LowStockSort })}
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
