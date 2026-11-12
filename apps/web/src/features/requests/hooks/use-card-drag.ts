import { type BoardStatus, canMove } from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Pointer-based card drag between board columns (simplified port of the desktop `use-card-drag`:
 * no edge auto-scroll or in-column reordering; the card menu is the keyboard / touch route).
 *
 * Only mouse and pen start a drag, so touch scrolling keeps working. A drag starts after the
 * pointer moved `DRAG_THRESHOLD_PX`; Escape cancels; the drop target is the column under the
 * pointer (`data-column-status`), accepted only when `canMove(from, to)`.
 */

const DRAG_THRESHOLD_PX = 6;
const INTERACTIVE = "button, a, input, select, textarea, [role='menuitem']";

export interface DragState {
  from: BoardStatus;
  id: string;
  label: string;
  /** Column under the pointer, or null. */
  over: BoardStatus | null;
  x: number;
  y: number;
}

export interface UseCardDragOptions {
  enabled: boolean;
  onDrop: (request: RequestDto, to: BoardStatus) => void;
}

export interface CardDragApi {
  drag: DragState | null;
  startDrag: (event: ReactPointerEvent, request: RequestDto) => void;
  /** True once, right after a drag ended: swallows the click that follows the pointer-up. */
  wasJustDragged: () => boolean;
}

interface PendingDrag {
  active: boolean;
  request: RequestDto;
  startX: number;
  startY: number;
}

function columnAt(x: number, y: number): BoardStatus | null {
  if (typeof document.elementsFromPoint !== "function") {
    return null;
  }
  for (const element of document.elementsFromPoint(x, y)) {
    const column = element.closest("[data-column-status]");
    if (column) {
      return column.getAttribute("data-column-status") as BoardStatus;
    }
  }
  return null;
}

function labelOf(request: RequestDto): string {
  return `${request.code} · ${request.itemName}`;
}

export function useCardDrag({
  enabled,
  onDrop,
}: UseCardDragOptions): CardDragApi {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pending = useRef<PendingDrag | null>(null);
  const justDragged = useRef(false);
  const dropRef = useRef(onDrop);

  useEffect(() => {
    dropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onMove = (event: PointerEvent) => {
      const current = pending.current;
      if (!current) {
        return;
      }
      const distance = Math.hypot(
        event.clientX - current.startX,
        event.clientY - current.startY
      );
      if (!current.active && distance < DRAG_THRESHOLD_PX) {
        return;
      }
      current.active = true;
      setDrag({
        from: current.request.status as BoardStatus,
        id: current.request.id,
        label: labelOf(current.request),
        over: columnAt(event.clientX, event.clientY),
        x: event.clientX,
        y: event.clientY,
      });
    };
    const onUp = (event: PointerEvent) => {
      const current = pending.current;
      pending.current = null;
      if (!current?.active) {
        return;
      }
      const target = columnAt(event.clientX, event.clientY);
      setDrag(null);
      justDragged.current = true;
      window.setTimeout(() => {
        justDragged.current = false;
      }, 0);
      const { status } = current.request;
      if (target && target !== status && canMove(status, target)) {
        dropRef.current(current.request, target);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pending.current) {
        pending.current = null;
        setDrag(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled]);

  const startDrag = useCallback(
    (event: ReactPointerEvent, request: RequestDto) => {
      if (!enabled || event.button !== 0 || event.pointerType === "touch") {
        return;
      }
      if ((event.target as Element).closest(INTERACTIVE)) {
        return;
      }
      pending.current = {
        active: false,
        request,
        startX: event.clientX,
        startY: event.clientY,
      };
    },
    [enabled]
  );

  const wasJustDragged = useCallback(() => justDragged.current, []);

  return { drag, startDrag, wasJustDragged };
}
