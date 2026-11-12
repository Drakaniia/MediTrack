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
import { QuantityStepper } from "@cmis/ui/components/quantity-stepper";
import { Textarea } from "@cmis/ui/components/textarea";
import { MAX_REQUEST_QTY } from "@shared/schemas/requests";
import { Plus, TriangleAlert, X } from "lucide-react";
import { type FormEvent, type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";
import { formatQuantity } from "@/lib/format";

import { useCreateRequests } from "../hooks/request-mutations";
import {
  type DraftLine,
  type LineErrors,
  type NewRequestFormState,
  type NewRequestInitial,
  useNewRequestForm,
} from "../hooks/use-new-request-form";
import { ItemAvailability, ItemPicker } from "./item-picker";

export interface NewRequestDialogProps {
  initial: NewRequestInitial;
  onClose: () => void;
}

interface LineRowProps {
  errors: LineErrors | undefined;
  form: NewRequestFormState;
  index: number;
  line: DraftLine;
  removable: boolean;
}

function ShortageWarning({ line }: { line: DraftLine }): ReactElement | null {
  const { item, qty } = line;
  if (!item || qty === "" || qty <= item.available) {
    return null;
  }
  return (
    <p className="flex items-center gap-1 text-[var(--warning)] text-xs">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      Only {formatQuantity(item.available, item.unit)} available now. The
      request can still be created; it can only be handed over when stock
      arrives.
    </p>
  );
}

/** One requested item: the picker until an item is chosen, then its name, availability and quantity. */
function LineRow({
  errors,
  form,
  index,
  line,
  removable,
}: LineRowProps): ReactElement {
  const qtyId = useId();
  const { item } = line;
  return (
    <li className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-sm">Item {index + 1}</p>
        {removable ? (
          <Button
            aria-label={`Remove item ${index + 1}`}
            onClick={() => form.removeLine(line.key)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
      {item ? (
        <div className="flex items-start justify-between gap-2">
          <div className="grid gap-0.5">
            <p className="text-sm">{item.displayName}</p>
            <ItemAvailability item={item} />
          </div>
          <Button
            onClick={() => form.setItem(line.key, null)}
            size="sm"
            type="button"
            variant="outline"
          >
            Change
          </Button>
        </div>
      ) : (
        <ItemPicker
          error={errors?.item}
          label={`Item ${index + 1}`}
          onPick={(picked) => form.setItem(line.key, picked)}
        />
      )}
      <div className="grid gap-1">
        <Label htmlFor={qtyId}>Quantity{item ? ` (${item.unit})` : ""}</Label>
        <QuantityStepper
          id={qtyId}
          invalid={Boolean(errors?.qty)}
          max={MAX_REQUEST_QTY}
          min={0}
          onChange={(qty) => form.setQty(line.key, qty)}
          value={line.qty}
        />
        {errors?.qty ? (
          <p className="text-destructive text-xs" role="alert">
            {errors.qty}
          </p>
        ) : null}
        <ShortageWarning line={line} />
      </div>
    </li>
  );
}

function RequestorFields({
  form,
}: {
  form: NewRequestFormState;
}): ReactElement {
  const nameId = useId();
  const refId = useId();
  const emailId = useId();
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm">
        Requestor (optional, blank means walk-in)
      </summary>
      <div className="grid gap-2 pt-2 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor={nameId}>Requestor name</Label>
          <Input
            id={nameId}
            onChange={(event) =>
              form.setRequestor({ name: event.target.value })
            }
            value={form.requestor.name}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={refId}>Student / staff ID</Label>
          <Input
            id={refId}
            onChange={(event) => form.setRequestor({ ref: event.target.value })}
            value={form.requestor.ref}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={emailId}>Requestor email</Label>
          <Input
            id={emailId}
            onChange={(event) =>
              form.setRequestor({ email: event.target.value })
            }
            type="email"
            value={form.requestor.email}
          />
        </div>
      </div>
    </details>
  );
}

/**
 * New request (Ctrl+N). One request is created per line. Per spec §7.4 the quantity message
 * ("Quantity must be a whole number greater than zero.") appears ONLY after the user clicks
 * Create, never while picking an item.
 */
export function NewRequestDialog({
  initial,
  onClose,
}: NewRequestDialogProps): ReactElement {
  const reasonId = useId();
  const form = useNewRequestForm(initial);
  const create = useCreateRequests();
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const checked = form.validate();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (!checked.input) {
      return;
    }
    create.mutate(checked.input, {
      onError: (error) =>
        setServerError(errorMessage(error, "Could not create the request.")),
      onSuccess: (requests) => {
        toast.success(
          requests.length === 1
            ? `Request ${requests[0].code} created.`
            : `${requests.length} requests created.`
        );
        onClose();
      },
    });
  };

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form className="grid gap-3" noValidate onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New request</DialogTitle>
            <DialogDescription>
              Ask for stock. Each item becomes its own request in the queue.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2">
            {form.lines.map((line, index) => (
              <LineRow
                errors={submitted ? checked.errors[index] : undefined}
                form={form}
                index={index}
                key={line.key}
                line={line}
                removable={form.lines.length > 1}
              />
            ))}
          </ul>
          <Button
            disabled={form.lines.length >= form.maxLines}
            onClick={form.addLine}
            type="button"
            variant="outline"
          >
            <Plus aria-hidden data-icon="inline-start" />
            Add another item
          </Button>
          <div className="grid gap-1">
            <Label htmlFor={reasonId}>Reason (optional)</Label>
            <Textarea
              id={reasonId}
              maxLength={500}
              onChange={(event) => form.setReason(event.target.value)}
              rows={2}
              value={form.reason}
            />
          </div>
          <RequestorFields form={form} />
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={create.isPending} type="submit">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
