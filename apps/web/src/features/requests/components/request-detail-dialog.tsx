import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import type { RequestActionId } from "@shared/request-transitions";
import {
  type DispensingRecordDto,
  QUICK_DEDUCT_LABEL,
  type RequestDto,
} from "@shared/schemas/requests";
import type { ReactElement, ReactNode } from "react";

import { useFacility } from "@/lib/auth/guards";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/format";

import { useAllowedActions } from "../hooks/use-allowed-actions";
import { requestorLabel, statusLabel } from "../lib/request-view";
import { RequestStatusBadge } from "./request-status-badge";

export interface RequestDetailDialogProps {
  onAction: (action: RequestActionId, request: RequestDto) => void;
  onClose: () => void;
  request: RequestDto;
}

function Fact({
  label,
  children,
}: {
  children: ReactNode;
  label: string;
}): ReactElement {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function RecordItem({
  record,
  timezone,
}: {
  record: DispensingRecordDto;
  timezone: string;
}): ReactElement {
  return (
    <li className="grid gap-0.5 rounded-md border p-2 text-sm">
      <p>
        {formatQuantity(record.qty, record.unit)} by {record.dispensedByName},{" "}
        {formatDateTime(record.dispensedAt, timezone)}
      </p>
      <ul className="text-muted-foreground text-xs">
        {record.lines.map((line) => (
          <li key={line.id}>
            Batch {line.batchNumber}: {line.qty}
            {line.expiry ? ` (expires ${formatDate(line.expiry)})` : ""}
          </li>
        ))}
      </ul>
    </li>
  );
}

function Footer({
  onAction,
  onClose,
  request,
}: RequestDetailDialogProps): ReactElement {
  const actions = useAllowedActions(request).filter(
    (action) => action.id !== "view" && action.id !== "view-dispensing-record"
  );
  return (
    <DialogFooter>
      <Button onClick={onClose} type="button" variant="outline">
        Close
      </Button>
      {actions.map((action) => (
        <Button
          key={action.id}
          onClick={() => onAction(action.id, request)}
          type="button"
          variant={action.destructive ? "destructive" : "default"}
        >
          {action.label}
        </Button>
      ))}
    </DialogFooter>
  );
}

/** Everything about one request: facts, timeline and the batches handed over. */
export function RequestDetailDialog(
  props: RequestDetailDialogProps
): ReactElement {
  const { onClose, request } = props;
  const { timezone } = useFacility();
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {request.code} · {request.itemName}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={request.status} />
            {request.source === "quick_deduct" ? QUICK_DEDUCT_LABEL : null}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3">
          <Fact label="Quantity">
            {formatQuantity(request.qty, request.unit)}
          </Fact>
          <Fact label="Handed over">
            {formatQuantity(request.dispensedQty, request.unit)}
          </Fact>
          <Fact label="Requestor">
            {requestorLabel(request)}
            {request.requestor.ref ? ` (${request.requestor.ref})` : ""}
          </Fact>
          <Fact label="Requested by">{request.requestedByName || "—"}</Fact>
          <Fact label="Available now">
            {formatQuantity(request.availableNow, request.unit)}
          </Fact>
          <Fact label="Submitted">
            {formatDateTime(request.submittedAt, timezone)}
          </Fact>
          {request.reason ? <Fact label="Reason">{request.reason}</Fact> : null}
          {request.deniedReason ? (
            <Fact label="Denied because">
              {request.deniedReason}
              {request.deniedNote ? `: ${request.deniedNote}` : ""}
            </Fact>
          ) : null}
        </dl>
        <section aria-labelledby="request-timeline">
          <h3 className="pb-1 font-medium text-sm" id="request-timeline">
            Timeline
          </h3>
          <ol className="grid gap-1 text-sm">
            {request.events.map((event) => (
              <li key={event.id}>
                <span className="text-muted-foreground">
                  {formatDateTime(event.at, timezone)}
                </span>{" "}
                {event.fromStatus ? `${statusLabel(event.fromStatus)} → ` : ""}
                {statusLabel(event.toStatus)} · {event.actorName}
                {event.note ? ` · ${event.note}` : ""}
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="request-dispensing">
          <h3 className="pb-1 font-medium text-sm" id="request-dispensing">
            Dispensing records
          </h3>
          {request.dispensing.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing handed over yet.
            </p>
          ) : (
            <ul className="grid gap-2">
              {request.dispensing.map((record) => (
                <RecordItem
                  key={record.id}
                  record={record}
                  timezone={timezone}
                />
              ))}
            </ul>
          )}
        </section>
        <Footer {...props} />
      </DialogContent>
    </Dialog>
  );
}
