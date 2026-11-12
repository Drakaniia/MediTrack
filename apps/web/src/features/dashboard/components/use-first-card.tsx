import type { FefoEntryDto } from "@shared/schemas/inventory";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { ExpiryBadge } from "@/components/expiry-badge";
import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { formatDate, formatQuantity } from "@/lib/format";

import {
  CARD_LINK_CLASS,
  CardEmpty,
  DashboardCard,
  ROW_CLASS,
} from "./dashboard-card";

export interface UseFirstCardProps {
  entries: readonly FefoEntryDto[];
}

/** "Use first (FEFO)": the next batch to pull for each item, earliest expiry first. */
export function UseFirstCard({ entries }: UseFirstCardProps): ReactElement {
  const { openItemDetail } = useStockItemDetailDialog();
  return (
    <DashboardCard
      action={
        <Link className={CARD_LINK_CLASS} to="/inventory/fefo">
          View full list
        </Link>
      }
      description="The batch to pull next for each item."
      title="Use first (FEFO)"
    >
      {entries.length === 0 ? (
        <CardEmpty>No usable stock to recommend.</CardEmpty>
      ) : (
        <ul aria-label="Use first" className="grid gap-0.5">
          {entries.map(({ batch, item }) => (
            <li key={batch.id}>
              <button
                aria-label={`${item.displayName}, batch ${batch.batchNumber}`}
                className={ROW_CLASS}
                onClick={() => openItemDetail(item.id, { batchId: batch.id })}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-sm">
                    {item.displayName}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    Batch {batch.batchNumber} ·{" "}
                    {formatQuantity(batch.qty, item.unit)} ·{" "}
                    {formatDate(batch.expiry)}
                  </span>
                </span>
                <ExpiryBadge
                  daysUntil={batch.daysUntil}
                  expiryClass={batch.expiryClass}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
