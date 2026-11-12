import { Button } from "@cmis/ui/components/button";
import { Plus, Zap } from "lucide-react";
import type { ReactElement } from "react";

import { Can } from "@/components/can";
import { useNewRequestDialog } from "@/features/requests/new-request-dialog-context";
import { useQuickDeductDialog } from "@/features/requests/quick-deduct-dialog-context";
import { formatHotkey } from "@/lib/hotkeys";

const KEY_HINT_CLASS =
  "ml-1 hidden rounded border bg-background/20 px-1 font-mono text-[10px] sm:inline";

/**
 * "New request" and "Quick deduct" call-to-action buttons with their keyboard shortcuts shown.
 * The shortcuts themselves are registered app-wide by the shell; a role without the permission
 * simply does not see the button.
 */
export function RequestActions(): ReactElement {
  const { openNewRequest } = useNewRequestDialog();
  const { openQuickDeduct } = useQuickDeductDialog();
  return (
    <>
      <Can permission="requests.create">
        <Button
          aria-keyshortcuts="Control+N"
          className="tap-target"
          onClick={() => openNewRequest()}
        >
          <Plus aria-hidden />
          New request
          <kbd aria-hidden className={KEY_HINT_CLASS}>
            {formatHotkey("mod+n")}
          </kbd>
        </Button>
      </Can>
      <Can permission="stock.quick_deduct">
        <Button
          aria-keyshortcuts="Control+D"
          className="tap-target"
          onClick={() => openQuickDeduct()}
          variant="outline"
        >
          <Zap aria-hidden />
          Quick deduct
          <kbd aria-hidden className={KEY_HINT_CLASS}>
            {formatHotkey("mod+d")}
          </kbd>
        </Button>
      </Can>
    </>
  );
}
