import { Button, buttonVariants } from "@cmis/ui/components/button";
import { cn } from "@cmis/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { CircleHelp, Menu, PackageMinus, Plus } from "lucide-react";
import { type ReactElement, useCallback } from "react";

import { Can } from "@/components/can";
import { DensityToggle } from "@/components/density-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/features/alerts/components/notification-bell";
import { useNewRequestDialog } from "@/features/requests/new-request-dialog-context";
import { useQuickDeductDialog } from "@/features/requests/quick-deduct-dialog-context";
import { GlobalScanField } from "@/features/scan/components/global-scan-field";
import { useCan, useFacility } from "@/lib/auth/guards";
import { formatHotkey, useHotkey } from "@/lib/hotkeys";

export interface AppHeaderProps {
  onOpenNav: () => void;
}

const NEW_REQUEST_COMBO = "mod+n";
const QUICK_DEDUCT_COMBO = "mod+d";

/** The two global actions; their shortcuts live only while the role may use them. */
function GlobalActions(): ReactElement {
  const { openNewRequest } = useNewRequestDialog();
  const { openQuickDeduct } = useQuickDeductDialog();
  const canRequest = useCan("requests.create");
  const canDeduct = useCan("stock.quick_deduct");

  const handleNewRequest = useCallback(
    () => openNewRequest(),
    [openNewRequest]
  );
  const handleQuickDeduct = useCallback(
    () => openQuickDeduct(),
    [openQuickDeduct]
  );

  useHotkey(NEW_REQUEST_COMBO, handleNewRequest, {
    allowInInput: true,
    enabled: canRequest,
  });
  useHotkey(QUICK_DEDUCT_COMBO, handleQuickDeduct, {
    allowInInput: true,
    enabled: canDeduct,
  });

  return (
    <>
      {canRequest ? (
        <Button
          aria-keyshortcuts="Control+N Meta+N"
          aria-label="New request"
          className="tap-target gap-1.5"
          onClick={handleNewRequest}
          title={`New request (${formatHotkey(NEW_REQUEST_COMBO)})`}
          variant="default"
        >
          <Plus aria-hidden />
          <span className="hidden lg:inline">New request</span>
        </Button>
      ) : null}
      {canDeduct ? (
        <Button
          aria-keyshortcuts="Control+D Meta+D"
          aria-label="Quick deduct"
          className="tap-target gap-1.5"
          onClick={handleQuickDeduct}
          title={`Quick deduct (${formatHotkey(QUICK_DEDUCT_COMBO)})`}
          variant="outline"
        >
          <PackageMinus aria-hidden />
          <span className="hidden lg:inline">Quick deduct</span>
        </Button>
      ) : null}
    </>
  );
}

/**
 * The sticky top bar: menu button (phones), facility name, scan field, the two
 * global actions, notifications, help, preferences and the user menu. On a
 * phone the scan field wraps onto its own full-width row.
 */
export function AppHeader({ onOpenNav }: AppHeaderProps): ReactElement {
  const facility = useFacility();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80 print:hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 md:flex-nowrap md:px-4">
        <Button
          aria-haspopup="dialog"
          aria-label="Open navigation menu"
          className="tap-target md:hidden"
          onClick={onOpenNav}
          size="icon"
          variant="ghost"
        >
          <Menu />
        </Button>
        <p className="min-w-0 flex-1 truncate font-semibold text-sm md:max-w-56 md:flex-none">
          {facility.name}
        </p>
        <Can permission="scan.use">
          <div className="order-last w-full md:order-none md:max-w-sm md:flex-1">
            <GlobalScanField />
          </div>
        </Can>
        <div className="flex items-center gap-1.5 md:ml-auto">
          <GlobalActions />
          <Can permission="alerts.view">
            <NotificationBell />
          </Can>
          <Link
            aria-label="Help and documentation"
            className={cn(
              buttonVariants({ size: "icon", variant: "ghost" }),
              "tap-target"
            )}
            title="Help and documentation"
            to="/docs"
          >
            <CircleHelp aria-hidden />
          </Link>
          <div className="hidden items-center gap-1.5 lg:flex">
            <ThemeToggle />
            <DensityToggle />
          </div>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
