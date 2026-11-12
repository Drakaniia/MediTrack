import { suggestBatchNumber } from "@shared/batch-code";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { apiGet } from "@/lib/api/client";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { useFacility } from "@/lib/auth/guards";

import {
  EMPTY_PRODUCT,
  type NewProductDraft,
  validateProduct,
} from "../components/add-stock/new-product-fields";
import {
  type BatchDraftRow,
  bumpSuggestion,
  newBatchRow,
  parseQty,
  type RowError,
  validateRows,
} from "../lib/batch-rows";
import {
  type ReceiveOutcome,
  type ReceiveProgress,
  receiveRows,
} from "../lib/receive-rows";
import { useCreateItem, useReceiveBatch } from "./inventory-mutations";

export type ProductMode = "existing" | "new";
export type FormStep = "edit" | "review";

export interface DuplicateState {
  batchNumber: string;
  existingQty: number;
  qty: string;
}

export interface DoneState {
  batches: number;
  expired: number;
  itemId: string | null;
  productName: string;
}

export interface ConflictState {
  existingItemId: string;
  message: string;
}

const NO_ROW_ERRORS: ReadonlyMap<string, RowError> = new Map();
const NO_PRODUCT_ERRORS: Partial<Record<keyof NewProductDraft, string>> = {};
const FRESH_PROGRESS: ReceiveProgress = { expired: 0, saved: 0 };

function toItemBody(draft: NewProductDraft, rows: readonly BatchDraftRow[]) {
  const threshold = draft.lowStockThreshold.trim();
  return {
    barcode: draft.barcode.trim() === "" ? null : draft.barcode.trim(),
    batches: rows.map((row) => ({
      batchNumber: row.batchNumber.trim(),
      expiry: row.expiry.trim() === "" ? null : row.expiry.trim(),
      qty: parseQty(row.qty) ?? 0,
      supplier: row.supplier.trim(),
    })),
    categoryId: draft.categoryId === "" ? null : draft.categoryId,
    hasExpiry: draft.hasExpiry,
    lowStockThreshold: threshold === "" ? 0 : Number(threshold),
    name: draft.name.trim(),
    sku: draft.sku.trim() === "" ? null : draft.sku.trim(),
    strength: draft.strength.trim(),
    supplier: draft.supplier.trim(),
    unit: draft.unit.trim(),
  };
}

