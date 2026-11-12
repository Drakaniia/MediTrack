import { Button } from "@cmis/ui/components/button";
import { cn } from "@cmis/ui/lib/utils";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactElement } from "react";

import { Brand } from "@/components/shell/brand";
import { SidebarNav } from "@/components/shell/sidebar-nav";

export interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * The desktop sidebar (md and up; phones use `MobileNavDrawer`). Collapses to
 * an icon rail; the choice is remembered (`hooks/use-sidebar-collapsed.ts`).
 */
export function AppSidebar({
  collapsed,
  onToggle,
}: AppSidebarProps): ReactElement {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-card transition-[width] duration-200 motion-reduce:transition-none md:flex print:hidden",
        collapsed ? "w-16" : "w-60"
      )}
      data-collapsed={collapsed}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-1 px-3",
          collapsed && "justify-center px-0"
        )}
      >
        {collapsed ? (
          // Collapsed: only the logo shows; hovering/focusing it swaps in the expand icon.
          <Button
            aria-expanded={false}
            aria-label="Expand sidebar"
            className="group tap-target relative"
            onClick={onToggle}
            size="icon-sm"
            variant="ghost"
          >
            <span className="transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 motion-reduce:transition-none">
              <Brand showName={false} />
            </span>
            <PanelLeftOpen className="absolute inset-0 m-auto opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" />
          </Button>
        ) : (
          <>
            <Brand />
            <Button
              aria-expanded
              aria-label="Collapse sidebar"
              className="tap-target ml-auto"
              onClick={onToggle}
              size="icon-sm"
              variant="ghost"
            >
              <PanelLeftClose />
            </Button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pt-1 pb-4">
        <SidebarNav collapsed={collapsed} />
      </div>
    </aside>
  );
}
