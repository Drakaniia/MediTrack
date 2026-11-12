import { useEffect } from "react";

/**
 * Tells the settings page whether this tab has unsaved edits (it asks before
 * leaving). `onDirtyChange` must be a stable function (a state setter).
 */
export function useReportDirty(
  dirty: boolean,
  onDirtyChange: (dirty: boolean) => void
): void {
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
}
