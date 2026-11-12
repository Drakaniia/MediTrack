/**
 * The request status machine (spec §7.4), shared by the API and the board UI.
 *
 * `cancelled` is a withdrawn request (requester or staff, before hand-over) and is terminal.
 *
 * The card menu, the detail footer, the batch toolbar, drag & drop and the API all read from
 * here, so a forbidden move can never be offered by one surface and refused by another.
 * `claimed` is reached ONLY through the dispense service (a hand-over moves stock), never
 * through `POST /transition`; `cancelled` only through `POST /cancel`.
 */

import type { Permission } from "./permissions";

export const REQUEST_STATUSES = [
  "pending",
  "approved",
  "ready",
  "claimed",
  "denied",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Statuses that have a column on the board (cancelled requests leave it). */
export const BOARD_STATUSES = [
  "pending",
  "approved",
  "ready",
  "claimed",
  "denied",
] as const satisfies readonly RequestStatus[];
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** The on-path flow, excluding the off-flow Denied lane. */
export const FLOW_ORDER: readonly RequestStatus[] = [
  "pending",
  "approved",
  "ready",
  "claimed",
];

export const DENY_REASONS = [
  "Out of Stock",
  "Not Available",
  "Duplicate Request",
  "Other",
] as const;
export type DenyReason = (typeof DENY_REASONS)[number];

/** Claimed cards leave the board after this long but stay in the dispensing log. */
export const CLAIMED_ARCHIVE_HOURS = 24;

const MS_PER_HOUR = 3_600_000;

/**
 * Moves the board offers between columns. `ready → claimed` is a hand-over (opens the dispense
 * dialog); it is part of the table so drag & drop can ask `canMove`, but the API only performs
 * it through `/dispense`.
 */
const ALLOWED_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  approved: ["denied", "pending", "ready"],
  cancelled: [],
  claimed: [],
  denied: ["pending"],
  pending: ["approved", "denied", "ready"],
  ready: ["approved", "claimed"],
};

/** Statuses a request can still be withdrawn from (nothing handed over yet). */
const CANCELLABLE: readonly RequestStatus[] = ["pending", "approved", "ready"];

/** Statuses whose reason / requestor can still be edited. */
const EDITABLE: readonly RequestStatus[] = ["pending", "approved"];

