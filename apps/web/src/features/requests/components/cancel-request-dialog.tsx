import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { Label } from "@cmis/ui/components/label";
import { Textarea } from "@cmis/ui/components/textarea";
import type { RequestDto } from "@shared/schemas/requests";
import { type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";

import { useCancelRequest } from "../hooks/request-mutations";

export interface CancelRequestDialogProps {
  onClose: () => void;
  request: RequestDto;
}

/** Withdraws a request before hand-over (requester or staff). Nothing is deducted. */
export function CancelRequestDialog({
  onClose,
  request,
}: CancelRequestDialogProps): ReactElement {
  const noteId = useId();
  const [note, setNote] = useState("");
  const cancel = useCancelRequest();

  const confirm = () => {
    cancel.mutate(
      { id: request.id, note: note.trim() || undefined },
      {
        onError: (error) =>
          toast.error(errorMessage(error, "Could not cancel the request.")),
        onSuccess: () => {
          toast.success(`${request.code} cancelled.`);
          onClose();
        },
      }
    );
  };

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel request</DialogTitle>
          <DialogDescription>
            {request.code} · {request.itemName}. The request is withdrawn and
            leaves the board; no stock is touched.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          <Label htmlFor={noteId}>Note (optional)</Label>
          <Textarea
            id={noteId}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            value={note}
          />
        </div>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Keep request
          </Button>
          <Button
            disabled={cancel.isPending}
            onClick={confirm}
            type="button"
            variant="destructive"
          >
            Cancel request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
