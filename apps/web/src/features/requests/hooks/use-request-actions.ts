import {
  type BatchAction,
  type BoardStatus,
  canMove,
  type RequestActionId,
  type RequestStatus,
  requestActions,
} from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";
import { useCallback } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";

import { useDispenseRequest, useTransitionRequest } from "./request-mutations";

export type RequestDialogState =
  | { kind: "cancel"; request: RequestDto }
  | { kind: "clear" }
  | { kind: "deny"; requests: RequestDto[] }
  | { kind: "detail"; id: string }
  | { kind: "dispense"; request: RequestDto };

export interface RequestActionsApi {
  /** A card dropped onto a column (drag & drop). */
  drop: (request: RequestDto, to: BoardStatus) => void;
  /** A card-menu / detail-footer action. */
  runAction: (action: RequestActionId, request: RequestDto) => void;
  /** The batch toolbar's buttons. */
  runBatch: (action: BatchAction, requests: RequestDto[]) => Promise<void>;
}

function targetOf(
  action: RequestActionId,
  request: RequestDto
): RequestStatus | null {
  return (
    requestActions(request.status).find((entry) => entry.id === action)?.to ??
    null
  );
}

/**
 * Turns user intents (menu item, drop, batch button) into either a direct transition or the
 * dialog that collects what the API needs (deny reason, hand-over quantity, cancel note).
 */
export function useRequestActions(
  openDialog: (dialog: RequestDialogState) => void
): RequestActionsApi {
  const transition = useTransitionRequest();
  const dispense = useDispenseRequest();

  const move = useCallback(
    (request: RequestDto, to: RequestStatus) => {
      if (to === "denied") {
        openDialog({ kind: "deny", requests: [request] });
        return;
      }
      if (to === "claimed") {
        openDialog({ kind: "dispense", request });
        return;
      }
      transition.mutate(
        { id: request.id, to },
        {
          onError: (error) =>
            toast.error(errorMessage(error, `Could not move ${request.code}.`)),
        }
      );
    },
    [openDialog, transition]
  );

  const runAction = useCallback(
    (action: RequestActionId, request: RequestDto) => {
      if (action === "view" || action === "view-dispensing-record") {
        openDialog({ id: request.id, kind: "detail" });
        return;
      }
      if (action === "cancel") {
        openDialog({ kind: "cancel", request });
        return;
      }
      const to = targetOf(action, request);
      if (to !== null) {
        move(request, to);
      }
    },
    [move, openDialog]
  );

  const drop = useCallback(
    (request: RequestDto, to: BoardStatus) => {
      if (canMove(request.status, to)) {
        move(request, to);
      }
    },
    [move]
  );

  const runBatch = useCallback(
    async (action: BatchAction, requests: RequestDto[]) => {
      if (action.to === "denied") {
        openDialog({ kind: "deny", requests });
        return;
      }
      let failed = 0;
      for (const request of requests) {
        try {
          await (action.to === "claimed"
            ? dispense.mutateAsync({ id: request.id })
            : transition.mutateAsync({ id: request.id, to: action.to }));
        } catch (error) {
          failed += 1;
          toast.error(
            errorMessage(error, `${request.code} could not be moved.`)
          );
        }
      }
      if (failed < requests.length) {
        toast.success(`${action.label}: ${requests.length - failed} done.`);
      }
    },
    [dispense, openDialog, transition]
  );

  return { drop, runAction, runBatch };
}
