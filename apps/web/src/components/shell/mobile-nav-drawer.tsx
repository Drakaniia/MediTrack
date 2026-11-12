import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@cmis/ui/components/button";
import { X } from "lucide-react";
import { type ReactElement, useCallback, useEffect } from "react";

import { Brand } from "@/components/shell/brand";
import { SidebarNav } from "@/components/shell/sidebar-nav";

export interface MobileNavDrawerProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

/** Same breakpoint as Tailwind's `md`: from here up the sidebar is permanent. */
const DESKTOP_QUERY = "(min-width: 48rem)";

/**
 * Below `md` the sidebar is an off-canvas drawer. Built on Base UI's Dialog, so
 * focus is trapped inside while open, Escape and a backdrop click close it, and
 * focus returns to the menu button afterwards.
 */
export function MobileNavDrawer({
  onOpenChange,
  open,
}: MobileNavDrawerProps): ReactElement {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Growing the window past `md` shows the permanent sidebar: drop the drawer.
  useEffect(() => {
    if (!open) {
      return;
    }
    const query = window.matchMedia(DESKTOP_QUERY);
    const handleChange = (event: MediaQueryListEvent): void => {
      if (event.matches) {
        close();
      }
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [close, open]);

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0 md:hidden" />
        <Dialog.Popup
          aria-label="Navigation menu"
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-card text-card-foreground shadow-xl outline-none transition-transform duration-200 data-ending-style:-translate-x-full data-starting-style:-translate-x-full motion-reduce:transition-none md:hidden"
        >
          <div className="flex h-14 shrink-0 items-center justify-between px-3">
            <Brand />
            <Dialog.Close
              render={
                <Button
                  aria-label="Close navigation menu"
                  className="tap-target"
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <X />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-6">
            <SidebarNav onNavigate={close} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
