import { Button } from "@cmis/ui/components/button";
import {
  DISPOSAL_REASON_LABELS,
  DISPOSAL_REASONS,
  type DisposalDto,
  type DisposalReason,
} from "@shared/schemas/expiry";
import { type ReactElement, useState } from "react";

import { DataState } from "@/components/data-state";
import { useFacility } from "@/lib/auth/guards";
import { formatDate, formatDateTime } from "@/lib/format";

import { flattenRows, totalOf, useDisposals } from "../hooks/expiry-queries";
import { FilterSelect } from "./filter-select";

const REASON_OPTIONS = [
  { label: "All reasons", value: "" },
  ...DISPOSAL_REASONS.map((reason) => ({
    label: DISPOSAL_REASON_LABELS[reason],
    value: reason,
  })),
];

function isReason(value: string): value is DisposalReason {
  return (DISPOSAL_REASONS as readonly string[]).includes(value);
}

function DisposalRow({
  disposal,
  timezone,
}: {
  disposal: DisposalDto;
  timezone: string;
}): ReactElement {
  return (
    <tr className="border-b last:border-b-0">
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground text-xs">
        {formatDateTime(disposal.disposedAt, timezone)}
      </td>
      <td className="px-3 py-2 text-sm">
        <span className="block font-medium">{disposal.itemName}</span>
        <span className="block text-muted-foreground text-xs">
          Batch {disposal.batchNumber}
          {disposal.expiry ? ` · expiry ${formatDate(disposal.expiry)}` : ""}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">
        {disposal.qty}
      </td>
      <td className="px-3 py-2 text-sm">
        {DISPOSAL_REASON_LABELS[disposal.reason]}
        {disposal.note ? (
          <span className="block text-muted-foreground text-xs">
            {disposal.note}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-sm">{disposal.disposedByName}</td>
    </tr>
  );
}

/** The write-off log (newest first). Needs `reports.view`: render it only for roles that hold it. */
export function DisposalsLog(): ReactElement {
  const { timezone } = useFacility();
  const [reason, setReason] = useState("");
  const query = useDisposals({
    reason: isReason(reason) ? reason : "",
    search: "",
  });
  const rows = flattenRows(query.data?.pages);
  const total = totalOf(query.data?.pages);

  return (
    <section aria-labelledby="disposals-heading" className="grid gap-3 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-base" id="disposals-heading">
            Recent disposals
          </h2>
          <p className="text-muted-foreground text-xs">
            {total} {total === 1 ? "write-off" : "write-offs"} recorded
          </p>
        </div>
        <FilterSelect
          className="w-44"
          label="Reason"
          onChange={setReason}
          options={REASON_OPTIONS}
          value={reason}
        />
      </div>
      <DataState
        empty={{
          description: "Disposed batches will be listed here.",
          title: "No disposals yet",
        }}
        error={query.error}
        isEmpty={rows.length === 0}
        isLoading={query.isPending}
        onRetry={() => query.refetch()}
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left">
            <caption className="sr-only">Disposals, newest first</caption>
            <thead className="border-b bg-muted/40 text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 font-medium" scope="col">
                  When
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Batch
                </th>
                <th className="px-3 py-2 text-right font-medium" scope="col">
                  Qty
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  Reason
                </th>
                <th className="px-3 py-2 font-medium" scope="col">
                  By
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((disposal) => (
                <DisposalRow
                  disposal={disposal}
                  key={disposal.id}
                  timezone={timezone}
                />
              ))}
            </tbody>
          </table>
        </div>
        {query.hasNextPage ? (
          <Button
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
            variant="outline"
          >
            Show more
          </Button>
        ) : null}
      </DataState>
    </section>
  );
}
