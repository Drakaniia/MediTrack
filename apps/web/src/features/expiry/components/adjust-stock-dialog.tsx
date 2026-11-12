import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import {
  ADJUST_REASON_LABELS,
  ADJUST_REASONS,
  type AdjustReason,
  MAX_STOCK_QTY,
} from "@shared/schemas/expiry";
import type { BatchDto } from "@shared/schemas/inventory";
import { type FormEvent, type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { formatQuantity } from "@/lib/format";

import { type AdjustBody, useAdjustBatch } from "../hooks/stock-operations";
import {
  FieldError,
  NoteField,
  ReasonField,
  type ReasonOption,
} from "./dialog-fields";

/** What the dialog needs to know about the batch (any row DTO can supply it). */
export interface AdjustDialogBatch {
  batchId: string;
  batchNumber: string;
  /** "Paracetamol 500 mg". */
  displayName: string;
  /** Units on hand right now. */
  qty: number;
  unit: string;
}

export interface AdjustStockDialogProps {
  batch: AdjustDialogBatch;
  onAdjusted?: (batch: BatchDto) => void;
  /** Cancel, the close button, Escape and after a successful adjustment. */
  onClose: () => void;
}

type AdjustMode = "change" | "set";

const WHOLE_NUMBER = /^\d+$/;
const SIGNED_WHOLE_NUMBER = /^[+-]?\d+$/;

const REASON_OPTIONS: ReasonOption[] = ADJUST_REASONS.map((reason) => ({
  label: ADJUST_REASON_LABELS[reason],
  value: reason,
}));

function isAdjustReason(value: string): value is AdjustReason {
  return (ADJUST_REASONS as readonly string[]).includes(value);
}

interface AmountCheck {
  body?: AdjustBody;
  error?: string;
  /** The quantity the batch would end up with, for the live preview. */
  result?: number;
}

/** Turns what was typed into the request body, or says what is wrong with it. */
export function checkAmount(
  mode: AdjustMode,
  text: string,
  current: number
): AmountCheck {
  const trimmed = text.trim();
  if (mode === "set") {
    if (!WHOLE_NUMBER.test(trimmed)) {
      return {
        error: "Enter the counted quantity as a whole number, 0 or more.",
      };
    }
    const newQty = Number(trimmed);
    if (newQty > MAX_STOCK_QTY) {
      return { error: "That quantity is too large." };
    }
    if (newQty === current) {
      return { error: "That is already the current quantity." };
    }
    return { body: { newQty }, result: newQty };
  }
  if (!SIGNED_WHOLE_NUMBER.test(trimmed) || Number(trimmed) === 0) {
    return { error: "Enter a whole number to add (5) or remove (-5)." };
  }
  const delta = Number(trimmed);
  if (current + delta < 0) {
    return { error: `Only ${current} on hand, so that would go below zero.` };
  }
  if (current + delta > MAX_STOCK_QTY) {
    return { error: "That quantity is too large." };
  }
  return { body: { delta }, result: current + delta };
}

function Preview({
  batch,
  result,
}: {
  batch: AdjustDialogBatch;
  result?: number;
}): ReactElement | null {
  if (result === undefined) {
    return null;
  }
  const change = result - batch.qty;
  const sign = change > 0 ? "+" : "";
  return (
    <output className="text-muted-foreground text-xs">
      {batch.qty} → {formatQuantity(result, batch.unit)} ({sign}
      {change})
    </output>
  );
}

/**
 * Count correction for ONE batch (spec §6.4): either set the counted total or add / remove a
 * number of units, with a required reason. Expired, disposed and trashed batches are refused by the
 * API; the quantity can never go below zero. Errors show only after the first submit.
 */
export function AdjustStockDialog({
  batch,
  onClose,
  onAdjusted,
}: AdjustStockDialogProps): ReactElement {
  const amountId = useId();
  const [mode, setMode] = useState<AdjustMode>("set");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const adjust = useAdjustBatch();

  const check = checkAmount(mode, amount, batch.qty);
  const amountError = submitted
    ? (check.error ?? serverErrors.newQty ?? serverErrors.delta)
    : undefined;
  const reasonError =
    submitted && reason === "" ? "Choose a reason." : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setServerErrors({});
    if (!(check.body && isAdjustReason(reason))) {
      return;
    }
    adjust.mutate(
      { ...check.body, batchId: batch.batchId, note: note.trim(), reason },
      {
        onError: (failure) => {
          setServerErrors(fieldErrors(failure));
          toast.error(errorMessage(failure, "Could not adjust the stock."));
        },
        onSuccess: (updated) => {
          toast.success(`Batch ${batch.batchNumber} now has ${updated.qty}.`);
          onAdjusted?.(updated);
          onClose();
        },
      }
    );
  };

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent>
        <form className="grid gap-3" noValidate onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Adjust batch {batch.batchNumber}</DialogTitle>
            <DialogDescription>
              {batch.displayName} · {formatQuantity(batch.qty, batch.unit)} on
              hand. Use this to correct a count, not to hand stock out.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <legend className="sr-only">How to change the quantity</legend>
            <label className="flex items-center gap-1.5">
              <input
                checked={mode === "set"}
                name="adjust-mode"
                onChange={() => setMode("set")}
                type="radio"
              />
              Set total to
            </label>
            <label className="flex items-center gap-1.5">
              <input
                checked={mode === "change"}
                name="adjust-mode"
                onChange={() => setMode("change")}
                type="radio"
              />
              Add or remove
            </label>
          </fieldset>
          <div className="grid gap-1">
            <Label htmlFor={amountId}>
              {mode === "set" ? "Counted quantity" : "Change (+ or −)"}
            </Label>
            <Input
              aria-describedby={amountError ? `${amountId}-error` : undefined}
              aria-invalid={amountError ? true : undefined}
              autoComplete="off"
              id={amountId}
              inputMode="numeric"
              onChange={(event) => setAmount(event.target.value)}
              value={amount}
            />
            <FieldError error={amountError} id={`${amountId}-error`} />
            <Preview batch={batch} result={check.result} />
          </div>
          <ReasonField
            error={reasonError}
            onChange={setReason}
            options={REASON_OPTIONS}
            value={reason}
          />
          <NoteField onChange={setNote} value={note} />
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={adjust.isPending} type="submit">
              Save adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
