import type { ExpiryClass } from "@shared/expiry";
import { DEFAULT_EXPIRY_LIST_CLASSES } from "@shared/schemas/expiry";
import { useCallback, useMemo, useState } from "react";

import type { ExpiryFilters } from "./expiry-queries";
import { useDebouncedValue } from "./use-debounced-value";

export const DEFAULT_EXPIRY_FILTERS: ExpiryFilters = {
  categoryId: "",
  classes: [...DEFAULT_EXPIRY_LIST_CLASSES],
  dir: "asc",
  from: "",
  search: "",
  sort: "expiry",
  to: "",
};

/** Class order of the chips and tiles, worst first. */
export const CLASS_DISPLAY_ORDER: readonly ExpiryClass[] = [
  "urgent",
  "near_expiry",
  "expired",
  "safe",
];

function sameClasses(a: readonly ExpiryClass[], b: readonly ExpiryClass[]) {
  return a.length === b.length && a.every((entry) => b.includes(entry));
}

function orderClasses(classes: readonly ExpiryClass[]): ExpiryClass[] {
  return CLASS_DISPLAY_ORDER.filter((entry) => classes.includes(entry));
}

export function isExpiryFiltered(filters: ExpiryFilters, search: string) {
  return (
    search !== "" ||
    filters.categoryId !== "" ||
    filters.from !== "" ||
    filters.to !== "" ||
    !sameClasses(filters.classes, DEFAULT_EXPIRY_FILTERS.classes)
  );
}

export interface ExpiryFilterState {
  /** The filters to query with (search is debounced). */
  filters: ExpiryFilters;
  isFiltered: boolean;
  patch: (next: Partial<ExpiryFilters>) => void;
  reset: () => void;
  /** The search box value, ahead of `filters.search`. */
  search: string;
  /** Tiles: show only this class; pressing the only selected class again restores the default. */
  selectOnly: (expiryClass: ExpiryClass) => void;
  setSearch: (value: string) => void;
  /** Chips: add or remove one class (never leaves the list empty). */
  toggleClass: (expiryClass: ExpiryClass) => void;
}

export function useExpiryFilters(): ExpiryFilterState {
  const [state, setState] = useState<ExpiryFilters>(DEFAULT_EXPIRY_FILTERS);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());

  const patch = useCallback((next: Partial<ExpiryFilters>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const toggleClass = useCallback((expiryClass: ExpiryClass) => {
    setState((current) => {
      const has = current.classes.includes(expiryClass);
      const next = has
        ? current.classes.filter((entry) => entry !== expiryClass)
        : [...current.classes, expiryClass];
      return next.length === 0
        ? current
        : { ...current, classes: orderClasses(next) };
    });
  }, []);

  const selectOnly = useCallback((expiryClass: ExpiryClass) => {
    setState((current) => ({
      ...current,
      classes: sameClasses(current.classes, [expiryClass])
        ? [...DEFAULT_EXPIRY_FILTERS.classes]
        : [expiryClass],
    }));
  }, []);

  const reset = useCallback(() => {
    setState(DEFAULT_EXPIRY_FILTERS);
    setSearch("");
  }, []);

  const filters = useMemo(
    () => ({ ...state, search: debouncedSearch }),
    [state, debouncedSearch]
  );

  return {
    filters,
    isFiltered: isExpiryFiltered(state, search),
    patch,
    reset,
    search,
    selectOnly,
    setSearch,
    toggleClass,
  };
}
