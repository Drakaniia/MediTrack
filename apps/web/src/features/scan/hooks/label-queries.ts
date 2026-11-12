import type { ExpiryRowDto } from "@shared/schemas/expiry";
import type {
  BatchDto,
  ItemDetailDto,
  ItemSummaryDto,
} from "@shared/schemas/inventory";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiGet } from "@/lib/api/client";

import type { LabelBatch } from "../lib/label-layout";
import {
  labelBatchFromDto,
  labelBatchFromExpiryRow,
} from "../lib/label-source";

/** Data for the labels page, all from existing endpoints. Query keys live under the `scan` root. */

const SEARCH_LIMIT = 20;
const EXPIRING_LIMIT = 200;
const RECENT_ITEM_LIMIT = 8;
const RECENT_BATCH_LIMIT = 24;
const SEARCH_DEBOUNCE_MS = 250;

export const labelKeys = {
  batch: (id: string) => ["scan", "labels", "batch", id] as const,
  expiring: ["scan", "labels", "expiring"] as const,
  item: (id: string) => ["scan", "labels", "item", id] as const,
  recent: ["scan", "labels", "recent"] as const,
  search: (term: string) => ["scan", "labels", "search", term] as const,
};

export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

export function useItemSearch(term: string) {
  const search = term.trim();
  return useQuery({
    enabled: search !== "",
    queryFn: ({ signal }) =>
      apiGet<ItemSummaryDto[]>(
        "/items",
        { limit: SEARCH_LIMIT, search, sort: "name" },
        { signal }
      ),
    queryKey: labelKeys.search(search),
  });
}

export function useItemWithBatches(itemId: string | null) {
  return useQuery({
    enabled: itemId !== null,
    queryFn: ({ signal }) =>
      apiGet<ItemDetailDto>(`/items/${itemId ?? ""}`, undefined, { signal }),
    queryKey: labelKeys.item(itemId ?? ""),
  });
}

/** `?batch=<id>`: the batch plus its item's name, ready to print. */
export function useLabelBatchById(batchId: string | undefined) {
  return useQuery({
    enabled: batchId !== undefined,
    queryFn: async ({ signal }): Promise<LabelBatch> => {
      const id = batchId ?? "";
      const batch = await apiGet<BatchDto>(`/batches/${id}`, undefined, { signal });
      const item = await apiGet<ItemDetailDto>(`/items/${batch.itemId}`, undefined, { signal });
      return labelBatchFromDto(batch, item);
    },
    queryKey: labelKeys.batch(batchId ?? ""),
  });
}

/** Every urgent or near-expiry batch that still holds stock. */
export async function fetchExpiringSoon(queryClient: QueryClient): Promise<LabelBatch[]> {
  const rows = await queryClient.fetchQuery({
    queryFn: () =>
      apiGet<ExpiryRowDto[]>("/expiry", {
        class: ["urgent", "near_expiry"],
        limit: EXPIRING_LIMIT,
      }),
    queryKey: labelKeys.expiring,
    staleTime: 0,
  });
  return rows.map(labelBatchFromExpiryRow);
}

/** The newest batches of the most recently changed items. */
export async function fetchRecentlyReceived(queryClient: QueryClient): Promise<LabelBatch[]> {
  const items = await queryClient.fetchQuery({
    queryFn: () =>
      apiGet<ItemSummaryDto[]>("/items", {
        dir: "desc",
        limit: RECENT_ITEM_LIMIT,
        sort: "updated",
      }),
    queryKey: labelKeys.recent,
    staleTime: 0,
  });
  const details = await Promise.all(
    items.map((item) =>
      queryClient.fetchQuery({
        queryFn: () => apiGet<ItemDetailDto>(`/items/${item.id}`),
        queryKey: labelKeys.item(item.id),
        staleTime: 0,
      })
    )
  );
  return details
    .flatMap((detail) => detail.batches.map((batch) => ({ batch, detail })))
    .sort((a, b) => b.batch.receivedOn.localeCompare(a.batch.receivedOn))
    .slice(0, RECENT_BATCH_LIMIT)
    .map(({ batch, detail }) => labelBatchFromDto(batch, detail));
}
