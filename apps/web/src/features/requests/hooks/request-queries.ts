import type { ItemDetailDto, ItemSummaryDto } from "@shared/schemas/inventory";
import type {
  DispensingRecordDto,
  MonthlyDispensingDto,
  RequestDatePreset,
  RequestDto,
} from "@shared/schemas/requests";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiGet, apiGetPage } from "@/lib/api/client";

export interface RequestFilters {
  datePreset: RequestDatePreset;
  from: string;
  mine: boolean;
  search: string;
  to: string;
}

export const DEFAULT_REQUEST_FILTERS: RequestFilters = {
  datePreset: "all",
  from: "",
  mine: false,
  search: "",
  to: "",
};

export const requestKeys = {
  all: ["requests"] as const,
  detail: (id: string) => ["requests", "detail", id] as const,
  list: (filters: RequestFilters) => ["requests", "list", filters] as const,
  listRoot: ["requests", "list"] as const,
};

export const dispensingKeys = {
  all: ["dispensing"] as const,
  list: (filters: DispensingFilters, page: number) =>
    ["dispensing", "list", filters, page] as const,
  monthly: (month: string) => ["dispensing", "monthly", month] as const,
};

export interface DispensingFilters {
  from: string;
  includeUndone: boolean;
  search: string;
  source: "" | "queue" | "quick_deduct";
  to: string;
}

export const DEFAULT_DISPENSING_FILTERS: DispensingFilters = {
  from: "",
  includeUndone: false,
  search: "",
  source: "",
  to: "",
};

export const DISPENSING_PAGE_SIZE = 50;

/** The board: every live request matching the filters (claimed older than 24 h are left out). */
export function useRequestList(filters: RequestFilters) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiGet<RequestDto[]>("/requests", {
        datePreset: filters.datePreset,
        from: filters.datePreset === "custom" ? filters.from : undefined,
        mine: filters.mine ? 1 : undefined,
        search: filters.search.trim(),
        to: filters.datePreset === "custom" ? filters.to : undefined,
      }),
    queryKey: requestKeys.list(filters),
  });
}

export interface DispensingPage {
  records: DispensingRecordDto[];
  total: number;
}

export function useDispensingLog(filters: DispensingFilters, page: number) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<DispensingPage> => {
      const result = await apiGetPage<DispensingRecordDto[]>("/dispensing", {
        from: filters.from,
        includeUndone: filters.includeUndone ? 1 : undefined,
        limit: DISPENSING_PAGE_SIZE,
        offset: page * DISPENSING_PAGE_SIZE,
        search: filters.search.trim(),
        source: filters.source,
        to: filters.to,
      });
      return { records: result.data, total: result.meta.total ?? 0 };
    },
    queryKey: dispensingKeys.list(filters, page),
  });
}

export function useMonthlyDispensing(month: string, enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: () =>
      apiGet<MonthlyDispensingDto>("/dispensing/monthly", { month }),
    queryKey: dispensingKeys.monthly(month),
  });
}

const PICKER_LIMIT = 20;

/** Item picker search: `GET /api/items?search=` (shows availability and the nearest expiry). */
export function useItemSearch(search: string) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiGet<ItemSummaryDto[]>("/items", {
        limit: PICKER_LIMIT,
        search: search.trim(),
      }),
    queryKey: ["inventory", "items", "request-picker", search.trim()],
  });
}

/** One item with its batches, for the dispense preview and the pre-filled dialogs. */
export function useItemDetail(itemId: string | null | undefined) {
  return useQuery({
    enabled: Boolean(itemId),
    queryFn: () => apiGet<ItemDetailDto>(`/items/${itemId}`),
    queryKey: ["inventory", "items", "detail", itemId],
  });
}
