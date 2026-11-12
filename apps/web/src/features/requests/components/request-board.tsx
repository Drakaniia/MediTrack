import {
  type BoardStatus,
  canMove,
  type RequestActionId,
} from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";
import { type ReactElement, type ReactNode, useMemo } from "react";

import { useCardDrag } from "../hooks/use-card-drag";
import { REQUEST_COLUMNS } from "../lib/request-view";
import { RequestColumn } from "./request-column";

export interface RequestBoardProps {
  /** Header controls per column (the Claimed lane's "Clear claimed"). */
  columnActions?: Partial<Record<BoardStatus, ReactNode>>;
  /** Drag & drop is only wired for roles that may process requests. */
  dragEnabled: boolean;
  onAction: (action: RequestActionId, request: RequestDto) => void;
  onDrop: (request: RequestDto, to: BoardStatus) => void;
  onOpen: (request: RequestDto) => void;
  onSelectChange?: (request: RequestDto, selected: boolean) => void;
  requests: RequestDto[];
  selectedIds: ReadonlySet<string>;
}

function groupByStatus(requests: readonly RequestDto[]) {
  const groups = new Map<BoardStatus, RequestDto[]>();
  for (const column of REQUEST_COLUMNS) {
    groups.set(column.status, []);
  }
  for (const request of requests) {
    groups.get(request.status as BoardStatus)?.push(request);
  }
  return groups;
}

/** The kanban lanes. Cancelled requests have no lane (they stay reachable through search/history). */
export function RequestBoard({
  columnActions,
  dragEnabled,
  onAction,
  onDrop,
  onOpen,
  onSelectChange,
  requests,
  selectedIds,
}: RequestBoardProps): ReactElement {
  const groups = useMemo(() => groupByStatus(requests), [requests]);
  const { drag, startDrag, wasJustDragged } = useCardDrag({
    enabled: dragEnabled,
    onDrop,
  });
  const open = (request: RequestDto) => {
    if (!wasJustDragged()) {
      onOpen(request);
    }
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {REQUEST_COLUMNS.map((meta) => (
        <RequestColumn
          actions={columnActions?.[meta.status]}
          draggingId={drag?.id ?? null}
          dropTarget={
            drag !== null &&
            drag.over === meta.status &&
            canMove(drag.from, meta.status)
          }
          key={meta.status}
          meta={meta}
          onAction={onAction}
          onOpen={open}
          onPointerDown={dragEnabled ? startDrag : undefined}
          onSelectChange={onSelectChange}
          requests={groups.get(meta.status) ?? []}
          selectedIds={selectedIds}
        />
      ))}
      {drag ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 max-w-64 truncate rounded-lg border bg-card px-3 py-2 text-sm shadow-lg"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {drag.label}
        </div>
      ) : null}
    </div>
  );
}
