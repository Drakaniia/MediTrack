import type { ExpiryClass } from "@shared/expiry";
import type {
  DisposalDto,
  DisposalReason,
  ExpiryRowDto,
  ExpirySort,
  ExpirySummaryDto,
  LowStockListStatus,
  LowStockRowDto,
  LowStockSort,
  QuarantineRowDto,
  SortDirection,
} from "@shared/schemas/expiry";
import type { CategoryDto } from "@shared/schemas/inventory";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

import { apiGet, apiGetPage, type QueryParams } from "@/lib/api/client";

export const EXPIRY_PAGE_SIZE = 100;

export interface ExpiryFilters {
  categoryId: string;
  classes: ExpiryClass[];
  dir: SortDirection;
  /** `YYYY-MM-DD` or "". */
  from: string;
  search: string;
  sort: ExpirySort;
  to: string;
}

export interface LowStockFilters {
  categoryId: string;
  dir: SortDirection;
  search: string;
  sort: LowStockSort;
  statuses: LowStockListStatus[];
}

export interface DisposalFilters {
  reason: DisposalReason | "";
  search: string;
}

/** All roots are `inventory`, so `invalidateStockQueries` refreshes them after any stock change. */
export const expiryKeys = {
  categories: ["inventory", "categories"] as const,
  disposals: (filters: DisposalFilters) =>
    ["inventory", "disposals", filters] as const,
  list: (filters: ExpiryFilters) =>
    ["inventory", "expiry", "list", filters] as const,
  lowStock: (filters: LowStockFilters) =>
    ["inventory", "low-stock", filters] as const,
  quarantine: ["inventory", "quarantine"] as const,
  summary: ["inventory", "expiry", "summary"] as const,
};

interface PageResult<T> {
  offset: number;
  rows: T[];
  total: number;
}

async function fetchPage<T>(
  path: string,
  params: QueryParams,
  offset: number
): Promise<PageResult<T>> {
  const { data, meta } = await apiGetPage<T[]>(path, {
    ...params,
    limit: EXPIRY_PAGE_SIZE,
    offset,
  });
  return { offset, rows: data, total: meta.total ?? data.length };
}

function usePagedQuery<T>(
  queryKey: readonly unknown[],
  path: string,
  params: QueryParams
) {
  return useInfiniteQuery({
    getNextPageParam: (last: PageResult<T>) => {
      const next = last.offset + EXPIRY_PAGE_SIZE;
      return next < last.total ? next : undefined;
    },
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => fetchPage<T>(path, params, pageParam),
    queryKey,
  });
}

/** Rows of every loaded page, in order. */
export function flattenRows<T>(
  pages: readonly PageResult<T>[] | undefined
): T[] {
  return pages?.flatMap((page) => page.rows) ?? [];
}

/** The server's `meta.total` from the latest loaded page. */
export function totalOf<T>(
  pages: readonly PageResult<T>[] | undefined
): number {
  return pages?.at(-1)?.total ?? 0;
}

export function useExpiryList(filters: ExpiryFilters) {
  return usePagedQuery<ExpiryRowDto>(expiryKeys.list(filters), "/expiry", {
    categoryId: filters.categoryId,
    class: filters.classes,
    dir: filters.dir,
    from: filters.from,
    search: filters.search,
    sort: filters.sort,
    to: filters.to,
  });
}

export function useExpirySummary() {
  return useQuery({
    queryFn: () => apiGet<ExpirySummaryDto>("/expiry/summary"),
    queryKey: expiryKeys.summary,
  });
}

export function useLowStockList(filters: LowStockFilters) {
  return usePagedQuery<LowStockRowDto>(
    expiryKeys.lowStock(filters),
    "/low-stock",
    {
      categoryId: filters.categoryId,
      dir: filters.dir,
      search: filters.search,
      sort: filters.sort,
      status: filters.statuses,
    }
  );
}

export function useQuarantine() {
  return usePagedQuery<QuarantineRowDto>(
    expiryKeys.quarantine,
    "/quarantine",
    {}
  );
}

export function useDisposals(filters: DisposalFilters) {
  return usePagedQuery<DisposalDto>(
    expiryKeys.disposals(filters),
    "/disposals",
    {
      reason: filters.reason,
      search: filters.search,
    }
  );
}

/** Same key and endpoint as the inventory slice's category list, so the cache is shared. */
export function useExpiryCategories() {
  return useQuery({
    queryFn: () => apiGet<CategoryDto[]>("/categories"),
    queryKey: expiryKeys.categories,
    staleTime: 60_000,
  });
}
