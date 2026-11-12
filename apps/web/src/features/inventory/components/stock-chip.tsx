import { cn } from "@cmis/ui/lib/utils";
import type { LowStockStatus } from "@shared/schemas/inventory";
import { PackageX, TrendingDown } from "lucide-react";
import type { ReactElement } from "react";

const CHIPS = {
  low: {
    icon: TrendingDown,
    label: "Low stock",
    tone: "bg-expiry-near/15 text-expiry-near",
  },
  out: {
    icon: PackageX,
    label: "Out of stock",
    tone: "bg-expiry-expired/15 text-expiry-expired",
  },
} as const;

/** Shown only when stock is low or out; icon + text, never colour alone. */
export function LowStockChip({
  className,
  status,
}: {
  className?: string;
  status: LowStockStatus;
}): ReactElement | null {
  if (status === "in_stock") {
    return null;
  }
  const { icon: Icon, label, tone } = CHIPS[status];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs",
        tone,
        className
      )}
      data-low-stock={status}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}
