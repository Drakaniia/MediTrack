import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { EXPIRY_CLASS_LABELS, type ExpiryClass } from "@shared/expiry";
import { LOW_STOCK_LABELS } from "@shared/low-stock";
import type { CategoryDto, LowStockStatus } from "@shared/schemas/inventory";
import { ArrowDownAZ, ArrowUpAZ, Search } from "lucide-react";
import type { ReactElement } from "react";

import {
  DEFAULT_ITEM_FILTERS,
  type ItemFilters,
  type ItemSortKey,
} from "../hooks/inventory-queries";
import { NativeSelect, type SelectOption } from "./native-select";

const ALL = "";

const STATUS_OPTIONS: SelectOption[] = [
  { label: "Any expiry status", value: ALL },
  ...(Object.keys(EXPIRY_CLASS_LABELS) as ExpiryClass[]).map((value) => ({
    label: EXPIRY_CLASS_LABELS[value],
    value,
  })),
];

const STOCK_OPTIONS: SelectOption[] = [
  { label: "Any stock level", value: ALL },
  ...(Object.keys(LOW_STOCK_LABELS) as LowStockStatus[]).map((value) => ({
    label: LOW_STOCK_LABELS[value],
    value,
  })),
];

const SORT_OPTIONS: { label: string; value: ItemSortKey }[] = [
  { label: "Name", value: "name" },
  { label: "Nearest expiry", value: "nearestExpiry" },
  { label: "On hand", value: "onHand" },
  { label: "Category", value: "category" },
  { label: "Recently updated", value: "updated" },
];

export interface InventoryFiltersProps {
  categories: readonly CategoryDto[];
  filters: ItemFilters;
  onChange: (next: ItemFilters) => void;
  /** The search box value, which lags the debounced `filters.search`. */
  onSearchChange: (value: string) => void;
  search: string;
}

function isFiltered(filters: ItemFilters, search: string): boolean {
  return (
    search !== "" ||
    filters.categoryId !== "" ||
    filters.status.length > 0 ||
    filters.stock.length > 0
  );
}

export function InventoryFilters({
  categories,
  filters,
  onChange,
  onSearchChange,
  search,
}: InventoryFiltersProps): ReactElement {
  const categoryOptions: SelectOption[] = [
    { label: "All categories", value: ALL },
    ...categories.map((category) => ({
      label: category.name,
      value: category.id,
    })),
  ];
  const nextDir = filters.dir === "asc" ? "desc" : "asc";
  const DirIcon = filters.dir === "asc" ? ArrowDownAZ : ArrowUpAZ;

  return (
    <search aria-label="Filter inventory" className="grid gap-3 pb-4">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
        />
        <Input
          aria-label="Search items"
          className="pl-8"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search name, strength, SKU or barcode"
          type="search"
          value={search}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <NativeSelect
          label="Expiry status"
          onChange={(value) =>
            onChange({
              ...filters,
              status: value === ALL ? [] : [value as ExpiryClass],
            })
          }
          options={STATUS_OPTIONS}
          value={filters.status[0] ?? ALL}
        />
        <NativeSelect
          label="Stock level"
          onChange={(value) =>
            onChange({
              ...filters,
              stock: value === ALL ? [] : [value as LowStockStatus],
            })
          }
          options={STOCK_OPTIONS}
          value={filters.stock[0] ?? ALL}
        />
        <NativeSelect
          label="Category"
          onChange={(categoryId) => onChange({ ...filters, categoryId })}
          options={categoryOptions}
          value={filters.categoryId}
        />
        <NativeSelect
          label="Sort by"
          onChange={(sort) =>
            onChange({ ...filters, sort: sort as ItemSortKey })
          }
          options={SORT_OPTIONS}
          value={filters.sort}
        />
        <div className="flex items-end gap-2">
          <Button
            aria-label={`Sort ${nextDir === "asc" ? "ascending" : "descending"}`}
            onClick={() => onChange({ ...filters, dir: nextDir })}
            size="icon"
            variant="outline"
          >
            <DirIcon aria-hidden />
          </Button>
          {isFiltered(filters, search) ? (
            <Button
              onClick={() => {
                onSearchChange("");
                onChange(DEFAULT_ITEM_FILTERS);
              }}
              variant="ghost"
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>
    </search>
  );
}
