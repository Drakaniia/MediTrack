import type { LowStockListStatus } from "@shared/schemas/expiry";
import { useCallback, useMemo, useState } from "react";

import type { LowStockFilters } from "./expiry-queries";
import { useDebouncedValue } from "./use-debounced-value";

export const DEFAULT_LOW_STOCK_FILTERS: LowStockFilters = {
  categoryId: "",
  dir: "asc",
  search: "",
  sort: "status",
  statuses: ["low", "out"],
};

export interface LowStockFilterState {
  filters: LowStockFilters;
  isFiltered: boolean;
  patch: (next: Partial<LowStockFilters>) => void;
  reset: () => void;
  search: string;
  setSearch: (value: string) => void;
  /** Add or remove one status chip (never leaves the list empty). */
  toggleStatus: (status: LowStockListStatus) => void;
}

export function useLowStockFilters(): LowStockFilterState {
  const [state, setState] = useState<LowStockFilters>(
    DEFAULT_LOW_STOCK_FILTERS
  );
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());

  const patch = useCallback((next: Partial<LowStockFilters>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const toggleStatus = useCallback((status: LowStockListStatus) => {
    setState((current) => {
      const has = current.statuses.includes(status);
      const next = has
        ? current.statuses.filter((entry) => entry !== status)
        : [...current.statuses, status];
      return next.length === 0 ? current : { ...current, statuses: next };
    });
  }, []);

  const reset = useCallback(() => {
    setState(DEFAULT_LOW_STOCK_FILTERS);
    setSearch("");
  }, []);

  const filters = useMemo(
    () => ({ ...state, search: debouncedSearch }),
    [state, debouncedSearch]
  );

  return {
    filters,
    isFiltered:
      search !== "" ||
      state.categoryId !== "" ||
      state.statuses.length !== DEFAULT_LOW_STOCK_FILTERS.statuses.length,
    patch,
    reset,
    search,
    setSearch,
    toggleStatus,
  };
}
