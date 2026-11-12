import { useCallback, useMemo, useState } from "react";

import {
  DEFAULT_REQUEST_FILTERS,
  type RequestFilters,
} from "./request-queries";
import { useDebouncedValue } from "./use-debounced-value";

export interface RequestFilterState {
  /** What is typed in the search box (the query uses the debounced value). */
  filters: RequestFilters;
  isFiltered: boolean;
  patch: (change: Partial<RequestFilters>) => void;
  reset: () => void;
  searchText: string;
  setSearchText: (text: string) => void;
}

/** Board filters held in component state; search is debounced before it reaches the query. */
export function useRequestFilters(): RequestFilterState {
  const [base, setBase] = useState<RequestFilters>(DEFAULT_REQUEST_FILTERS);
  const [searchText, setSearchText] = useState("");
  const search = useDebouncedValue(searchText);

  const filters = useMemo(() => ({ ...base, search }), [base, search]);
  const patch = useCallback(
    (change: Partial<RequestFilters>) =>
      setBase((current) => ({ ...current, ...change })),
    []
  );
  const reset = useCallback(() => {
    setBase(DEFAULT_REQUEST_FILTERS);
    setSearchText("");
  }, []);
  const isFiltered =
    base.datePreset !== "all" || base.mine || searchText.trim() !== "";

  return { filters, isFiltered, patch, reset, searchText, setSearchText };
}
