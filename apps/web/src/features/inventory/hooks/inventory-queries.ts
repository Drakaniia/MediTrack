import type { ExpiryClass } from "@shared/expiry";
import type {
  BatchDto,
  CategoryDto,
  FefoEntryDto,
  HistoryEntryDto,
  ItemDetailDto,
  ItemSummaryDto,
  LowStockStatus,
  TrashListDto,
} from "@shared/schemas/inventory";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

import { apiGet, apiGetPage } from "@/lib/api/client";

export const ITEM_PAGE_SIZE = 100;
const HISTORY_PAGE_SIZE = 50;

export type ItemSortKey =
  | "category"
  | "name"
  | "nearestExpiry"
  | "onHand"
  | "updated";

export interface ItemFilters {
  categoryId: string;
  dir: "asc" | "desc";
  search: string;
  sort: ItemSortKey;
  status: ExpiryClass[];
  stock: LowStockStatus[];
}

export const DEFAULT_ITEM_FILTERS: ItemFilters = {
  categoryId: "",
  dir: "asc",
  search: "",
  sort: "name",
  status: [],
  stock: [],
};

export const inventoryKeys = {
  categories: ["inventory", "categories"] as const,
  detail: (itemId: string) => ["inventory", "items", "detail", itemId] as const,
  fefo: (categoryId: string) => ["inventory", "fefo", categoryId] as const,
  history: (itemId: string) =>
    ["inventory", "items", "history", itemId] as const,
  items: (filters: ItemFilters) =>
    ["inventory", "items", "list", filters] as const,
  picker: (search: string) => ["inventory", "items", "picker", search] as const,
  suggestion: (itemId: string) =>
    ["inventory", "batches", "suggest", itemId] as const,
  trash: ["inventory", "trash"] as const,
};

interface ItemsPage {
  items: ItemSummaryDto[];
  offset: number;
  total: number;
}

async function fetchItemsPage(
  filters: ItemFilters,
  offset: number
): Promise<ItemsPage> {
  const { data, meta } = await apiGetPage<ItemSummaryDto[]>("/items", {
    categoryId: filters.categoryId,
    dir: filters.dir,
    limit: ITEM_PAGE_SIZE,
    offset,
    search: filters.search,
    sort: filters.sort,
    status: filters.status,
    stock: filters.stock,
  });
  return { items: data, offset, total: meta.total ?? data.length };
}

/** Server-paged item list: more pages load as the user scrolls (`fetchNextPage`). */
export function useItemList(filters: ItemFilters) {
  return useInfiniteQuery({
    getNextPageParam: (last: ItemsPage) => {
      const next = last.offset + ITEM_PAGE_SIZE;
      return next < last.total ? next : undefined;
    },
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => fetchItemsPage(filters, pageParam),
    queryKey: inventoryKeys.items(filters),
  });
}

export function flattenItemPages(
  pages: readonly ItemsPage[] | undefined
): ItemSummaryDto[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

export function useItemSearch(search: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: () =>
      apiGet<ItemSummaryDto[]>("/items", { limit: 20, search, sort: "name" }),
    queryKey: inventoryKeys.picker(search),
  });
}

export function useItemDetail(itemId: string | null) {
  return useQuery({
    enabled: itemId !== null,
    queryFn: () => apiGet<ItemDetailDto>(`/items/${itemId}`),
    queryKey: inventoryKeys.detail(itemId ?? ""),
  });
}

export function useItemHistory(itemId: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: () =>
      apiGet<HistoryEntryDto[]>(`/items/${itemId}/history`, {
        limit: HISTORY_PAGE_SIZE,
      }),
    queryKey: inventoryKeys.history(itemId),
  });
}

export function useCategories() {
  return useQuery({
    queryFn: () => apiGet<CategoryDto[]>("/categories"),
    queryKey: inventoryKeys.categories,
    staleTime: 60_000,
  });
}

export function useFefoList(categoryId: string) {
  return useQuery({
    queryFn: () => apiGet<FefoEntryDto[]>("/fefo", { categoryId, limit: 200 }),
    queryKey: inventoryKeys.fefo(categoryId),
  });
}

export function useTrash() {
  return useQuery({
    queryFn: () => apiGet<TrashListDto>("/trash"),
    queryKey: inventoryKeys.trash,
  });
}

export function useSuggestedBatchNumber(itemId: string | null) {
  return useQuery({
    enabled: itemId !== null,
    queryFn: async () => {
      const { batchNumber } = await apiGet<{ batchNumber: string }>(
        "/batches/suggest-number",
        { itemId }
      );
      return batchNumber;
    },
    queryKey: inventoryKeys.suggestion(itemId ?? ""),
    staleTime: 0,
  });
}

export function batchNumbersOf(batches: readonly BatchDto[]): string[] {
  return batches.map((batch) => batch.batchNumber);
}
