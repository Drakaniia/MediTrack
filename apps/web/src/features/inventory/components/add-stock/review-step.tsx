import { Button } from "@cmis/ui/components/button";
import { isIsoDate } from "@shared/dates";
import { isExpired } from "@shared/expiry";
import { ArrowLeft, Check, TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";

import { formatDate } from "@/lib/format";

import type { BatchDraftRow } from "../../lib/batch-rows";

export interface ReviewStepProps {
  hasExpiry: boolean;
  onBack: () => void;
  onConfirm: () => void;
  pending: boolean;
  productName: string;
  rows: readonly BatchDraftRow[];
  today: string;
}

function isPast(row: BatchDraftRow, today: string): boolean {
  return isIsoDate(row.expiry) && isExpired(row.expiry, today);
}

export function ReviewStep({
  hasExpiry,
  onBack,
  onConfirm,
  pending,
  productName,
  rows,
  today,
}: ReviewStepProps): ReactElement {
  const total = rows.reduce((sum, row) => sum + Number(row.qty), 0);
  const expiredCount = rows.filter((row) => isPast(row, today)).length;
  return (
    <section aria-label="Review" className="grid gap-4">
      <div>
        <h2 className="font-semibold text-base">Review before saving</h2>
        <p className="text-muted-foreground text-sm">
          Receiving {total} of {productName || "this product"} in {rows.length}{" "}
          {rows.length === 1 ? "batch" : "batches"}.
        </p>
      </div>
      {expiredCount > 0 ? (
        <p
          className="flex items-start gap-2 rounded-lg border border-expiry-urgent/40 bg-expiry-urgent/10 p-3 text-sm"
          role="alert"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {expiredCount} {expiredCount === 1 ? "batch is" : "batches are"}{" "}
          already past {expiredCount === 1 ? "its" : "their"} expiry date. They
          are saved but quarantined, so they cannot be dispensed.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Batches to save</caption>
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 font-medium" scope="col">
                Batch number
              </th>
              {hasExpiry ? (
                <th className="px-3 py-2 font-medium" scope="col">
                  Expiry
                </th>
              ) : null}
              <th className="px-3 py-2 text-right font-medium" scope="col">
                Quantity
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t" key={row.key}>
                <td className="px-3 py-2">
                  {row.batchNumber.trim() === "" ? (
                    <span className="text-muted-foreground">Automatic</span>
                  ) : (
                    row.batchNumber.trim()
                  )}
                </td>
                {hasExpiry ? (
                  <td className="px-3 py-2">
                    {formatDate(row.expiry)}
                    {isPast(row, today) ? " (expired)" : ""}
                  </td>
                ) : null}
                <td className="px-3 py-2 text-right tabular-nums">{row.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button onClick={onBack} variant="outline">
          <ArrowLeft aria-hidden data-icon="inline-start" />
          Back to edit
        </Button>
        <Button disabled={pending} onClick={onConfirm}>
          <Check aria-hidden data-icon="inline-start" />
          Save stock
        </Button>
      </div>
    </section>
  );
}
