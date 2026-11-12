import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import { type ReactElement, useId, useState } from "react";

import { DataState } from "@/components/data-state";
import { useFacility } from "@/lib/auth/guards";
import { formatDate, formatQuantity } from "@/lib/format";

import { useMonthlyDispensing } from "../hooks/request-queries";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Per item, per batch quantities handed over in one facility-local month (undone records excluded). */
export function DispensingMonthly(): ReactElement {
  const { today } = useFacility();
  const monthId = useId();
  const [month, setMonth] = useState(today.slice(0, 7));
  const valid = MONTH_PATTERN.test(month);
  const monthly = useMonthlyDispensing(month, valid);
  const items = monthly.data?.items ?? [];

  return (
    <div className="grid gap-3">
      <div className="grid w-48 gap-1">
        <Label htmlFor={monthId}>Month</Label>
        <Input
          id={monthId}
          onChange={(event) => setMonth(event.target.value)}
          type="month"
          value={month}
        />
      </div>
      <DataState
        empty={{
          description: "Nothing was dispensed in this month.",
          title: "No dispensing",
        }}
        error={monthly.error}
        isEmpty={valid && items.length === 0}
        isLoading={valid && monthly.isPending}
        onRetry={() => monthly.refetch()}
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Quantities dispensed per item and batch in {month}
            </caption>
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th className="p-2 font-medium" scope="col">
                  Item
                </th>
                <th className="p-2 font-medium" scope="col">
                  Batch
                </th>
                <th className="p-2 font-medium" scope="col">
                  Expiry
                </th>
                <th className="p-2 text-right font-medium" scope="col">
                  Quantity
                </th>
              </tr>
            </thead>
            {items.map((item) => (
              <tbody className="border-t" key={item.itemId ?? item.itemName}>
                {item.batches.map((batch, index) => (
                  <tr
                    key={`${batch.batchId ?? batch.batchNumber}-${batch.expiry}`}
                  >
                    <th className="p-2 font-medium" scope="row">
                      {index === 0 ? item.itemName : ""}
                    </th>
                    <td className="p-2">{batch.batchNumber}</td>
                    <td className="p-2">{formatDate(batch.expiry)}</td>
                    <td className="p-2 text-right tabular-nums">{batch.qty}</td>
                  </tr>
                ))}
                <tr className="bg-muted/30 font-medium">
                  <td className="p-2" colSpan={3}>
                    Total {item.itemName}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatQuantity(item.totalQty, item.unit)}
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      </DataState>
    </div>
  );
}
