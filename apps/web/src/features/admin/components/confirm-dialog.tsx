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

import { FormAlert } from "./form-controls";

export interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel: string;
  description: ReactNode;
  destructive?: boolean;
  /** A refusal from the server: shown inside the dialog, which stays open. */
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  title: string;
}

/** A yes / no dialog. Rendered only while it is needed, so it is always open. */
export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel,
  description,
  destructive = false,
  error,
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
        {error ? <FormAlert>{error}</FormAlert> : null}
        <DialogFooter>
          <Button onClick={onCancel} type="button" variant="outline">
            {cancelLabel}
          </Button>
          <Button
            disabled={pending}
            onClick={onConfirm}
            type="button"
            variant={destructive ? "destructive" : "default"}
          >
            {pending ? <span>Working…</span> : <span>{confirmLabel}</span>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
