import { EXPIRY_CLASSES } from "@shared/expiry";
import type { DashboardTotalsDto } from "@shared/schemas/dashboard";
import { Link } from "@tanstack/react-router";
import { PackageMinus } from "lucide-react";
import type { ReactElement } from "react";

import { ExpiryBadge } from "@/components/expiry-badge";
import { formatQuantity } from "@/lib/format";

const TILE_CLASS =
  "grid h-full content-start gap-1.5 rounded-lg border p-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

function batchWord(count: number): string {
  return count === 1 ? "batch" : "batches";
}

export interface StatCardsProps {
  totals: DashboardTotalsDto;
}

/**
 * Safe / Near Expiry / Urgent / Expired batch counts and the low-stock count. Each tile is a
 * link into the matching list; the badge carries icon + text, so colour is never the only cue.
 */
export function StatCards({ totals }: StatCardsProps): ReactElement {
  return (
    <ul
      aria-label="Stock summary"
      className="grid grid-cols-2 gap-2 pb-4 md:grid-cols-3 xl:grid-cols-5"
    >
      {EXPIRY_CLASSES.map((expiryClass) => {
        const count = totals.classes[expiryClass];
        return (
          <li key={expiryClass}>
            <Link
              className={TILE_CLASS}
              search={{ class: expiryClass } as Record<string, string>}
              to="/inventory/expiry"
            >
              <ExpiryBadge expiryClass={expiryClass} />
              <span className="font-semibold text-2xl tabular-nums">
                {count.batches}
              </span>
              <span className="text-muted-foreground text-xs">
                {batchWord(count.batches)} ·{" "}
                {formatQuantity(count.units, "unit")}
              </span>
            </Link>
          </li>
        );
      })}
      <li>
        <Link className={TILE_CLASS} to="/inventory/low-stock">
          <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full bg-expiry-near/15 px-2 py-0.5 font-medium text-expiry-near text-xs">
            <PackageMinus aria-hidden className="size-3.5 shrink-0" />
            Low stock
          </span>
          <span className="font-semibold text-2xl tabular-nums">
            {totals.lowStockCount}
          </span>
          <span className="text-muted-foreground text-xs">
            {totals.lowStockCount === 1 ? "item" : "items"} ·{" "}
            {totals.outOfStockCount} out of stock
          </span>
        </Link>
      </li>
    </ul>
  );
}
