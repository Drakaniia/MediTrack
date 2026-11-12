import { Button } from "@cmis/ui/components/button";
import { QUICK_DEDUCT_UNDO_SECONDS } from "@shared/api";
import { type ReactElement, useEffect, useState } from "react";

export interface QuickDeductUndoToastProps {
  /** Called once when the window has run out (the toast should disappear). */
  onExpire: () => void;
  /** Called when the user clicks Undo. */
  onUndo: () => Promise<void>;
  /** Length of the window; the server enforces the real one. */
  seconds?: number;
  /** What was deducted, e.g. "5 tabs of Paracetamol 500 mg". */
  summary: string;
}

const TICK_MS = 1000;

/**
 * The toast shown after a Quick Deduct: an **Undo** button that is live for the undo window, with
 * a visible countdown, then it goes away. The countdown starts from the full window when the
 * toast appears (not from clock arithmetic), so a wrong laptop clock cannot kill the button early.
 */
export function QuickDeductUndoToast({
  onExpire,
  onUndo,
  seconds = QUICK_DEDUCT_UNDO_SECONDS,
  summary,
}: QuickDeductUndoToastProps): ReactElement {
  const [left, setLeft] = useState(seconds);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (left <= 0) {
      onExpire();
      return;
    }
    const timer = window.setTimeout(
      () => setLeft((value) => value - 1),
      TICK_MS
    );
    return () => window.clearTimeout(timer);
  }, [left, onExpire]);

  const undo = async () => {
    setWorking(true);
    try {
      await onUndo();
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="flex w-full items-center justify-between gap-3 rounded-lg border bg-popover p-3 text-popover-foreground text-sm shadow-lg"
      role="status"
    >
      <p>Deducted {summary}.</p>
      <Button
        disabled={working || left <= 0}
        onClick={undo}
        size="sm"
        type="button"
        variant="outline"
      >
        Undo ({left}s)
      </Button>
    </div>
  );
}
