import {
  PENDING_CARD_STATUSES,
  type PendingCardStatus,
  type PendingRequestsCardDto,
} from "@shared/schemas/dashboard";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { useFacility } from "@/lib/auth/guards";
import { formatDateTime, formatQuantity } from "@/lib/format";

import { CARD_LINK_CLASS, CardEmpty, DashboardCard } from "./dashboard-card";

const STATUS_LABELS: Record<PendingCardStatus, string> = {
  approved: "Approved",
  pending: "Pending",
  ready: "Ready to claim",
};

export interface PendingRequestsCardProps {
  data: PendingRequestsCardDto;
}

/** Open requests by status, and the oldest ones still waiting for a decision. */
export function PendingRequestsCard({
  data,
}: PendingRequestsCardProps): ReactElement {
  const { timezone } = useFacility();
  return (
    <DashboardCard
      action={
        <Link className={CARD_LINK_CLASS} to="/requests">
          Open request queue
        </Link>
      }
      title="Requests"
    >
      <dl className="grid grid-cols-3 gap-2">
        {PENDING_CARD_STATUSES.map((status) => (
          <div className="rounded-md bg-muted/40 p-2" key={status}>
            <dt className="text-muted-foreground text-xs">
              {STATUS_LABELS[status]}
            </dt>
            <dd className="font-semibold text-xl tabular-nums">
              {data.counts[status]}
            </dd>
          </div>
        ))}
      </dl>
      {data.oldestPending.length === 0 ? (
        <CardEmpty>No requests are waiting for a decision.</CardEmpty>
      ) : (
        <div className="grid gap-1">
          <h3 className="font-medium text-muted-foreground text-xs">
            Waiting longest
          </h3>
          <ul aria-label="Oldest pending requests" className="grid gap-1">
            {data.oldestPending.map((request) => (
              <li
                className="flex items-center justify-between gap-3 px-2 py-1"
                key={request.id}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-sm">
                    {request.itemName}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {request.code}
                    {request.requestorName ? ` · ${request.requestorName}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className="block tabular-nums">
                    {formatQuantity(request.qty, request.unit)}
                  </span>
                  <span className="block text-muted-foreground">
                    {formatDateTime(request.submittedAt, timezone)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardCard>
  );
}
