import { Button } from "@cmis/ui/components/button";
import type { BatchAction, RequestActionId } from "@shared/request-transitions";
import type { RequestDto } from "@shared/schemas/requests";
import { Eraser, Eye, Plus } from "lucide-react";
import { type ReactElement, useCallback, useMemo, useState } from "react";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { useCan } from "@/lib/auth/guards";

import { useRequestList } from "../hooks/request-queries";
import {
  type RequestDialogState,
  useRequestActions,
} from "../hooks/use-request-actions";
import { useRequestFilters } from "../hooks/use-request-filters";
import { useNewRequestDialog } from "../new-request-dialog-context";
import { CancelRequestDialog } from "./cancel-request-dialog";
import { ClearClaimedDialog } from "./clear-claimed-dialog";
import { DenyRequestDialog } from "./deny-request-dialog";
import { DispenseRequestDialog } from "./dispense-request-dialog";
import { RequestBoard } from "./request-board";
import { RequestDetailDialog } from "./request-detail-dialog";
import { RequestsBatchToolbar } from "./requests-batch-toolbar";
import { RequestsFilterBar } from "./requests-filter-bar";

interface DialogsProps {
  dialog: RequestDialogState | null;
  onAction: (action: RequestActionId, request: RequestDto) => void;
  onClose: () => void;
  requests: RequestDto[];
}

function RequestDialogs({
  dialog,
  onAction,
  onClose,
  requests,
}: DialogsProps): ReactElement | null {
  switch (dialog?.kind) {
    case "cancel":
      return <CancelRequestDialog onClose={onClose} request={dialog.request} />;
    case "clear":
      return (
        <ClearClaimedDialog
          count={requests.filter((r) => r.status === "claimed").length}
          onClose={onClose}
        />
      );
    case "deny":
      return <DenyRequestDialog onClose={onClose} requests={dialog.requests} />;
    case "dispense":
      return (
        <DispenseRequestDialog onClose={onClose} request={dialog.request} />
      );
    case "detail": {
      const request = requests.find((entry) => entry.id === dialog.id);
      return request ? (
        <RequestDetailDialog
          onAction={onAction}
          onClose={onClose}
          request={request}
        />
      ) : null;
    }
    default:
      return null;
  }
}

/** The Request Queue board (spec §7.4). Roles without `requests.process` get a read-only board. */
export function RequestsPage(): ReactElement {
  const canCreate = useCan("requests.create");
  const canProcess = useCan("requests.process");
  const { openNewRequest } = useNewRequestDialog();
  const filterState = useRequestFilters();
  const list = useRequestList(filterState.filters);
  const [dialog, setDialog] = useState<RequestDialogState | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const actions = useRequestActions(setDialog);

  const requests = list.data ?? [];
  const selected = useMemo(
    () => requests.filter((request) => selectedIds.has(request.id)),
    [requests, selectedIds]
  );
  const claimedCount = requests.filter((r) => r.status === "claimed").length;

  const toggle = useCallback((request: RequestDto, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(request.id);
      } else {
        next.delete(request.id);
      }
      return next;
    });
  }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const runBatch = async (action: BatchAction) => {
    await actions.runBatch(action, selected);
    clearSelection();
  };
  const fromDetail = (action: RequestActionId, request: RequestDto) => {
    setDialog(null);
    actions.runAction(action, request);
  };

  return (
    <div>
      <PageHeader
        actions={
          canCreate ? (
            <Button onClick={() => openNewRequest()} type="button">
              <Plus aria-hidden data-icon="inline-start" />
              New request
            </Button>
          ) : null
        }
        description={
          canProcess
            ? "Approve, prepare and hand over requests. Drag a card to the next column or use its menu."
            : undefined
        }
        title="Request queue"
      />
      {canProcess ? null : (
        <p className="mb-3 flex items-center gap-2 text-muted-foreground text-sm">
          <Eye aria-hidden className="size-4" />
          View only: pharmacists and administrators process requests.
        </p>
      )}
      <RequestsFilterBar state={filterState} />
      {canProcess ? (
        <RequestsBatchToolbar
          onClear={clearSelection}
          onRun={runBatch}
          selected={selected}
        />
      ) : null}
      <DataState
        empty={{
          description: filterState.isFiltered
            ? "Try different filters."
            : "New requests show up here.",
          title: "No requests",
        }}
        error={list.error}
        isEmpty={requests.length === 0}
        isLoading={list.isPending}
        onRetry={() => list.refetch()}
      >
        <RequestBoard
          columnActions={
            canProcess && claimedCount > 0
              ? {
                  claimed: (
                    <Button
                      onClick={() => setDialog({ kind: "clear" })}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Eraser aria-hidden data-icon="inline-start" />
                      Clear claimed
                    </Button>
                  ),
                }
              : undefined
          }
          dragEnabled={canProcess}
          onAction={actions.runAction}
          onDrop={actions.drop}
          onOpen={(request) => setDialog({ id: request.id, kind: "detail" })}
          onSelectChange={canProcess ? toggle : undefined}
          requests={requests}
          selectedIds={selectedIds}
        />
      </DataState>
      <RequestDialogs
        dialog={dialog}
        onAction={fromDetail}
        onClose={closeDialog}
        requests={requests}
      />
    </div>
  );
}
