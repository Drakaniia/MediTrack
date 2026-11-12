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
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import {
  MAX_REQUEST_QTY,
  QTY_MESSAGE,
  type QuickDeductResultDto,
} from "@shared/schemas/requests";
import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

import { errorMessage } from "@/lib/api/errors";

import { useQuickDeduct } from "../hooks/request-mutations";
import { useItemDetail } from "../hooks/request-queries";
import { ItemAvailability, ItemPicker } from "./item-picker";

export interface QuickDeductDialogProps {
  initialItemId?: string;
  onClose: () => void;
  /** Called with the result so the caller can show the Undo toast. */
  onDone: (result: QuickDeductResultDto, item: ItemSummaryDto) => void;
}

function isValidQty(qty: number | ""): qty is number {
  return (
    qty !== "" && Number.isInteger(qty) && qty > 0 && qty <= MAX_REQUEST_QTY
  );
}

/** Ctrl+D: one item, one quantity, one confirm. Failures (e.g. not enough stock) stay inline. */
export function QuickDeductDialog({
  initialItemId,
  onClose,
  onDone,
}: QuickDeductDialogProps): ReactElement {
  const qtyId = useId();
  const recipientId = useId();
  const noteId = useId();
  const [item, setItem] = useState<ItemSummaryDto | null>(null);
  const [qty, setQty] = useState<number | "">("");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const prefill = useItemDetail(initialItemId);
  const deduct = useQuickDeduct();

  useEffect(() => {
    if (prefill.data) {
      setItem((current) => current ?? prefill.data ?? null);
    }
  }, [prefill.data]);

  const itemError = submitted && item === null ? "Choose an item." : undefined;
  const qtyError = submitted && !isValidQty(qty) ? QTY_MESSAGE : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (item === null || !isValidQty(qty)) {
      return;
    }
    deduct.mutate(
      {
        itemId: item.id,
        note: note.trim() || undefined,
        qty,
        recipient: recipient.trim() || undefined,
      },
      {
        onError: (error) =>
          setServerError(errorMessage(error, "Could not deduct the stock.")),
        onSuccess: (result) => {
          onDone(result, item);
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
            <DialogTitle>Quick deduct</DialogTitle>
            <DialogDescription>
              Hand stock out now, first-expired-first-out. You can undo it for a
              minute afterwards.
            </DialogDescription>
          </DialogHeader>
          {item ? (
            <div className="flex items-start justify-between gap-2 rounded-lg border p-3">
              <div className="grid gap-0.5">
                <p className="text-sm">{item.displayName}</p>
                <ItemAvailability item={item} />
              </div>
              <Button
                onClick={() => setItem(null)}
                size="sm"
                type="button"
                variant="outline"
              >
                Change
              </Button>
            </div>
          ) : (
            <ItemPicker error={itemError} onPick={setItem} />
          )}
          <div className="grid gap-1">
            <Label htmlFor={qtyId}>
              Quantity{item ? ` (${item.unit})` : ""}
            </Label>
            <QuantityStepper
              id={qtyId}
              invalid={Boolean(qtyError)}
              max={MAX_REQUEST_QTY}
              min={0}
              onChange={setQty}
              value={qty}
            />
            {qtyError ? (
              <p className="text-destructive text-xs" role="alert">
                {qtyError}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1">
            <Label htmlFor={recipientId}>Recipient (optional)</Label>
            <Input
              id={recipientId}
              onChange={(event) => setRecipient(event.target.value)}
              value={recipient}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={noteId}>Note (optional)</Label>
            <Input
              id={noteId}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </div>
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={deduct.isPending} type="submit">
              Deduct
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
