import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { isExpired } from "@shared/expiry";
import {
  DISPOSAL_REASON_LABELS,
  DISPOSAL_REASONS,
  type DisposalDto,
  type DisposalReason,
} from "@shared/schemas/expiry";
import { type FormEvent, type ReactElement, useState } from "react";
import { toast } from "sonner";

import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useFacility } from "@/lib/auth/guards";
import { formatDate, formatQuantity } from "@/lib/format";

import { useDisposeBatch } from "../hooks/stock-operations";
import { NoteField, ReasonField, type ReasonOption } from "./dialog-fields";

/** What the dialog needs to know about the batch (any row DTO can supply it). */
export interface DisposeDialogBatch {
  batchId: string;
  batchNumber: string;
  /** "Paracetamol 500 mg". */
  displayName: string;
  /** `YYYY-MM-DD`, or null when the batch never expires. */
  expiry: string | null;
  /** Units left; the WHOLE quantity is written off. */
  qty: number;
  unit: string;
}

export interface DisposeDialogProps {
  batch: DisposeDialogBatch;
  /** Cancel, the close button, Escape and after a successful disposal. */
  onClose: () => void;
  onDisposed?: (disposal: DisposalDto) => void;
}

function reasonOptions(expired: boolean): ReasonOption[] {
  return DISPOSAL_REASONS.filter(
    (reason) => expired || reason !== "expired"
  ).map((reason) => ({ label: DISPOSAL_REASON_LABELS[reason], value: reason }));
}

function isDisposalReason(value: string): value is DisposalReason {
  return (DISPOSAL_REASONS as readonly string[]).includes(value);
}

/**
 * Dispose / write off ONE batch: the whole remaining quantity goes (spec §6.4), with a required
 * reason and an optional note. "Expired" is offered only for a batch that is expired today (the API
 * refuses it otherwise). Errors show only after the first submit.
 */
export function DisposeDialog({
  batch,
  onClose,
  onDisposed,
}: DisposeDialogProps): ReactElement {
  const { today } = useFacility();
  const expired = isExpired(batch.expiry, today);
  const [reason, setReason] = useState(expired ? "expired" : "");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();
  const dispose = useDisposeBatch();
  const error = submitted && reason === "" ? "Choose a reason." : serverError;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setServerError(undefined);
    if (!isDisposalReason(reason)) {
      return;
    }
    dispose.mutate(
      { batchId: batch.batchId, note: note.trim(), reason },
      {
        onError: (failure) => {
          setServerError(fieldErrors(failure).reason);
          toast.error(errorMessage(failure, "Could not dispose of the batch."));
        },
        onSuccess: (disposal) => {
          toast.success(
            `Disposed of ${formatQuantity(batch.qty, batch.unit)} (batch ${batch.batchNumber}).`
          );
          onDisposed?.(disposal);
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
            <DialogTitle>
              Dispose / write off batch {batch.batchNumber}
            </DialogTitle>
            <DialogDescription>
              {batch.displayName}
              {batch.expiry ? ` · expires ${formatDate(batch.expiry)}` : ""}.
              All {formatQuantity(batch.qty, batch.unit)} left in this batch
              will be written off. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <ReasonField
            error={error}
            onChange={(value) => {
              setReason(value);
              setServerError(undefined);
            }}
            options={reasonOptions(expired)}
            value={reason}
          />
          <NoteField onChange={setNote} value={note} />
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={dispose.isPending}
              type="submit"
              variant="destructive"
            >
              Dispose {formatQuantity(batch.qty, batch.unit)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
