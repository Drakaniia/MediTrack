import { cn } from "@cmis/ui/lib/utils";
import type { RequestActionId } from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";
import type { PointerEvent, ReactElement, ReactNode } from "react";

import type { RequestColumnMeta } from "../lib/request-view";
import { RequestCard } from "./request-card";

export interface RequestColumnProps {
  /** Extra controls in the column header (e.g. "Clear claimed"). */
  actions?: ReactNode;
  draggingId: string | null;
  /** True while a card that may legally land here hovers over the column. */
  dropTarget: boolean;
  meta: RequestColumnMeta;
  onAction: (action: RequestActionId, request: RequestDto) => void;
  onOpen: (request: RequestDto) => void;
  onPointerDown?: (event: PointerEvent, request: RequestDto) => void;
  onSelectChange?: (request: RequestDto, selected: boolean) => void;
  requests: RequestDto[];
  selectedIds: ReadonlySet<string>;
}

/** One status lane. `data-column-status` is what the drag hook hit-tests against. */
export function RequestColumn({
  actions,
  draggingId,
  dropTarget,
  meta,
  onAction,
  onOpen,
  onPointerDown,
  onSelectChange,
  requests,
  selectedIds,
}: RequestColumnProps): ReactElement {
  const headingId = `column-${meta.status}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex min-h-40 w-72 shrink-0 flex-col gap-2 rounded-xl border bg-muted/30 p-2 md:w-auto md:min-w-0 md:flex-1",
        dropTarget && "border-primary bg-primary/5 ring-2 ring-primary/40"
      )}
      data-column-status={meta.status}
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2
            className="flex items-center gap-2 font-semibold text-sm"
            id={headingId}
          >
            <span
              aria-hidden
              className={cn("size-2 rounded-full", meta.accent)}
            />
            {meta.label}
            <span
              aria-label={`${requests.length} requests`}
              className="rounded-full bg-muted px-1.5 font-normal text-muted-foreground text-xs tabular-nums"
            >
              {requests.length}
            </span>
          </h2>
          <p className="truncate text-muted-foreground text-xs">
            {meta.description}
          </p>
        </div>
        {actions}
      </header>
      {requests.length === 0 ? (
        <p className="px-2 py-6 text-center text-muted-foreground text-xs">
          No requests here
        </p>
      ) : (
        <ul className="grid gap-2">
          {requests.map((request) => (
            <RequestCard
              dragging={draggingId === request.id}
              key={request.id}
              onAction={onAction}
              onOpen={onOpen}
              onPointerDown={onPointerDown}
              onSelectChange={onSelectChange}
              request={request}
              selected={selectedIds.has(request.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
