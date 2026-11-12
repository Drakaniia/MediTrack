import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@cmis/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Keyboard, Package, PackageMinus, Plus } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react";

import { NAV_ITEMS, type NavItem } from "@/app/nav-config";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { useNewRequestDialog } from "@/features/requests/new-request-dialog-context";
import { useQuickDeductDialog } from "@/features/requests/quick-deduct-dialog-context";
import { apiGet } from "@/lib/api/client";
import { useCan, usePermissions } from "@/lib/auth/guards";
import { formatHotkey, useHotkey } from "@/lib/hotkeys";

const PALETTE_COMBO = "mod+k";
const SHORTCUTS_COMBO = "shift+/";
const MIN_ITEM_QUERY = 2;
const ITEM_RESULT_LIMIT = 8;

function matches(label: string, query: string): boolean {
  return query === "" || label.toLowerCase().includes(query);
}

function usePaletteItems(search: string, enabled: boolean) {
  return useQuery({
    enabled: enabled && search.length >= MIN_ITEM_QUERY,
    queryFn: ({ signal }) =>
      apiGet<ItemSummaryDto[]>(
        "/items",
        { limit: ITEM_RESULT_LIMIT, search },
        { signal }
      ),
    queryKey: ["inventory", "palette", search] as const,
    staleTime: 30_000,
  });
}

/**
 * Ctrl+K: jump to any page the role may open, search items (opens the item detail),
 * and run the global actions. Also owns the `?` shortcuts dialog. cmdk's own filter is
 * off because item results are already filtered (and ranked) by the server.
 */
export function CommandPalette(): ReactElement {
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const permissions = usePermissions();
  const canViewItems = useCan("inventory.view");
  const canRequest = useCan("requests.create");
  const canDeduct = useCan("stock.quick_deduct");
  const { openItemDetail } = useStockItemDetailDialog();
  const { openNewRequest } = useNewRequestDialog();
  const { openQuickDeduct } = useQuickDeductDialog();

  const normalized = useDeferredValue(query.trim().toLowerCase());
  const items = usePaletteItems(normalized, open && canViewItems);

  const togglePalette = useCallback(() => setOpen((value) => !value), []);
  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useHotkey(PALETTE_COMBO, togglePalette, { allowInInput: true });
  useHotkey(SHORTCUTS_COMBO, showShortcuts);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
    }
  }, []);

  const run = useCallback(
    (action: () => void) => {
      handleOpenChange(false);
      // Let the palette release focus before the next dialog captures it.
      requestAnimationFrame(action);
    },
    [handleOpenChange]
  );

  const pages = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item: NavItem) =>
          (item.permission === "authenticated" ||
            permissions.includes(item.permission)) &&
          matches(item.label, normalized)
      ),
    [normalized, permissions]
  );

  const actions = [
    {
      combo: "mod+n",
      icon: Plus,
      id: "new-request",
      label: "New request",
      onSelect: () => run(() => openNewRequest()),
      visible: canRequest,
    },
    {
      combo: "mod+d",
      icon: PackageMinus,
      id: "quick-deduct",
      label: "Quick deduct",
      onSelect: () => run(() => openQuickDeduct()),
      visible: canDeduct,
    },
    {
      combo: SHORTCUTS_COMBO,
      icon: Keyboard,
      id: "shortcuts",
      label: "Keyboard shortcuts",
      onSelect: () => run(showShortcuts),
      visible: true,
    },
  ].filter((action) => action.visible && matches(action.label, normalized));

  const itemResults = normalized.length >= MIN_ITEM_QUERY ? items.data : [];

  return (
    <>
      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent
          className="top-1/4 translate-y-0 overflow-hidden p-0 sm:max-w-lg"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <DialogDescription className="sr-only">
            Search pages, items and actions
          </DialogDescription>
          <Command shouldFilter={false}>
        <CommandInput
          aria-label="Search pages, items and actions"
          onValueChange={setQuery}
          placeholder="Search pages, items and actions…"
          value={query}
        />
        <CommandList>
          <CommandEmpty>
            {items.isFetching ? "Searching…" : "No results found."}
          </CommandEmpty>
          {itemResults && itemResults.length > 0 ? (
            <CommandGroup heading="Items">
              {itemResults.map((item) => (
                <CommandItem
                  key={item.id}
                  onSelect={() => run(() => openItemDetail(item.id))}
                  value={`item:${item.id}`}
                >
                  <Package aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {item.displayName}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {item.available} {item.unit}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {actions.length > 0 ? (
            <CommandGroup heading="Actions">
              {actions.map((action) => (
                <CommandItem
                  key={action.id}
                  onSelect={action.onSelect}
                  value={`action:${action.id}`}
                >
                  <action.icon aria-hidden />
                  <span>{action.label}</span>
                  <CommandShortcut>{formatHotkey(action.combo)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {pages.length > 0 ? (
            <CommandGroup heading="Pages">
              {pages.map((page) => (
                <CommandItem
                  key={page.to}
                  onSelect={() => run(() => navigate({ to: page.to }))}
                  value={`page:${page.to}`}
                >
                  <page.icon aria-hidden />
                  <span>{page.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
      <ShortcutsDialog onOpenChange={setShortcutsOpen} open={shortcutsOpen} />
    </>
  );
}
