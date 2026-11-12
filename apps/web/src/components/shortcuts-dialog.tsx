import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import type { ReactElement } from "react";

import { formatHotkey, HOTKEYS } from "@/lib/hotkeys";

export interface ShortcutsDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

/** The reserved keyboard shortcuts (`HOTKEYS`), opened with `?` or from the palette. */
export function ShortcutsDialog({
  onOpenChange,
  open,
}: ShortcutsDialogProps): ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            A handheld scanner works anywhere the scan field has focus.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2">
          {HOTKEYS.map((hotkey) => (
            <div
              className="flex items-center justify-between gap-4 text-sm"
              key={hotkey.id}
            >
              <dt>{hotkey.description}</dt>
              <dd>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {formatHotkey(hotkey.combo)}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
