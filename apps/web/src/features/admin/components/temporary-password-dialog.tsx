import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import type { TemporaryPasswordResponse } from "@shared/schemas/users";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { type ReactElement, useCallback, useState } from "react";
import { toast } from "sonner";

export type TemporaryPasswordContext = "created" | "reset";

export interface TemporaryPasswordDialogProps {
  context: TemporaryPasswordContext;
  onClose: () => void;
  result: TemporaryPasswordResponse;
}

const TITLES: Record<TemporaryPasswordContext, string> = {
  created: "Account created",
  reset: "Password reset",
};

/**
 * Shows a temporary password exactly once. The server never returns it again, so
 * the dialog says so, offers a one-click copy and only closes on purpose
 * (clicking outside does nothing).
 */
export function TemporaryPasswordDialog({
  context,
  onClose,
  result,
}: TemporaryPasswordDialogProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const { temporaryPassword, user } = result;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
      toast.success("Password copied.");
    } catch {
      toast.error("Couldn't copy. Select the password and copy it by hand.");
    }
  }, [temporaryPassword]);

  return (
    <Dialog
      disablePointerDismissal
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLES[context]}</DialogTitle>
          <DialogDescription>
            Give this temporary password to {user.displayName} ({user.username}
            ). They must choose their own password the first time they sign in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>This password is shown only once.</strong> It can't be
            looked up later. If it is lost, reset the password again.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <output
            aria-label="Temporary password"
            className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm"
          >
            {temporaryPassword}
          </output>
          <Button onClick={handleCopy} type="button" variant="outline">
            {copied ? (
              <Check aria-hidden className="size-4" />
            ) : (
              <Copy aria-hidden className="size-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose} type="button">
            I've saved it — close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
