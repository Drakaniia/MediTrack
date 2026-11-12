import type { DenyReason, RequestStatus } from "@shared/request-transitions";
import type {
  ArchiveResultDto,
  CreateRequestsInput,
  DispenseResultDto,
  DispensingRecordDto,
  QuickDeductInput,
  QuickDeductResultDto,
  RequestDto,
  UpdateRequestInput,
} from "@shared/schemas/requests";
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { apiPatch, apiPost } from "@/lib/api/client";
import { invalidateStockQueries } from "@/lib/api/invalidate";

import { requestKeys } from "./request-queries";

/** Stock-affecting writes refresh every stock-derived cache (items, dashboard, alerts, …). */
function useStockMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateStockQueries(queryClient),
  });
}

/** Board-only writes (no quantity changes) refresh just the request queries. */
function useBoardMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: requestKeys.all }),
  });
}

export function useCreateRequests() {
  return useStockMutation((input: CreateRequestsInput) =>
    apiPost<RequestDto[]>("/requests", input)
  );
}

export function useUpdateRequest() {
  return useBoardMutation(
    ({ id, ...body }: UpdateRequestInput & { id: string }) =>
      apiPatch<RequestDto>(`/requests/${id}`, body)
  );
}

export interface TransitionVariables {
  deniedNote?: string;
  deniedReason?: DenyReason;
  id: string;
  note?: string;
  to: RequestStatus;
}

type ListSnapshot = [readonly unknown[], RequestDto[] | undefined][];

function withStatus(
  rows: RequestDto[] | undefined,
  id: string,
  status: RequestStatus
): RequestDto[] | undefined {
  return rows?.map((row) => (row.id === id ? { ...row, status } : row));
}

function snapshotLists(queryClient: QueryClient): ListSnapshot {
  return queryClient
    .getQueriesData<RequestDto[]>({ queryKey: requestKeys.listRoot })
    .map(([key, rows]) => [key, rows]);
}

/**
 * A status move with an OPTIMISTIC update of every cached board list: the card jumps columns at
 * once and rolls back (with the server's message) if the API refuses.
 */
export function useTransitionRequest() {
  const queryClient = useQueryClient();
  // Explicit generics: the snapshot type is not inferred from onMutate into onError.
  return useMutation<RequestDto, Error, TransitionVariables, ListSnapshot>({
    mutationFn: ({ id, ...body }: TransitionVariables) =>
      apiPost<RequestDto>(`/requests/${id}/transition`, body),
    onError: (_error, _variables, snapshot) => {
      for (const [key, rows] of snapshot ?? []) {
        queryClient.setQueryData(key, rows);
      }
    },
    onMutate: async (variables): Promise<ListSnapshot> => {
      await queryClient.cancelQueries({ queryKey: requestKeys.listRoot });
      const snapshot = snapshotLists(queryClient);
      queryClient.setQueriesData<RequestDto[]>(
        { queryKey: requestKeys.listRoot },
        (rows) => withStatus(rows, variables.id, variables.to)
      );
      return snapshot;
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: requestKeys.all }),
  });
}

export function useCancelRequest() {
  return useBoardMutation(({ id, note }: { id: string; note?: string }) =>
    apiPost<RequestDto>(`/requests/${id}/cancel`, { note })
  );
}

export interface DispenseVariables {
  allowPartial?: boolean;
  id: string;
  qty?: number;
}

export function useDispenseRequest() {
  return useStockMutation(({ id, ...body }: DispenseVariables) =>
    apiPost<DispenseResultDto>(`/requests/${id}/dispense`, body)
  );
}

export function useReorderRequests() {
  return useBoardMutation(
    (body: { orderedIds: string[]; status: RequestStatus }) =>
      apiPost<{ reordered: number }>("/requests/reorder", body)
  );
}

export function useArchiveClaimed() {
  return useBoardMutation(() =>
    apiPost<ArchiveResultDto>("/requests/archive-claimed", {})
  );
}

export function useQuickDeduct() {
  return useStockMutation((input: QuickDeductInput) =>
    apiPost<QuickDeductResultDto>("/quick-deduct", input)
  );
}

export function useUndoQuickDeduct() {
  return useStockMutation((recordId: string) =>
    apiPost<DispensingRecordDto>(`/quick-deduct/${recordId}/undo`)
  );
}
