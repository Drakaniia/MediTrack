import type { ExpiringThisMonthDto } from "@shared/schemas/dashboard";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { ExpiryBadge } from "@/components/expiry-badge";
import { useStockItemDetailDialog } from "@/features/inventory/stock-item-detail-dialog-context";
import { formatDate, formatQuantity } from "@/lib/format";

import { formatMonthLabel } from "../lib/months";
import {
  CARD_LINK_CLASS,
  CardEmpty,
  DashboardCard,
  ROW_CLASS,
} from "./dashboard-card";

export interface ExpiringCardProps {
  data: ExpiringThisMonthDto;
}

function summaryOf(data: ExpiringThisMonthDto): string {
  const batches = `${data.batches} ${data.batches === 1 ? "batch" : "batches"}`;
  return `${batches} · ${formatQuantity(data.units, "unit")} still in stock`;
}

/** Batches holding stock that expire in the selected month (month + year only). */
export function ExpiringCard({ data }: ExpiringCardProps): ReactElement {
  const { openItemDetail } = useStockItemDetailDialog();
  const label = formatMonthLabel(data.month);
  return (
    <DashboardCard
      action={
        <Link className={CARD_LINK_CLASS} to="/inventory/expiry">
          Open expiry alerts
        </Link>
      }
      description={data.batches === 0 ? undefined : summaryOf(data)}
      title={`Expiring in ${label}`}
    >
      {data.items.length === 0 ? (
        <CardEmpty>No batches with stock expire in {label}.</CardEmpty>
      ) : (
        <ul aria-label={`Batches expiring in ${label}`} className="grid gap-0.5">
          {data.items.map((row) => (
            <li key={row.batchId}>
              <button
                aria-label={`${row.itemName}, batch ${row.batchNumber}`}
                className={ROW_CLASS}
                onClick={() => openItemDetail(row.itemId, { batchId: row.batchId })}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-sm">
                    {row.itemName}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    Batch {row.batchNumber} · {formatQuantity(row.qty, row.unit)}{" "}
                    · {formatDate(row.expiry)}
                  </span>
                </span>
                <ExpiryBadge
                  daysUntil={row.daysUntil}
                  expiryClass={row.expiryClass}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.batches > data.items.length ? (
        <p className="text-muted-foreground text-xs">
          and {data.batches - data.items.length} more
        </p>
      ) : null}
    </DashboardCard>
  );
}
