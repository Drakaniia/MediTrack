import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import type { ReactElement } from "react";

export interface DuplicateBatchDialogProps {
  batchNumber: string;
  existingQty: number;
  onCancel: () => void;
  onMerge: () => void;
  pending: boolean;
  qty: string;
}

/** The batch number is already on this product: add to that batch, or pick another number. */
export function DuplicateBatchDialog({
  batchNumber,
  existingQty,
  onCancel,
  onMerge,
  pending,
  qty,
}: DuplicateBatchDialogProps): ReactElement {
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onCancel())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Batch {batchNumber} already exists</DialogTitle>
          <DialogDescription>
            This product already has a batch with that number and {existingQty}{" "}
            in stock. You can add the {qty} you are receiving to it, or go back
            and use a different batch number.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            Change batch number
          </Button>
          <Button disabled={pending} onClick={onMerge}>
            Add quantity to existing batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
