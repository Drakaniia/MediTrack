import type { HistoryEntryDto } from "@shared/schemas/inventory";
import type { ReactElement } from "react";

import { DataState } from "@/components/data-state";
import { useFacility } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";

import { useItemHistory } from "../hooks/inventory-queries";

const KIND_LABELS: Record<string, string> = {
  adjust: "Adjusted",
  dispense: "Dispensed",
  dispose: "Disposed",
  receive: "Received",
  undo_dispense: "Dispense undone",
};

function describe(entry: HistoryEntryDto): string {
  if (entry.source === "audit") {
    return entry.summary;
  }
  const label = KIND_LABELS[entry.kind] ?? entry.kind;
  const sign = (entry.qtyDelta ?? 0) > 0 ? "+" : "";
  return `${label} ${sign}${entry.qtyDelta ?? 0} (batch ${entry.batchNumber ?? "?"}, now ${entry.qtyAfter ?? 0})`;
}

export function ItemHistory({ itemId }: { itemId: string }): ReactElement {
  const { timezone } = useFacility();
  const history = useItemHistory(itemId, true);
  const entries = history.data ?? [];
  return (
    <DataState
      empty={{ title: "No history yet" }}
      error={history.error}
      isEmpty={entries.length === 0}
      isLoading={history.isPending}
      onRetry={() => history.refetch()}
    >
      <ol aria-label="Item history" className="divide-y rounded-lg border">
        {entries.map((entry) => (
          <li className="grid gap-0.5 px-3 py-2 text-sm" key={entry.id}>
            <span>{describe(entry)}</span>
            <span className="text-muted-foreground text-xs">
              {entry.actorName} · {formatDateTime(entry.at, timezone)}
              {entry.note ? ` · ${entry.note}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </DataState>
  );
}
