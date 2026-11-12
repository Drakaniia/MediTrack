import { Button, buttonVariants } from "@cmis/ui/components/button";
import { cn } from "@cmis/ui/lib/utils";
import type { BatchDto } from "@shared/schemas/inventory";
import { Link } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import type { ReactElement } from "react";

import { Can } from "@/components/can";
import { ExpiryBadge } from "@/components/expiry-badge";
import { formatDate } from "@/lib/format";

export interface BatchesTableProps {
  batches: readonly BatchDto[];
  caption: string;
  focusBatchId?: string;
  onDelete: (batch: BatchDto) => void;
  onEdit: (batch: BatchDto) => void;
  unit: string;
}

function RankBadge({ rank }: { rank: number | null }): ReactElement {
  if (rank === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs",
        rank === 1 ? "bg-primary text-primary-foreground" : "bg-muted"
      )}
    >
      #{rank}
      {rank === 1 ? " · Use first" : ""}
    </span>
  );
}

function BatchActions({
  batch,
  onDelete,
  onEdit,
}: {
  batch: BatchDto;
  onDelete: (batch: BatchDto) => void;
  onEdit: (batch: BatchDto) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {/* The label page is owned by the SCAN slice; it reads `?batch=<id>`. */}
      <Link
        className={buttonVariants({ size: "sm", variant: "ghost" })}
        search={{ batch: batch.id } as never}
        to="/labels"
      >
        <Printer aria-hidden data-icon="inline-start" />
        Print label
      </Link>
      <Can permission="inventory.write">
        <Button onClick={() => onEdit(batch)} size="sm" variant="ghost">
          Edit
        </Button>
      </Can>
      <Can permission="inventory.delete">
        <Button
          aria-label={`Delete batch ${batch.batchNumber}`}
          onClick={() => onDelete(batch)}
          size="sm"
          variant="ghost"
        >
          Delete
        </Button>
      </Can>
    </div>
  );
}

export function BatchesTable({
  batches,
  caption,
  focusBatchId,
  onDelete,
  onEdit,
  unit,
}: BatchesTableProps): ReactElement {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="px-3 py-2 font-medium" scope="col">
              Order
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Batch
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Expiry
            </th>
            <th className="px-3 py-2 text-right font-medium" scope="col">
              Qty ({unit})
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Received
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr
              aria-current={batch.id === focusBatchId ? "true" : undefined}
              className={cn(
                "border-t",
                batch.id === focusBatchId && "bg-accent"
              )}
              key={batch.id}
            >
              <td className="px-3 py-2">
                <RankBadge rank={batch.fefoRank} />
              </td>
              <td className="px-3 py-2">
                <span className="font-medium">{batch.batchNumber}</span>
                {batch.supplier ? (
                  <span className="block text-muted-foreground text-xs">
                    {batch.supplier}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {batch.expiry ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {formatDate(batch.expiry)}
                    <ExpiryBadge
                      daysUntil={batch.daysUntil}
                      expiryClass={batch.expiryClass}
                    />
                  </span>
                ) : (
                  <span className="text-muted-foreground">No expiry</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{batch.qty}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {formatDate(batch.receivedOn)}
              </td>
              <td className="px-3 py-2">
                <BatchActions
                  batch={batch}
                  onDelete={onDelete}
                  onEdit={onEdit}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
