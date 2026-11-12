import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useState,
} from "react";

import { CommandPalette } from "@/components/command-palette";
import { AppHeader } from "@/components/shell/app-header";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { MobileNavDrawer } from "@/components/shell/mobile-nav-drawer";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { AlertBanner } from "@/features/alerts/components/alert-banner";
import { StockItemDetailDialogProvider } from "@/features/inventory/stock-item-detail-dialog-context";
import { NewRequestDialogProvider } from "@/features/requests/new-request-dialog-context";
import { QuickDeductDialogProvider } from "@/features/requests/quick-deduct-dialog-context";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";

export const MAIN_CONTENT_ID = "main-content";

/**
 * The signed-in frame: sidebar (drawer on phones), header, banners and the
 * page. The page scrolls like a normal web page (no inner scroll container),
 * and nothing here may be wider than the viewport (no horizontal page scroll).
 */
export function AppLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <NewRequestDialogProvider>
      <QuickDeductDialogProvider>
        <StockItemDetailDialogProvider>
          <Frame>{children}</Frame>
        </StockItemDetailDialogProvider>
      </QuickDeductDialogProvider>
    </NewRequestDialogProvider>
  );
}

function Frame({ children }: { children: ReactNode }): ReactElement {
  const { collapsed, toggle } = useSidebarCollapsed();
  const [navOpen, setNavOpen] = useState(false);
  const openNav = useCallback(() => setNavOpen(true), []);

  return (
    <div className="flex min-h-svh w-full min-w-0">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        href={`#${MAIN_CONTENT_ID}`}
      >
        Skip to content
      </a>
      <AppSidebar collapsed={collapsed} onToggle={toggle} />
      <MobileNavDrawer onOpenChange={setNavOpen} open={navOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <AppHeader onOpenNav={openNav} />
        <AlertBanner />
        <main
          className="min-w-0 flex-1 p-3 outline-none compact:md:p-4 md:p-6"
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
