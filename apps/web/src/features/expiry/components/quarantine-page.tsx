import { Button } from "@cmis/ui/components/button";
import type { QuarantineRowDto } from "@shared/schemas/expiry";
import { ShieldCheck } from "lucide-react";
import { type ReactElement, useState } from "react";

import { DataState } from "@/components/data-state";
import { ExpiryBadge } from "@/components/expiry-badge";
import { PageHeader } from "@/components/page-header";
import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { useCan } from "@/lib/auth/guards";
import { formatDate, formatQuantity } from "@/lib/format";

import { flattenRows, totalOf, useQuarantine } from "../hooks/expiry-queries";
import { DisposalsLog } from "./disposals-log";
import { DisposeDialog } from "./dispose-dialog";

function QuarantineRow({
  onDispose,
  onOpen,
  row,
}: {
  onDispose: (row: QuarantineRowDto) => void;
  onOpen: (row: QuarantineRowDto) => void;
  row: QuarantineRowDto;
}): ReactElement {
  return (
    <li className="flex flex-wrap items-stretch gap-x-2 gap-y-1 border-b px-2 py-1.5 last:border-b-0">
      <button
        aria-label={`Open ${row.displayName}, batch ${row.batchNumber}`}
        className="grid min-w-0 flex-1 basis-72 gap-x-4 gap-y-1 rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)]"
        onClick={() => onOpen(row)}
        type="button"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-sm">
            {row.displayName}
          </span>
          <span className="block truncate text-muted-foreground text-xs">
            {row.categoryName ?? "Uncategorised"}
          </span>
        </span>
        <span className="text-sm">
          <span className="block">Batch {row.batchNumber}</span>
          <span className="block text-muted-foreground text-xs">
            {formatQuantity(row.qty, row.unit)}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {formatDate(row.expiry)}
          <ExpiryBadge daysUntil={-row.daysOverdue} expiryClass="expired" />
        </span>
      </button>
      {row.canDispose ? (
        <div className="flex items-center px-2">
          <Button
            aria-label={`Dispose batch ${row.batchNumber} of ${row.displayName}`}
            onClick={() => onDispose(row)}
            size="sm"
            variant="destructive"
          >
            Dispose / write off
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Quarantine: expired batches still on the shelf, oldest first. They can no longer be dispensed
 * (FEFO skips them); this is where they are written off. Read-only for roles without
 * `stock.dispose`; the disposals log needs `reports.view`.
 */
export function QuarantinePage(): ReactElement {
  const canSeeLog = useCan("reports.view");
  const query = useQuarantine();
  const { openItemDetail } = useStockItemDetailDialog();
  const [target, setTarget] = useState<QuarantineRowDto | null>(null);
  const rows = flattenRows(query.data?.pages);
  const total = totalOf(query.data?.pages);

  return (
    <div>
      <PageHeader
        description="Expired stock that is still on the shelf. It cannot be dispensed; write it off once it has been removed."
        title="Quarantine"
      />
      <p aria-live="polite" className="pb-2 text-muted-foreground text-xs">
        {query.isPending
          ? "Loading…"
          : `${total} ${total === 1 ? "batch" : "batches"} awaiting disposal`}
      </p>
      <DataState
        empty={{
          description: "No expired stock is waiting to be written off.",
          icon: ShieldCheck,
          title: "Nothing in quarantine",
        }}
        error={query.error}
        isEmpty={rows.length === 0}
        isLoading={query.isPending}
        onRetry={() => query.refetch()}
      >
        <ul
          aria-label="Expired batches awaiting disposal"
          className="rounded-lg border"
        >
          {rows.map((row) => (
            <QuarantineRow
              key={row.batchId}
              onDispose={setTarget}
              onOpen={(entry) =>
                openItemDetail(entry.itemId, { batchId: entry.batchId })
              }
              row={row}
            />
          ))}
        </ul>
        {query.hasNextPage ? (
          <Button
            className="mt-2"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
            variant="outline"
          >
            Show more
          </Button>
        ) : null}
      </DataState>
      {canSeeLog ? <DisposalsLog /> : null}
      {target ? (
        <DisposeDialog batch={target} onClose={() => setTarget(null)} />
      ) : null}
    </div>
  );
}
