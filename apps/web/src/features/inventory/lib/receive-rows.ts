import type { CreateBatchResultDto } from "@shared/schemas/inventory";

import { isApiError } from "@/lib/api/errors";

import type { ReceiveBatchInput } from "../hooks/inventory-mutations";
import { type BatchDraftRow, parseQty } from "./batch-rows";

export type ReceiveFn = (
  input: ReceiveBatchInput
) => Promise<CreateBatchResultDto>;

export interface ReceiveProgress {
  /** Rows that landed on an item that was already expired on arrival. */
  expired: number;
  saved: number;
}

export type ReceiveOutcome =
  | ({ status: "done" } & ReceiveProgress)
  | ({
      batchNumber: string;
      existingQty: number;
      remaining: BatchDraftRow[];
      status: "duplicate";
    } & ReceiveProgress)
  | ({
      error: unknown;
      remaining: BatchDraftRow[];
      status: "error";
    } & ReceiveProgress);

interface DuplicateDetails {
  existingBatchNumber?: string;
  existingQty?: number;
}

function duplicateDetails(error: unknown): DuplicateDetails | null {
  if (!(isApiError(error) && error.code === "duplicate_batch")) {
    return null;
  }
  const details = error.details as DuplicateDetails | undefined;
  return details ?? {};
}

function toInput(
  itemId: string,
  row: BatchDraftRow,
  merge: boolean
): ReceiveBatchInput {
  const expiry = row.expiry.trim();
  return {
    batchNumber: row.batchNumber.trim(),
    expiry: expiry === "" ? null : expiry,
    itemId,
    mergeIntoExisting: merge,
    qty: parseQty(row.qty) ?? 0,
    supplier: row.supplier.trim(),
  };
}

/**
 * Receives the rows one after another (each is its own atomic request). Stops at the first
 * problem and hands back the rows that were NOT saved, so the page can keep them on screen,
 * ask about a duplicate batch, then call this again with `mergeKey` set for that row.
 */
export async function receiveRows(input: {
  itemId: string;
  mergeKey?: string;
  progress?: ReceiveProgress;
  receive: ReceiveFn;
  rows: readonly BatchDraftRow[];
}): Promise<ReceiveOutcome> {
  const progress = { expired: 0, saved: 0, ...input.progress };
  for (const [index, row] of input.rows.entries()) {
    const remaining = input.rows.slice(index);
    try {
      const result = await input.receive(
        toInput(input.itemId, row, row.key === input.mergeKey)
      );
      progress.saved += 1;
      progress.expired += result.warnings.includes("expired_on_arrival")
        ? 1
        : 0;
    } catch (error) {
      const duplicate = duplicateDetails(error);
      if (duplicate) {
        return {
          ...progress,
          batchNumber: duplicate.existingBatchNumber ?? row.batchNumber,
          existingQty: duplicate.existingQty ?? 0,
          remaining,
          status: "duplicate",
        };
      }
      return { ...progress, error, remaining, status: "error" };
    }
  }
  return { ...progress, status: "done" };
}
