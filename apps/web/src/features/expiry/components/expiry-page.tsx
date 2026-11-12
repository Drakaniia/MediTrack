import { Button } from "@cmis/ui/components/button";
import type { ExpiryRowDto } from "@shared/schemas/expiry";
import { CircleCheck } from "lucide-react";
import { type ReactElement, useState } from "react";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { useCan, useFacility } from "@/lib/auth/guards";

import {
  flattenRows,
  totalOf,
  useExpiryCategories,
  useExpiryList,
  useExpirySummary,
} from "../hooks/expiry-queries";
import { useExpiryFilters } from "../hooks/use-expiry-filters";
import { AdjustStockDialog } from "./adjust-stock-dialog";
import { DisposeDialog } from "./dispose-dialog";
import { ExpiryFilters } from "./expiry-filters";
import { ExpiryList } from "./expiry-list";
import { ExpirySummaryTiles } from "./expiry-summary-tiles";

type OpenDialog =
  | { kind: "adjust"; row: ExpiryRowDto }
  | { kind: "dispose"; row: ExpiryRowDto };

function daysText(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Expiry Alerts: what expires when, worst first. Reads the facility thresholds from settings. */
export function ExpiryPage(): ReactElement {
  const { nearDays, urgentDays } = useFacility();
  const canAdjust = useCan("stock.adjust");
  const canDispose = useCan("stock.dispose");
  const filterState = useExpiryFilters();
  const { data: categories = [] } = useExpiryCategories();
  const summary = useExpirySummary();
  const list = useExpiryList(filterState.filters);
  const { openItemDetail } = useStockItemDetailDialog();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const rows = flattenRows(list.data?.pages);
  const total = totalOf(list.data?.pages);

  return (
    <div>
      <PageHeader
        description={`Batches holding stock, soonest expiry first. Urgent ≤ ${daysText(urgentDays)}, Near Expiry ≤ ${daysText(nearDays)} (set in Settings).`}
        title="Expiry alerts"
      />
      <ExpirySummaryTiles
        active={filterState.filters.classes}
        onSelect={filterState.selectOnly}
        summary={summary.data}
      />
      <ExpiryFilters categories={categories} state={filterState} />
      <p aria-live="polite" className="pb-2 text-muted-foreground text-xs">
        {list.isPending
          ? "Loading…"
          : `${total} ${total === 1 ? "batch" : "batches"}`}
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
                description: "Try a different class, category or date range.",
                title: "No batches match",
              }
            : {
                description: "No stock is urgent, near expiry or expired.",
                icon: CircleCheck,
                title: "Nothing needs attention",
              }
        }
        error={list.error}
        isEmpty={rows.length === 0}
        isLoading={list.isPending}
        onRetry={() => list.refetch()}
      >
        <ExpiryList
          canAdjust={canAdjust}
          canDispose={canDispose}
          hasNextPage={list.hasNextPage}
          isFetchingNextPage={list.isFetchingNextPage}
          onAdjust={(row) => setDialog({ kind: "adjust", row })}
          onDispose={(row) => setDialog({ kind: "dispose", row })}
          onLoadMore={() => list.fetchNextPage()}
          onOpen={(itemId, batchId) => openItemDetail(itemId, { batchId })}
          rows={rows}
        />
      </DataState>
      {dialog?.kind === "dispose" ? (
        <DisposeDialog batch={dialog.row} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "adjust" ? (
        <AdjustStockDialog batch={dialog.row} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
