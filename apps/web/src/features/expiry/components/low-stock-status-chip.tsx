import { cn } from "@cmis/ui/lib/utils";
import { LOW_STOCK_LABELS } from "@shared/low-stock";
import type { LowStockListStatus } from "@shared/schemas/expiry";
import { PackageX, TrendingDown } from "lucide-react";
import type { ReactElement } from "react";

const STYLES = {
  low: { icon: TrendingDown, tone: "bg-expiry-near/15 text-expiry-near" },
  out: { icon: PackageX, tone: "bg-expiry-expired/15 text-expiry-expired" },
} as const;

/** "Low" / "Out": icon + text, never colour alone. */
export function LowStockStatusChip({
  status,
}: {
  status: LowStockListStatus;
}): ReactElement {
  const { icon: Icon, tone } = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs",
        tone
      )}
      data-low-stock={status}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {LOW_STOCK_LABELS[status]}
    </span>
  );
}
