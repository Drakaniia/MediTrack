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
import { DENY_REASONS, type DenyReason } from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";
import { type FormEvent, type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";

import { useTransitionRequest } from "../hooks/request-mutations";
import { FieldError, NATIVE_SELECT_CLASS } from "./form-parts";

export interface DenyRequestDialogProps {
  onClose: () => void;
  /** One request (card menu) or several (batch "Deny all"). */
  requests: RequestDto[];
}

function isDenyReason(value: string): value is DenyReason {
  return (DENY_REASONS as readonly string[]).includes(value);
}

/** A reason is required (spec §7.4); the error shows only after the first submit. */
export function DenyRequestDialog({
  onClose,
  requests,
}: DenyRequestDialogProps): ReactElement {
  const reasonId = useId();
  const noteId = useId();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const transition = useTransitionRequest();
  const reasonError =
    submitted && !isDenyReason(reason)
      ? "Choose a reason for denying."
      : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!isDenyReason(reason)) {
      return;
    }
    let failed = 0;
    for (const request of requests) {
      try {
        await transition.mutateAsync({
          deniedNote: note.trim(),
          deniedReason: reason,
          id: request.id,
          to: "denied",
        });
      } catch (error) {
        failed += 1;
        toast.error(errorMessage(error, `Could not deny ${request.code}.`));
      }
    }
    if (failed < requests.length) {
      toast.success(
        requests.length === 1
          ? `${requests[0].code} denied.`
          : `${requests.length - failed} requests denied.`
      );
    }
    onClose();
  };

  const subject =
    requests.length === 1
      ? `${requests[0].code} · ${requests[0].itemName}`
      : `${requests.length} requests`;

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent>
        <form className="grid gap-3" noValidate onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Deny request</DialogTitle>
            <DialogDescription>
              {subject}. The requester sees the reason; a denied request can be
              re-opened later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor={reasonId}>Reason</Label>
            <select
              aria-describedby={reasonError ? `${reasonId}-error` : undefined}
              aria-invalid={reasonError ? true : undefined}
              className={NATIVE_SELECT_CLASS}
              id={reasonId}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            >
              <option value="">Choose a reason</option>
              {DENY_REASONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <FieldError error={reasonError} id={`${reasonId}-error`} />
          </div>
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
              disabled={transition.isPending}
              type="submit"
              variant="destructive"
            >
              Deny
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
