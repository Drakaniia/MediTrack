import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
} from "@cmis/ui/components/popover";
import { MAX_STOCK_QTY } from "@shared/schemas/expiry";
import { type FormEvent, type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";

import { useUpdateThreshold } from "../hooks/stock-operations";
import { FieldError } from "./dialog-fields";

const WHOLE_NUMBER = /^\d+$/;

export interface ThresholdPopoverProps {
  /** "Paracetamol 500 mg", for the button's accessible name and the toast. */
  displayName: string;
  itemId: string;
  onSaved?: (threshold: number) => void;
  /** The current threshold; 0 means "never alert". */
  threshold: number;
}

/** Why `text` is not a usable threshold, or null when it is. */
export function thresholdProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!WHOLE_NUMBER.test(trimmed)) {
    return "Enter a whole number, 0 or more.";
  }
  return Number(trimmed) > MAX_STOCK_QTY ? "That number is too large." : null;
}

/**
 * Inline editor for an item's low-stock threshold (`inventory.write` only: wrap it in `<Can>`).
 * The alert fires when AVAILABLE stock (not expired) falls below this number; 0 turns it off.
 */
export function ThresholdPopover({
  displayName,
  itemId,
  onSaved,
  threshold,
}: ThresholdPopoverProps): ReactElement {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(threshold));
  const [submitted, setSubmitted] = useState(false);
  const update = useUpdateThreshold();
  const problem = submitted ? thresholdProblem(text) : null;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setText(String(threshold));
      setSubmitted(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (thresholdProblem(text) !== null) {
      return;
    }
    const lowStockThreshold = Number(text.trim());
    update.mutate(
      { itemId, lowStockThreshold },
      {
        onError: (failure) =>
          toast.error(errorMessage(failure, "Could not save the threshold.")),
        onSuccess: () => {
          toast.success(
            `Threshold for ${displayName} is now ${lowStockThreshold}.`
          );
          onSaved?.(lowStockThreshold);
          setOpen(false);
        },
      }
    );
  };

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={`Edit low-stock threshold of ${displayName}`}
            size="sm"
            variant="outline"
          />
        }
      >
        Threshold
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverPositioner sideOffset={6}>
          <PopoverPopup className="w-72">
            <form className="grid gap-2" noValidate onSubmit={submit}>
              <Label htmlFor={inputId}>Low-stock threshold</Label>
              <Input
                aria-describedby={problem ? `${inputId}-error` : undefined}
                aria-invalid={problem ? true : undefined}
                autoComplete="off"
                id={inputId}
                inputMode="numeric"
                onChange={(event) => setText(event.target.value)}
                value={text}
              />
              <FieldError
                error={problem ?? undefined}
                id={`${inputId}-error`}
              />
              <p className="text-muted-foreground">
                Alert when available (not expired) stock drops below this. 0
                turns the alert off.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setOpen(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button disabled={update.isPending} size="sm" type="submit">
                  Save threshold
                </Button>
              </div>
            </form>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}
