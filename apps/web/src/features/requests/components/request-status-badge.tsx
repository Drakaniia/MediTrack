import { cn } from "@cmis/ui/lib/utils";
import type { RequestStatus } from "@shared/request-transitions";
import type { ReactElement } from "react";

import { statusMeta } from "../lib/request-view";

/** Status chip: colour paired with the status name. */
export function RequestStatusBadge({
  className,
  status,
}: {
  className?: string;
  status: RequestStatus;
}): ReactElement {
  const meta = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs",
        meta.badgeClass,
        className
      )}
      data-status={status}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", meta.accent)} />
      {meta.label}
    </span>
  );
}