export function isRequestStatus(value: unknown): value is RequestStatus {
  return (
    typeof value === "string" &&
    (REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export function canMove(from: RequestStatus, to: RequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** A move `POST /transition` may perform (everything except hand-over and cancellation). */
export function isDirectTransition(
  from: RequestStatus,
  to: RequestStatus
): boolean {
  return canMove(from, to) && to !== "claimed";
}

export function canCancel(status: RequestStatus): boolean {
  return CANCELLABLE.includes(status);
}

export function canEdit(status: RequestStatus): boolean {
  return EDITABLE.includes(status);
}

export function isTerminal(status: RequestStatus): boolean {
  return status === "claimed" || status === "cancelled";
}

export type RequestActionId =
  | "approve"
  | "cancel"
  | "deny"
  | "dispense"
  | "move-to-approved"
  | "move-to-pending"
  | "move-to-ready"
  | "reopen"
  | "view"
  | "view-dispensing-record";

export interface RequestAction {
  destructive?: boolean;
  id: RequestActionId;
  label: string;
  /** Permission needed; absent for pure views. Cancel is also open to the requester. */
  permission?: Permission;
  /** Target status for structural moves; absent for pure views. */
  to?: RequestStatus;
}

const VIEW: RequestAction = { id: "view", label: "View details" };
const PROCESS: Permission = "requests.process";

/** ⋯ menu actions per column. "Approve" and "Move to Approved" are one entry. */
export function requestActions(status: RequestStatus): RequestAction[] {
  switch (status) {
    case "pending":
      return [
        VIEW,
        {
          id: "approve",
          label: "Approve",
          permission: PROCESS,
          to: "approved",
        },
        {
          id: "move-to-ready",
          label: "Move to Ready to Claim",
          permission: PROCESS,
          to: "ready",
        },
        {
          destructive: true,
          id: "deny",
          label: "Deny",
          permission: PROCESS,
          to: "denied",
        },
        {
          destructive: true,
          id: "cancel",
          label: "Cancel request",
          permission: "requests.create",
        },
      ];
    case "approved":
      return [
        VIEW,
        {
          id: "move-to-ready",
          label: "Prepare → Ready to Claim",
          permission: PROCESS,
          to: "ready",
        },
        {
          id: "move-to-pending",
          label: "Move to Pending",
          permission: PROCESS,
          to: "pending",
        },
        {
          destructive: true,
          id: "deny",
          label: "Deny",
          permission: PROCESS,
          to: "denied",
        },
        {
          destructive: true,
          id: "cancel",
          label: "Cancel request",
          permission: "requests.create",
        },
      ];
    case "ready":
      return [
        VIEW,
        {
          id: "dispense",
          label: "Dispense → Claimed",
          permission: PROCESS,
          to: "claimed",
        },
        {
          id: "move-to-approved",
          label: "Move to Approved",
          permission: PROCESS,
          to: "approved",
        },
        {
          destructive: true,
          id: "cancel",
          label: "Cancel request",
          permission: "requests.create",
        },
      ];
    case "claimed":
      return [
        VIEW,
        { id: "view-dispensing-record", label: "View dispensing record" },
      ];
    case "denied":
      return [
        VIEW,
        {
          id: "reopen",
          label: "Re-open → Pending",
          permission: PROCESS,
          to: "pending",
        },
      ];
    default:
      return [VIEW];
  }
}

/** The primary footer action of the detail dialog; null when terminal. */
export function primaryAction(status: RequestStatus): RequestAction | null {
  switch (status) {
    case "pending":
      return {
        id: "approve",
        label: "Approve",
        permission: PROCESS,
        to: "approved",
      };
    case "approved":
      return {
        id: "move-to-ready",
        label: "Prepare → Ready",
        permission: PROCESS,
        to: "ready",
      };
    case "ready":
      return {
        id: "dispense",
        label: "Dispense → Claimed",
        permission: PROCESS,
        to: "claimed",
      };
    case "denied":
      return {
        id: "reopen",
        label: "Re-open → Pending",
        permission: PROCESS,
        to: "pending",
      };
    default:
      return null;
  }
}

export type BatchActionId =
  | "approve-all"
  | "deny-all"
  | "dispense-all"
  | "move-all-approved"
  | "move-all-pending"
  | "prepare-all";

export interface BatchAction {
  destructive?: boolean;
  id: BatchActionId;
  label: string;
  to: RequestStatus;
}

const APPROVE_ALL: BatchAction = {
  id: "approve-all",
  label: "Approve all",
  to: "approved",
};
const DENY_ALL: BatchAction = {
  destructive: true,
  id: "deny-all",
  label: "Deny all",
  to: "denied",
};
const PREPARE_ALL: BatchAction = {
  id: "prepare-all",
  label: "Prepare all",
  to: "ready",
};
const DISPENSE_ALL: BatchAction = {
  id: "dispense-all",
  label: "Dispense all",
  to: "claimed",
};
const MOVE_ALL_PENDING: BatchAction = {
  id: "move-all-pending",
  label: "Move all to Pending",
  to: "pending",
};
const MOVE_ALL_APPROVED: BatchAction = {
  id: "move-all-approved",
  label: "Move all to Approved",
  to: "approved",
};

const BATCH_ACTIONS_BY_STATUS: Partial<Record<RequestStatus, BatchAction[]>> = {
  approved: [PREPARE_ALL, MOVE_ALL_PENDING, DENY_ALL],
  pending: [APPROVE_ALL, DENY_ALL],
  ready: [DISPENSE_ALL, MOVE_ALL_APPROVED],
};

/** Column-aware batch actions; a mixed selection collapses to Deny (when anything can be denied). */
export function batchActions(
  statuses: readonly RequestStatus[]
): BatchAction[] {
  const unique = new Set(statuses);
  if (unique.size === 0) {
    return [];
  }
  if (unique.size === 1) {
    const [only] = [...unique];
    return BATCH_ACTIONS_BY_STATUS[only] ?? [];
  }
  const deniable = statuses.some(
    (status) => status === "pending" || status === "approved"
  );
  return deniable ? [DENY_ALL] : [];
}

/**
 * True when a claimed request has left the board: explicitly archived, or claimed more than
 * `CLAIMED_ARCHIVE_HOURS` ago (it stays in the dispensing log either way).
 */
export function isArchivedClaimed(
  request: {
    archivedAt: string | null;
    claimedAt: string | null;
    status: RequestStatus;
  },
  now: Date,
  archiveHours: number = CLAIMED_ARCHIVE_HOURS
): boolean {
  if (request.status !== "claimed") {
    return false;
  }
  if (request.archivedAt !== null) {
    return true;
  }
  if (request.claimedAt === null) {
    return false;
  }
  return (
    now.getTime() - new Date(request.claimedAt).getTime() >
    archiveHours * MS_PER_HOUR
  );
}
