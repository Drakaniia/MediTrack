import { Button } from "@cmis/ui/components/button";
import type { ExpiryRowDto } from "@shared/schemas/expiry";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactElement, useEffect, useRef } from "react";

import { ExpiryBadge } from "@/components/expiry-badge";
import { formatDate, formatQuantity } from "@/lib/format";

const ROW_ESTIMATE_PX = 84;
const LOAD_MORE_MARGIN = 10;
const OVERSCAN = 8;

export interface ExpiryListProps {
  /** Show "Adjust" on rows that can still be adjusted (`stock.adjust`). */
  canAdjust: boolean;
  /** Show "Dispose" on expired rows (`stock.dispose`). */
  canDispose: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onAdjust: (row: ExpiryRowDto) => void;
  onDispose: (row: ExpiryRowDto) => void;
  onLoadMore: () => void;
  onOpen: (itemId: string, batchId: string) => void;
  rows: readonly ExpiryRowDto[];
}

interface RowProps {
  canAdjust: boolean;
  canDispose: boolean;
  onAdjust: (row: ExpiryRowDto) => void;
  onDispose: (row: ExpiryRowDto) => void;
  onOpen: (itemId: string, batchId: string) => void;
  row: ExpiryRowDto;
}

function RowActions({
  canAdjust,
  canDispose,
  onAdjust,
  onDispose,
  row,
}: Omit<RowProps, "onOpen">): ReactElement | null {
  const showDispose = canDispose && row.quarantined;
  // Expired stock can only be disposed of; the API refuses to adjust it.
  const showAdjust = canAdjust && !row.quarantined;
  if (!(showDispose || showAdjust)) {
    return null;
  }
  return (
    <div className="flex items-center gap-1.5 px-2">
      {showAdjust ? (
        <Button
          aria-label={`Adjust batch ${row.batchNumber} of ${row.displayName}`}
          onClick={() => onAdjust(row)}
          size="sm"
          variant="outline"
        >
          Adjust
        </Button>
      ) : null}
      {showDispose ? (
        <Button
          aria-label={`Dispose batch ${row.batchNumber} of ${row.displayName}`}
          onClick={() => onDispose(row)}
          size="sm"
          variant="destructive"
        >
          Dispose
        </Button>
      ) : null}
    </div>
  );
}

function ExpiryRow(props: RowProps): ReactElement {
  const { onOpen, row } = props;
  return (
    <div className="flex flex-wrap items-stretch gap-x-2 gap-y-1 border-b px-2 py-1.5">
      <button
        aria-label={`Open ${row.displayName}, batch ${row.batchNumber}`}
        className="grid min-w-0 flex-1 basis-72 gap-x-4 gap-y-1 rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)]"
        onClick={() => onOpen(row.itemId, row.batchId)}
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
            {row.fefoRank === 1 ? " · use first" : ""}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {row.expiry ? formatDate(row.expiry) : "No expiry"}
          <ExpiryBadge
            daysUntil={row.daysUntil}
            expiryClass={row.expiryClass}
          />
        </span>
      </button>
      <RowActions {...props} />
    </div>
  );
}

/**
 * Virtualised list of batches holding stock. A `<ul>` of rows (not an ARIA table): the main area of
 * a row is one button that opens the item, the actions are real sibling buttons. Pages load as the
 * user nears the end.
 */
export function ExpiryList({
  canAdjust,
  canDispose,
  hasNextPage,
  isFetchingNextPage,
  onAdjust,
  onDispose,
  onLoadMore,
  onOpen,
  rows,
}: ExpiryListProps): ReactElement {
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
        aria-label="Batches by expiry"
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtual) => {
          const row = rows[virtual.index];
          return (
            <li
              className="absolute inset-x-0 top-0"
              data-index={virtual.index}
              key={row.batchId}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtual.start}px)` }}
            >
              <ExpiryRow
                canAdjust={canAdjust}
                canDispose={canDispose}
                onAdjust={onAdjust}
                onDispose={onDispose}
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
