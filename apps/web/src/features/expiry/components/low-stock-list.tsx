import { cn } from "@cmis/ui/lib/utils";
import { gapPercent } from "@shared/low-stock";
import type { LowStockRowDto } from "@shared/schemas/expiry";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactElement, useEffect, useRef } from "react";

import { formatDate, formatQuantity } from "@/lib/format";

import { LowStockStatusChip } from "./low-stock-status-chip";
import { ThresholdPopover } from "./threshold-popover";

const ROW_ESTIMATE_PX = 96;
const LOAD_MORE_MARGIN = 10;
const OVERSCAN = 8;

export interface LowStockListProps {
  /** Show the inline threshold editor (`inventory.write`). */
  canEditThreshold: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onOpen: (itemId: string) => void;
  rows: readonly LowStockRowDto[];
}

/** How full the shelf is relative to the threshold. Text beside it says the same in words. */
function GapBar({ row }: { row: LowStockRowDto }): ReactElement {
  const percent = gapPercent({
    available: row.available,
    threshold: row.lowStockThreshold,
  });
  return (
    <div
      aria-label={`${row.displayName}: ${row.available} of ${row.lowStockThreshold} available`}
      aria-valuemax={row.lowStockThreshold}
      aria-valuemin={0}
      aria-valuenow={row.available}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
    >
      <div
        className={cn(
          "h-full rounded-full",
          row.status === "out" ? "bg-expiry-expired" : "bg-expiry-near"
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function RowDetails({ row }: { row: LowStockRowDto }): ReactElement {
  const expiredUnits = row.onHand - row.available;
  return (
    <span className="grid min-w-0 gap-1 text-sm">
      <GapBar row={row} />
      <span>
        {row.available} of {row.lowStockThreshold} available
        <span className="text-muted-foreground">
          {" "}
          · short by {formatQuantity(row.gap, row.unit)}
        </span>
      </span>
      <span className="text-muted-foreground text-xs">
        Reorder about {formatQuantity(row.suggestedReorderQty, row.unit)}
        {row.nearestExpiry
          ? ` · next expiry ${formatDate(row.nearestExpiry)}`
          : ""}
        {expiredUnits > 0
          ? ` · ${expiredUnits} more expired, awaiting disposal`
          : ""}
      </span>
    </span>
  );
}

function LowStockRow({
  canEditThreshold,
  onOpen,
  row,
}: {
  canEditThreshold: boolean;
  onOpen: (itemId: string) => void;
  row: LowStockRowDto;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-stretch gap-x-2 gap-y-1 border-b px-2 py-1.5">
      <button
        aria-label={`Open ${row.displayName}`}
        className="grid min-w-0 flex-1 basis-72 gap-x-4 gap-y-1 rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring md:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto]"
        onClick={() => onOpen(row.itemId)}
        type="button"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-sm">
            {row.displayName}
          </span>
          <span className="block truncate text-muted-foreground text-xs">
            {row.categoryName ?? "Uncategorised"}
            {row.supplier ? ` · ${row.supplier}` : ""}
          </span>
        </span>
        <RowDetails row={row} />
        <span className="flex items-start">
          <LowStockStatusChip status={row.status} />
        </span>
      </button>
      {canEditThreshold ? (
        <div className="flex items-center px-2">
          <ThresholdPopover
            displayName={row.displayName}
            itemId={row.itemId}
            threshold={row.lowStockThreshold}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Virtualised list of items below their threshold; the row opens the item, the popover edits the threshold. */
export function LowStockList({
  canEditThreshold,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onOpen,
  rows,
}: LowStockListProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_ESTIMATE_PX,
    getScrollElement: () => scrollRef.current,
    overscan: OVERSCAN,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;

  useEffect(() => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      lastIndex >= rows.length - LOAD_MORE_MARGIN
    ) {
      onLoadMore();
    }
  }, [hasNextPage, isFetchingNextPage, rows.length, lastIndex, onLoadMore]);

  return (
    <div
      className="max-h-[70dvh] min-h-64 overflow-auto rounded-lg border"
      ref={scrollRef}
    >
      <ul
        aria-label="Low-stock items"
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtual) => {
          const row = rows[virtual.index];
          return (
            <li
              className="absolute inset-x-0 top-0"
              data-index={virtual.index}
              key={row.itemId}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtual.start}px)` }}
            >
              <LowStockRow
                canEditThreshold={canEditThreshold}
                onOpen={onOpen}
                row={row}
              />
            </li>
          );
        })}
      </ul>
      {isFetchingNextPage ? (
        <p
          className="p-2 text-center text-muted-foreground text-xs"
          role="status"
        >
          Loading more…
        </p>
      ) : null}
    </div>
  );
}
