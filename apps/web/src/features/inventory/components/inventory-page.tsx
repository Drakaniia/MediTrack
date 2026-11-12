import { Button, buttonVariants } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { Link } from "@tanstack/react-router";
import { PackagePlus, Tags, Zap } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/components/can";
import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { errorMessage } from "@/lib/api/errors";
import { useCan } from "@/lib/auth/guards";
import { useDeleteItem } from "../hooks/inventory-mutations";
import {
  DEFAULT_ITEM_FILTERS,
  flattenItemPages,
  type ItemFilters,
  useCategories,
  useItemList,
} from "../hooks/inventory-queries";
import { useStockItemDetailDialog } from "../stock-item-detail-dialog-context";
import { CategoryDialog } from "./category-dialog";
import { InventoryFilters } from "./inventory-filters";
import { InventoryList } from "./inventory-list";

const SEARCH_DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function DeleteSelectionDialog({
  count,
  onCancel,
  onConfirm,
  pending,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}): ReactElement {
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onCancel())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Move {count} {count === 1 ? "item" : "items"} to the Trash?
          </DialogTitle>
          <DialogDescription>
            Their batches go with them. An administrator can restore them from
            the Trash later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm} variant="destructive">
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SelectionToolbar({
  count,
  onClear,
  onDelete,
}: {
  count: number;
  onClear: () => void;
  onDelete: () => void;
}): ReactElement {
  return (
    <div
      aria-live="polite"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted px-3 py-2"
    >
      <span className="text-sm">{count} selected</span>
      <Button onClick={onDelete} size="sm" variant="destructive">
        Delete selected
      </Button>
      <Button onClick={onClear} size="sm" variant="ghost">
        Clear selection
      </Button>
    </div>
  );
}

export function InventoryPage(): ReactElement {
  const [filters, setFilters] = useState<ItemFilters>(DEFAULT_ITEM_FILTERS);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const activeFilters = { ...filters, search: debouncedSearch };

  const canDelete = useCan("inventory.delete");
  const { openItemDetail } = useStockItemDetailDialog();
  const query = useItemList(activeFilters);
  const { data: categories = [] } = useCategories();
  const remove = useDeleteItem();
  const items = flattenItemPages(query.data?.pages);
  const total = query.data?.pages[0]?.total ?? 0;
  const filtered =
    debouncedSearch !== "" ||
    filters.categoryId !== "" ||
    filters.status.length > 0 ||
    filters.stock.length > 0;

  const toggle = useCallback((itemId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(itemId)) {
        next.add(itemId);
      }
      return next;
    });
  }, []);
  const loadMore = useCallback(() => {
    query.fetchNextPage();
  }, [query]);

  const deleteSelected = async () => {
    const ids = [...selected];
    const results = await Promise.allSettled(
      ids.map((id) => remove.mutateAsync(id))
    );
    const failed = results.filter((result) => result.status === "rejected");
    setConfirming(false);
    setSelected(new Set());
    if (failed.length > 0) {
      const [first] = failed;
      toast.error(
        errorMessage(first.reason, "Some items could not be deleted.")
      );
      return;
    }
    toast.success(`Moved ${ids.length} item(s) to the Trash.`);
  };

  return (
    <div>
      <PageHeader
        actions={
          <>
            <Can permission="inventory.write">
              <Button onClick={() => setCategoriesOpen(true)} variant="outline">
                <Tags aria-hidden data-icon="inline-start" />
                Categories
              </Button>
            </Can>
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/inventory/fefo"
            >
              <Zap aria-hidden data-icon="inline-start" />
              Use first
            </Link>
            <Can permission="inventory.write">
              <Link className={buttonVariants()} to="/inventory/add">
                <PackagePlus aria-hidden data-icon="inline-start" />
                Add stock
              </Link>
            </Can>
          </>
        }
        description={
          query.data ? `${total} ${total === 1 ? "item" : "items"}` : undefined
        }
        title="Inventory"
      />
      <InventoryFilters
        categories={categories}
        filters={filters}
        onChange={setFilters}
        onSearchChange={setSearch}
        search={search}
      />
      {canDelete && selected.size > 0 ? (
        <SelectionToolbar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onDelete={() => setConfirming(true)}
        />
      ) : null}
      <DataState
        empty={
          filtered
            ? {
                description: "Try a different search or clear the filters.",
                title: "No items match",
              }
            : {
                action: (
                  <Can permission="inventory.write">
                    <Link className={buttonVariants()} to="/inventory/add">
                      Add your first stock
                    </Link>
                  </Can>
                ),
                description: "Items you add will be listed here.",
                title: "No inventory yet",
              }
        }
        error={query.error}
        isEmpty={items.length === 0}
        isLoading={query.isPending}
        onRetry={() => query.refetch()}
      >
        <InventoryList
          canSelect={canDelete}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          items={items}
          onLoadMore={loadMore}
          onOpen={openItemDetail}
          onToggle={toggle}
          selected={selected}
        />
      </DataState>
      {confirming ? (
        <DeleteSelectionDialog
          count={selected.size}
          onCancel={() => setConfirming(false)}
          onConfirm={deleteSelected}
          pending={remove.isPending}
        />
      ) : null}
      <CategoryDialog onOpenChange={setCategoriesOpen} open={categoriesOpen} />
    </div>
  );
}
