import { Checkbox } from "@cmis/ui/components/checkbox";
import { cn } from "@cmis/ui/lib/utils";
import type { RequestActionId } from "@shared/request-transitions";
import { QUICK_DEDUCT_LABEL, type RequestDto } from "@shared/schemas/requests";
import { TriangleAlert, Zap } from "lucide-react";
import type { PointerEvent, ReactElement } from "react";

import { formatQuantity } from "@/lib/format";

import {
  exceedsAvailability,
  isPartiallyDispensed,
  requestorLabel,
  requestQuantityLabel,
} from "../lib/request-view";
import { RequestCardMenu } from "./request-card-menu";

export interface RequestCardProps {
  /** True while this card is the one being dragged. */
  dragging: boolean;
  onAction: (action: RequestActionId, request: RequestDto) => void;
  onOpen: (request: RequestDto) => void;
  onPointerDown?: (event: PointerEvent, request: RequestDto) => void;
  onSelectChange?: (request: RequestDto, selected: boolean) => void;
  request: RequestDto;
  selected: boolean;
}

function AvailabilityWarning({ request }: { request: RequestDto }) {
  if (!exceedsAvailability(request)) {
    return null;
  }
  return (
    <p className="flex items-center gap-1 text-[var(--warning)] text-xs">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      Only {formatQuantity(request.availableNow, request.unit)} available now
    </p>
  );
}

/** One request on the board. The title opens the details; the ⋯ menu holds every action. */
export function RequestCard({
  dragging,
  onAction,
  onOpen,
  onPointerDown,
  onSelectChange,
  request,
  selected,
}: RequestCardProps): ReactElement {
  const partial = isPartiallyDispensed(request);
  return (
    <li
      className={cn(
        "grid gap-1.5 rounded-lg border bg-card p-3 text-sm shadow-xs transition-colors",
        selected && "border-primary ring-1 ring-primary",
        dragging && "opacity-40"
      )}
      data-request-id={request.id}
      onPointerDown={(event) => onPointerDown?.(event, request)}
    >
      <div className="flex items-start gap-2">
        {onSelectChange ? (
          <Checkbox
            aria-label={`Select ${request.code}`}
            checked={selected}
            onCheckedChange={(checked) =>
              onSelectChange(request, checked === true)
            }
          />
        ) : null}
        <button
          className="min-w-0 flex-1 text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpen(request)}
          type="button"
        >
          {request.itemName}
        </button>
        <RequestCardMenu onAction={onAction} request={request} />
      </div>
      <p className="text-muted-foreground text-xs">
        {request.code} · {requestQuantityLabel(request)} ·{" "}
        {requestorLabel(request)}
      </p>
      {partial ? (
        <p className="text-xs">
          Handed over {request.dispensedQty} of {request.qty},{" "}
          {request.remaining} to go
        </p>
      ) : null}
      {request.source === "quick_deduct" ? (
        <p className="flex items-center gap-1 text-muted-foreground text-xs">
          <Zap aria-hidden className="size-3.5" />
          {QUICK_DEDUCT_LABEL}
        </p>
      ) : null}
      {request.status === "denied" && request.deniedReason ? (
        <p className="text-destructive text-xs">
          Denied: {request.deniedReason}
        </p>
      ) : null}
      <AvailabilityWarning request={request} />
    </li>
  );
}
