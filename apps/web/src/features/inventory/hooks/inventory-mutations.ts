import type {
  BatchDto,
  BulkImportResultDto,
  CategoryDto,
  CreateBatchResultDto,
  CreateItemResultDto,
  ItemDetailDto,
} from "@shared/schemas/inventory";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiPatch, apiPost } from "@/lib/api/client";
import { invalidateStockQueries } from "@/lib/api/invalidate";

/** Every mutation refreshes all stock-derived caches (list, detail, FEFO, dashboard, …). */
function useStockMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateStockQueries(queryClient),
  });
}

export interface BatchBody {
  barcode?: string | null;
  batchNumber?: string;
  expiry?: string | null;
  qty: number;
  receivedOn?: string;
  supplier?: string;
}

export interface CreateItemBody {
  barcode?: string | null;
  batches?: BatchBody[];
  categoryId?: string | null;
  hasExpiry?: boolean;
  lowStockThreshold?: number;
  name: string;
  notes?: string;
  packSize?: number | null;
  packUnit?: string;
  sku?: string | null;
  strength?: string;
  supplier?: string;
  unit?: string;
}

export type UpdateItemBody = Partial<Omit<CreateItemBody, "batches">>;

export function useCreateItem() {
  return useStockMutation((body: CreateItemBody) =>
    apiPost<CreateItemResultDto>("/items", body)
  );
}

export function useUpdateItem(itemId: string) {
  return useStockMutation((body: UpdateItemBody) =>
    apiPatch<ItemDetailDto>(`/items/${itemId}`, body)
  );
}

export function useDeleteItem() {
  return useStockMutation((itemId: string) => apiDelete(`/items/${itemId}`));
}

export interface ReceiveBatchInput extends BatchBody {
  itemId: string;
  mergeIntoExisting?: boolean;
}

export function useReceiveBatch() {
  return useStockMutation(({ itemId, ...body }: ReceiveBatchInput) =>
    apiPost<CreateBatchResultDto>(`/items/${itemId}/batches`, body)
  );
}

export interface UpdateBatchInput {
  barcode?: string | null;
  batchId: string;
  batchNumber?: string;
  expiry?: string | null;
  receivedOn?: string;
  supplier?: string;
}

export function useUpdateBatch() {
  return useStockMutation(({ batchId, ...body }: UpdateBatchInput) =>
    apiPatch<BatchDto>(`/batches/${batchId}`, body)
  );
}

export function useDeleteBatch() {
  return useStockMutation((batchId: string) =>
    apiDelete(`/batches/${batchId}`)
  );
}

export function useBulkImport() {
  return useStockMutation(
    (input: { dryRun: boolean; rows: Record<string, string>[] }) =>
      apiPost<BulkImportResultDto>("/items/bulk", input)
  );
}

export function useSaveCategory() {
  return useStockMutation(({ id, name }: { id?: string; name: string }) =>
    id
      ? apiPatch<CategoryDto>(`/categories/${id}`, { name })
      : apiPost<CategoryDto>("/categories", { name })
  );
}

export function useDeleteCategory() {
  return useStockMutation(
    ({ id, reassignTo }: { id: string; reassignTo?: string }) =>
      apiDelete(
        `/categories/${id}${reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : ""}`
      )
  );
}

export type TrashKind = "batch" | "item";

export function useRestoreTrash() {
  return useStockMutation(({ id, kind }: { id: string; kind: TrashKind }) =>
    apiPost(`/trash/${kind}/${id}/restore`)
  );
}

export function usePurgeTrash() {
  return useStockMutation(({ id, kind }: { id: string; kind: TrashKind }) =>
    apiDelete(`/trash/${kind}/${id}`)
  );
}
