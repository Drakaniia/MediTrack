import type { BoardStatus, RequestStatus } from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";

import { formatQuantity } from "@/lib/format";

export interface RequestColumnMeta {
  /** Tailwind background class for the status dot. */
  accent: string;
  /** Chip classes: colour paired with text, never colour alone. */
  badgeClass: string;
  description: string;
  /** Denied lives off the main flow. */
  isOffFlow: boolean;
  label: string;
  status: BoardStatus;
}

export const REQUEST_COLUMNS: readonly RequestColumnMeta[] = [
  {
    accent: "bg-[var(--warning)]",
    badgeClass:
      "border-[var(--warning)]/40 bg-[var(--warning)]/12 text-[var(--warning)]",
    description: "New requests awaiting review",
    isOffFlow: false,
    label: "Pending",
    status: "pending",
  },
  {
    accent: "bg-primary",
    badgeClass: "border-primary/40 bg-primary/12 text-primary",
    description: "Approved, item being located",
    isOffFlow: false,
    label: "Approved",
    status: "approved",
  },
  {
    accent: "bg-[var(--success)]",
    badgeClass:
      "border-[var(--success)]/40 bg-[var(--success)]/12 text-[var(--success)]",
    description: "Prepared, waiting to be handed over",
    isOffFlow: false,
    label: "Ready to Claim",
    status: "ready",
  },
  {
    accent: "bg-muted-foreground",
    badgeClass: "border-border bg-muted text-muted-foreground",
    description: "Claimed, dispensing logged",
    isOffFlow: false,
    label: "Claimed",
    status: "claimed",
  },
  {
    accent: "bg-destructive",
    badgeClass: "border-destructive/40 bg-destructive/12 text-destructive",
    description: "Denied, off the main flow",
    isOffFlow: true,
    label: "Denied",
    status: "denied",
  },
];

const CANCELLED_META: RequestColumnMeta = {
  accent: "bg-muted-foreground",
  badgeClass: "border-border bg-muted text-muted-foreground",
  description: "Withdrawn before hand-over",
  isOffFlow: true,
  label: "Cancelled",
  status: "denied",
};

export function statusMeta(status: RequestStatus): RequestColumnMeta {
  if (status === "cancelled") {
    return CANCELLED_META;
  }
  return (
    REQUEST_COLUMNS.find((column) => column.status === status) ?? CANCELLED_META
  );
}

export function statusLabel(status: RequestStatus): string {
  return statusMeta(status).label;
}

/** "3 tabs", "1,250 tablets" — the quantity as written on the request. */
export function requestQuantityLabel(
  request: Pick<RequestDto, "qty" | "unit">
): string {
  return formatQuantity(request.qty, request.unit);
}

/** "Walk-in" whenever the requestor is anonymous. */
export function requestorLabel(request: Pick<RequestDto, "requestor">): string {
  const name = request.requestor.name.trim();
  return name === "" ? "Walk-in" : name;
}

/** True while an open request asks for more than can be dispensed right now. */
export function exceedsAvailability(request: RequestDto): boolean {
  const open =
    request.status === "pending" ||
    request.status === "approved" ||
    request.status === "ready";
  return open && request.remaining > request.availableNow;
}

export function isPartiallyDispensed(request: RequestDto): boolean {
  return request.dispensedQty > 0 && request.status === "ready";
}

export const DATE_PRESET_LABELS = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
  custom: "Custom range",
  today: "Today",
} as const;
