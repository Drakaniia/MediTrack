import { Checkbox } from "@cmis/ui/components/checkbox";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactElement, useEffect, useRef } from "react";

import { ExpiryBadge } from "@/components/expiry-badge";
import { formatDate, formatQuantity } from "@/lib/format";

import { LowStockChip } from "./stock-chip";

const ROW_ESTIMATE_PX = 76;
const LOAD_MORE_MARGIN = 10;
const OVERSCAN = 8;

export interface InventoryListProps {
  canSelect: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  items: readonly ItemSummaryDto[];
  onLoadMore: () => void;
  onOpen: (itemId: string) => void;
  onToggle: (itemId: string) => void;
  selected: ReadonlySet<string>;
}

interface RowProps {
  canSelect: boolean;
  checked: boolean;
  item: ItemSummaryDto;
  onOpen: (itemId: string) => void;
  onToggle: (itemId: string) => void;
}

function ItemRow({
  canSelect,
  checked,
  item,
  onOpen,
  onToggle,
}: RowProps): ReactElement {
  return (
    <div className="flex items-stretch gap-2 border-b px-2 py-1.5">
      {canSelect ? (
        <div className="flex items-center px-1">
          <Checkbox
            aria-label={`Select ${item.displayName}`}
            checked={checked}
            onCheckedChange={() => onToggle(item.id)}
          />
        </div>
      ) : null}
      <button
        className="grid min-w-0 flex-1 gap-x-4 gap-y-1 rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]"
        onClick={() => onOpen(item.id)}
        type="button"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-sm">
            {item.displayName}
          </span>
          <span className="block truncate text-muted-foreground text-xs">
            {item.categoryName ?? "Uncategorised"}
            {item.sku ? ` · ${item.sku}` : ""}
          </span>
        </span>
        <span className="text-sm">
          <span className="block">
            {formatQuantity(item.onHand, item.unit)}
          </span>
          {item.available === item.onHand ? null : (
            <span className="block text-muted-foreground text-xs">
              {item.available} available
            </span>
          )}
        </span>
        <span className="text-muted-foreground text-sm">
          {item.nearestExpiry
            ? formatDate(item.nearestExpiry)
            : "No dated stock"}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <ExpiryBadge expiryClass={item.worstClass} />
          <LowStockChip status={item.lowStock} />
        </span>
      </button>
    </div>
  );
}

/**
 * Virtualised item list. A `<ul>` of rows (not an ARIA table): each row is one button that opens
 * the item, so keyboard and screen-reader behaviour is the browser's own. Pages load as the
 * user nears the end (`onLoadMore`).
 */
export function InventoryList({
  canSelect,
  hasNextPage,
  isFetchingNextPage,
  items,
  onLoadMore,
  onOpen,
  onToggle,
  selected,
}: InventoryListProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
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
      lastIndex >= items.length - LOAD_MORE_MARGIN
    ) {
      onLoadMore();
    }
  }, [hasNextPage, isFetchingNextPage, items.length, lastIndex, onLoadMore]);

  return (
    <div
      className="max-h-[70dvh] min-h-64 overflow-auto rounded-lg border"
      ref={scrollRef}
    >
      <ul
        aria-label="Inventory items"
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtual) => {
          const item = items[virtual.index];
          return (
            <li
              className="absolute inset-x-0 top-0"
              data-index={virtual.index}
              key={item.id}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${virtual.start}px)` }}
            >
              <ItemRow
                canSelect={canSelect}
                checked={selected.has(item.id)}
                item={item}
                onOpen={onOpen}
                onToggle={onToggle}
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
