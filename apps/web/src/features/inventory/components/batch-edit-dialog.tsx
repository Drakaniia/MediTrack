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
import { isIsoDate } from "@shared/dates";
import type { BatchDto } from "@shared/schemas/inventory";
import { type FormEvent, type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage, fieldErrors } from "@/lib/api/errors";

import { useUpdateBatch } from "../hooks/inventory-mutations";

export interface BatchEditDialogProps {
  batch: BatchDto;
  hasExpiry: boolean;
  onClose: () => void;
}

interface Draft {
  barcode: string;
  batchNumber: string;
  expiry: string;
  receivedOn: string;
  supplier: string;
}

function validate(draft: Draft, hasExpiry: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.batchNumber.trim() === "") {
    errors.batchNumber = "Enter the batch number.";
  }
  if (hasExpiry && !isIsoDate(draft.expiry)) {
    errors.expiry = "Enter a real expiry date.";
  }
  if (!isIsoDate(draft.receivedOn)) {
    errors.receivedOn = "Enter the date it was received.";
  }
  return errors;
}

function Field({
  error,
  label,
  onChange,
  type = "text",
  value,
}: {
  error?: string;
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}): ReactElement {
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
      {error ? (
        <p className="text-destructive text-xs" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Edits a batch's details. The quantity is deliberately absent: stock changes use Adjust. */
export function BatchEditDialog({
  batch,
  hasExpiry,
  onClose,
}: BatchEditDialogProps): ReactElement {
  const [draft, setDraft] = useState<Draft>({
    barcode: batch.barcode ?? "",
    batchNumber: batch.batchNumber,
    expiry: batch.expiry ?? "",
    receivedOn: batch.receivedOn,
    supplier: batch.supplier,
  });
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const update = useUpdateBatch();
  const errors = submitted
    ? { ...validate(draft, hasExpiry), ...serverErrors }
    : {};
  const set = (key: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validate(draft, hasExpiry)).length > 0) {
      return;
    }
    update.mutate(
      {
        barcode: draft.barcode.trim() === "" ? null : draft.barcode.trim(),
        batchId: batch.id,
        batchNumber: draft.batchNumber.trim(),
        ...(hasExpiry ? { expiry: draft.expiry } : {}),
        receivedOn: draft.receivedOn,
        supplier: draft.supplier.trim(),
      },
      {
        onError: (error) => {
          setServerErrors(fieldErrors(error));
          toast.error(errorMessage(error, "Could not save the batch."));
        },
        onSuccess: () => {
          toast.success("Batch updated.");
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
            <DialogTitle>Edit batch {batch.batchNumber}</DialogTitle>
            <DialogDescription>
              Quantity can only change through stock operations, so it is not
              editable here.
            </DialogDescription>
          </DialogHeader>
          <Field
            error={errors.batchNumber}
            label="Batch number"
            onChange={set("batchNumber")}
            value={draft.batchNumber}
          />
          {hasExpiry ? (
            <Field
              error={errors.expiry}
              label="Expiry date"
              onChange={set("expiry")}
              type="date"
              value={draft.expiry}
            />
          ) : null}
          <Field
            error={errors.receivedOn}
            label="Received on"
            onChange={set("receivedOn")}
            type="date"
            value={draft.receivedOn}
          />
          <Field
            label="Supplier"
            onChange={set("supplier")}
            value={draft.supplier}
          />
          <Field
            label="Barcode"
            onChange={set("barcode")}
            value={draft.barcode}
          />
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={update.isPending} type="submit">
              Save batch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
