import type {
  AdjustReason,
  DisposalDto,
  DisposalReason,
  ThresholdResultDto,
} from "@shared/schemas/expiry";
import type { BatchDto } from "@shared/schemas/inventory";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiPatch, apiPost } from "@/lib/api/client";
import { invalidateStockQueries } from "@/lib/api/invalidate";

/** Every mutation here changes stock (or an alert threshold): refresh all stock-derived caches. */
function useStockMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateStockQueries(queryClient),
  });
}

export type AdjustBody =
  | { delta: number; newQty?: undefined }
  | { delta?: undefined; newQty: number };

export type AdjustBatchInput = AdjustBody & {
  batchId: string;
  note?: string;
  reason: AdjustReason;
};

/** `POST /api/batches/:id/adjust`: count correction (exactly one of `newQty` / `delta`). */
export function useAdjustBatch() {
  return useStockMutation(({ batchId, ...body }: AdjustBatchInput) =>
    apiPost<BatchDto>(`/batches/${batchId}/adjust`, body)
  );
}

export interface DisposeBatchInput {
  batchId: string;
  note?: string;
  reason: DisposalReason;
}

/** `POST /api/batches/:id/dispose`: writes off the whole remaining quantity. */
export function useDisposeBatch() {
  return useStockMutation(({ batchId, ...body }: DisposeBatchInput) =>
    apiPost<DisposalDto>(`/batches/${batchId}/dispose`, body)
  );
}

export interface UpdateThresholdInput {
  itemId: string;
  lowStockThreshold: number;
}

/** `PATCH /api/items/:id/threshold`. */
export function useUpdateThreshold() {
  return useStockMutation(
    ({ itemId, lowStockThreshold }: UpdateThresholdInput) =>
      apiPatch<ThresholdResultDto>(`/items/${itemId}/threshold`, {
        lowStockThreshold,
      })
  );
}
