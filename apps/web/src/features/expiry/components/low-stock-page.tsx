import { Button } from "@cmis/ui/components/button";
import { PackageCheck } from "lucide-react";
import type { ReactElement } from "react";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { useCan } from "@/lib/auth/guards";

import {
  flattenRows,
  totalOf,
  useExpiryCategories,
  useLowStockList,
} from "../hooks/expiry-queries";
import { useLowStockFilters } from "../hooks/use-low-stock-filters";
import { LowStockFilters } from "./low-stock-filters";
import { LowStockList } from "./low-stock-list";

/** Items whose AVAILABLE (not expired) stock is below their threshold, most urgent first. */
export function LowStockPage(): ReactElement {
  const canEditThreshold = useCan("inventory.write");
  const filterState = useLowStockFilters();
  const { data: categories = [] } = useExpiryCategories();
  const list = useLowStockList(filterState.filters);
  const { openItemDetail } = useStockItemDetailDialog();
  const rows = flattenRows(list.data?.pages);
  const total = totalOf(list.data?.pages);

  return (
    <div>
      <PageHeader
        description="Products whose available stock (not expired) is below their low-stock threshold. Expired stock waiting for disposal does not count."
        title="Low stock"
      />
      <LowStockFilters categories={categories} state={filterState} />
      <p aria-live="polite" className="pb-2 text-muted-foreground text-xs">
        {list.isPending
          ? "Loading…"
          : `${total} ${total === 1 ? "item" : "items"}`}
      </p>
      <DataState
        empty={
          filterState.isFiltered
            ? {
                action: (
                  <Button onClick={filterState.reset} variant="outline">
                    Clear filters
                  </Button>
                ),
                title: "No items match",
              }
            : {
                description:
                  "Every product with a threshold has enough available stock.",
                icon: PackageCheck,
                title: "Nothing is running low",
              }
        }
        error={list.error}
        isEmpty={rows.length === 0}
        isLoading={list.isPending}
        onRetry={() => list.refetch()}
      >
        <LowStockList
          canEditThreshold={canEditThreshold}
          hasNextPage={list.hasNextPage}
          isFetchingNextPage={list.isFetchingNextPage}
          onLoadMore={() => list.fetchNextPage()}
          onOpen={(itemId) => openItemDetail(itemId)}
          rows={rows}
        />
      </DataState>
    </div>
  );
}
