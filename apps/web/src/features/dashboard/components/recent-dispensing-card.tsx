import type { RecentDispensingDto } from "@shared/schemas/dashboard";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { useFacility } from "@/lib/auth/guards";
import { formatDateTime, formatQuantity } from "@/lib/format";

import { CARD_LINK_CLASS, CardEmpty, DashboardCard } from "./dashboard-card";

export interface RecentDispensingCardProps {
  records: readonly RecentDispensingDto[];
}

function batchesText(record: RecentDispensingDto): string {
  if (record.batches.length === 0) {
    return "No batch recorded";
  }
  return record.batches
    .map((batch) => `${batch.batchNumber} × ${batch.qty}`)
    .join(", ");
}

/** The latest hand-overs (undone ones are left out). Not shown to roles without the dispensing log. */
export function RecentDispensingCard({
  records,
}: RecentDispensingCardProps): ReactElement {
  const { timezone } = useFacility();
  return (
    <DashboardCard
      action={
        <Link className={CARD_LINK_CLASS} to="/dispensing">
          Open dispensing log
        </Link>
      }
      title="Recent dispensing"
    >
      {records.length === 0 ? (
        <CardEmpty>Nothing has been dispensed yet.</CardEmpty>
      ) : (
        <ul aria-label="Recent dispensing" className="grid gap-1">
          {records.map((record) => (
            <li
              className="flex items-center justify-between gap-3 px-2 py-1"
              key={record.id}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-sm">
                  {formatQuantity(record.qty, record.unit)} · {record.itemName}
                </span>
                <span className="block truncate text-muted-foreground text-xs">
                  {batchesText(record)}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs">
                <span className="block">{record.dispensedByName}</span>
                <span className="block text-muted-foreground">
                  {formatDateTime(record.dispensedAt, timezone)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
