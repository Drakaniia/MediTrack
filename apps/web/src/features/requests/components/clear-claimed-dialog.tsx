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
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";

import { useArchiveClaimed } from "../hooks/request-mutations";

/** Clears the Claimed lane. The requests stay in the dispensing log. */
export function ClearClaimedDialog({
  count,
  onClose,
}: {
  count: number;
  onClose: () => void;
}): ReactElement {
  const archive = useArchiveClaimed();
  const confirm = () => {
    archive.mutate(undefined, {
      onError: (error) =>
        toast.error(errorMessage(error, "Could not clear claimed requests.")),
      onSuccess: ({ archived }) => {
        toast.success(`Cleared ${archived} claimed request(s) from the board.`);
        onClose();
      },
    });
  };
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear claimed requests</DialogTitle>
          <DialogDescription>
            {count} claimed request(s) will leave the board. They stay in the
            dispensing log. Claimed requests also leave the board by themselves
            after 24 hours.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Keep them
          </Button>
          <Button disabled={archive.isPending} onClick={confirm} type="button">
            Clear claimed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
