import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import type { ReactElement, ReactNode } from "react";

export interface ConfirmDialogProps {
  confirmLabel: string;
  description: ReactNode;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  title: string;
}

/** A small yes / no dialog. Rendered only while it is needed, so it is always "open". */
export function ConfirmDialog({
  confirmLabel,
  description,
  destructive = false,
  onCancel,
  onConfirm,
  pending = false,
  title,
}: ConfirmDialogProps): ReactElement {
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onCancel())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={onConfirm}
            variant={destructive ? "destructive" : "default"}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
