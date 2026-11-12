import { cn } from "@cmis/ui/lib/utils";
import type { ExpiryClass } from "@shared/expiry";
import type { ExpirySummaryDto } from "@shared/schemas/expiry";
import type { ReactElement } from "react";

import { ExpiryBadge } from "@/components/expiry-badge";
import { formatQuantity } from "@/lib/format";

import { CLASS_DISPLAY_ORDER } from "../hooks/use-expiry-filters";

export interface ExpirySummaryTilesProps {
  /** Classes the list below is currently filtered to. */
  active: readonly ExpiryClass[];
  /** Pressing a tile filters the list to that class. */
  onSelect: (expiryClass: ExpiryClass) => void;
  summary: ExpirySummaryDto | undefined;
}

function isOnly(active: readonly ExpiryClass[], entry: ExpiryClass): boolean {
  return active.length === 1 && active[0] === entry;
}

function batchWord(count: number): string {
  return count === 1 ? "batch" : "batches";
}

/**
 * Urgent / Near Expiry / Expired / Safe counts. Each tile is a button that filters the list to its
 * class (pressed again, it restores the default view). The badge carries icon + text, so colour is
 * never the only signal.
 */
export function ExpirySummaryTiles({
  active,
  onSelect,
  summary,
}: ExpirySummaryTilesProps): ReactElement {
  return (
    <ul
      aria-label="Expiry summary"
      className="grid grid-cols-2 gap-2 pb-4 md:grid-cols-4"
    >
      {CLASS_DISPLAY_ORDER.map((entry) => {
        const count = summary?.counts[entry];
        const pressed = isOnly(active, entry);
        return (
          <li key={entry}>
            <button
              aria-pressed={pressed}
              className={cn(
                "grid w-full gap-1.5 rounded-lg border p-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                pressed && "border-ring bg-accent"
              )}
              onClick={() => onSelect(entry)}
              type="button"
            >
              <ExpiryBadge expiryClass={entry} />
              <span aria-hidden className="font-semibold text-2xl tabular-nums">
                {count ? count.batches : "—"}
              </span>
              <span className="text-muted-foreground text-xs">
                {count
                  ? `${count.batches} ${batchWord(count.batches)} · ${formatQuantity(count.units, "unit")}`
                  : "Loading…"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