export function useAddStockForm() {
  const { today } = useFacility();
  const [mode, setMode] = useState<ProductMode>("existing");
  const [selected, setSelected] = useState<ItemSummaryDto | null>(null);
  const [draft, setDraft] = useState<NewProductDraft>(EMPTY_PRODUCT);
  const [rows, setRows] = useState<BatchDraftRow[]>(() => [newBatchRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState<FormStep>("edit");
  const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const progress = useRef<ReceiveProgress>(FRESH_PROGRESS);
  const create = useCreateItem();
  const receive = useReceiveBatch();

  const hasExpiry =
    mode === "new" ? draft.hasExpiry : (selected?.hasExpiry ?? true);
  const productName =
    mode === "new"
      ? [draft.name.trim(), draft.strength.trim()].filter(Boolean).join(" ")
      : (selected?.displayName ?? "");

  const allRowErrors = validateRows(rows, hasExpiry);
  const allProductErrors = mode === "new" ? validateProduct(draft) : {};
  const pickerMissing = mode === "existing" && selected === null;
  const valid =
    allRowErrors.size === 0 &&
    Object.keys(allProductErrors).length === 0 &&
    !pickerMissing;

  const suggest = useCallback(
    async (taken: string[]): Promise<string> => {
      if (mode === "existing" && selected) {
        const { batchNumber } = await apiGet<{ batchNumber: string }>(
          "/batches/suggest-number",
          { itemId: selected.id }
        );
        return bumpSuggestion(batchNumber, taken);
      }
      return suggestBatchNumber({
        existingNumbers: taken,
        itemName: draft.name,
        receivedOn: today,
      });
    },
    [draft.name, mode, selected, today]
  );

  const selectItem = async (item: ItemSummaryDto): Promise<void> => {
    setSelected(item);
    setConflict(null);
    try {
      const { batchNumber } = await apiGet<{ batchNumber: string }>(
        "/batches/suggest-number",
        { itemId: item.id }
      );
      setRows((current) =>
        current.length === 1 && current[0].batchNumber === ""
          ? [{ ...current[0], batchNumber }]
          : current
      );
    } catch {
      // The suggestion is a convenience; saving still numbers blank rows on the server.
    }
  };

  const reset = () => {
    setRows([newBatchRow()]);
    setSubmitted(false);
    setStep("edit");
    setDuplicate(null);
    setConflict(null);
    progress.current = FRESH_PROGRESS;
  };

  const finish = (result: DoneState) => {
    toast.success(
      `Saved ${result.batches} ${result.batches === 1 ? "batch" : "batches"} of ${result.productName}.`
    );
    if (result.expired > 0) {
      toast.warning(
        `${result.expired} ${result.expired === 1 ? "batch was" : "batches were"} already expired and went to quarantine.`
      );
    }
    setDone(result);
    reset();
  };

  const settle = (outcome: ReceiveOutcome, itemId: string) => {
    progress.current = { expired: outcome.expired, saved: outcome.saved };
    if (outcome.status === "done") {
      finish({
        batches: outcome.saved,
        expired: outcome.expired,
        itemId,
        productName,
      });
      return;
    }
    setRows(outcome.remaining);
    setStep("edit");
    if (outcome.status === "duplicate") {
      setDuplicate({
        batchNumber: outcome.batchNumber,
        existingQty: outcome.existingQty,
        qty: outcome.remaining[0]?.qty ?? "",
      });
      return;
    }
    toast.error(errorMessage(outcome.error, "Could not save the stock."));
  };

  const receiveInto = async (
    itemId: string,
    toSave: readonly BatchDraftRow[],
    mergeKey?: string
  ) => {
    const outcome = await receiveRows({
      itemId,
      mergeKey,
      progress: progress.current,
      receive: receive.mutateAsync,
      rows: toSave,
    });
    settle(outcome, itemId);
  };

  const createProduct = async () => {
    try {
      const result = await create.mutateAsync(toItemBody(draft, rows));
      finish({
        batches: result.item.batches.length,
        expired: result.warnings.length,
        itemId: result.item.id,
        productName,
      });
    } catch (error) {
      setStep("edit");
      const details = isApiError(error)
        ? (error.details as { existingItemId?: string } | undefined)
        : undefined;
      if (
        isApiError(error) &&
        error.code === "conflict" &&
        details?.existingItemId
      ) {
        setConflict({
          existingItemId: details.existingItemId,
          message: error.message,
        });
        return;
      }
      toast.error(errorMessage(error, "Could not save the product."));
    }
  };

  const save = async () => {
    setDone(null);
    if (mode === "new") {
      await createProduct();
      return;
    }
    if (selected) {
      progress.current = FRESH_PROGRESS;
      await receiveInto(selected.id, rows);
    }
  };

  const mergeDuplicate = async () => {
    if (!selected || rows.length === 0) {
      return;
    }
    setDuplicate(null);
    await receiveInto(selected.id, rows, rows[0].key);
  };

  /** After a duplicate-product conflict: switch to the product that already exists. */
  const adoptExisting = async (itemId: string) => {
    try {
      const item = await apiGet<ItemSummaryDto>(`/items/${itemId}`);
      setMode("existing");
      await selectItem(item);
    } catch (error) {
      toast.error(errorMessage(error, "Could not open the existing product."));
    }
  };

  const requestReview = () => {
    setSubmitted(true);
    if (valid) {
      setStep("review");
    }
  };

  return {
    adoptExisting,
    conflict,
    done,
    draft,
    duplicate,
    hasExpiry,
    mergeDuplicate,
    mode,
    pending: create.isPending || receive.isPending,
    pickerError: submitted && pickerMissing,
    productErrors: submitted ? allProductErrors : NO_PRODUCT_ERRORS,
    productName,
    requestReview,
    rowErrors: submitted ? allRowErrors : NO_ROW_ERRORS,
    rows,
    save,
    selected,
    selectItem,
    setDone,
    setDraft,
    setDuplicate,
    setMode,
    setRows,
    setSelected,
    setStep,
    step,
    submitted,
    suggest,
    today,
  };
}
