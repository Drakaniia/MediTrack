import { Skeleton } from "@cmis/ui/components/skeleton";
import type { ReactElement } from "react";

const TILE_KEYS = ["safe", "near", "urgent", "expired", "low"] as const;
const CARD_KEYS = ["first", "second"] as const;
const ROW_KEYS = ["a", "b", "c", "d"] as const;

/** Placeholder with the dashboard's own layout: five stat tiles and two cards of rows. */
export function DashboardSkeleton(): ReactElement {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {TILE_KEYS.map((key) => (
          <Skeleton className="h-24 w-full rounded-lg" key={key} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {CARD_KEYS.map((card) => (
          <div className="grid gap-3 rounded-lg border p-4" key={card}>
            <Skeleton className="h-4 w-40" />
            {ROW_KEYS.map((row) => (
              <Skeleton className="h-10 w-full" key={row} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
