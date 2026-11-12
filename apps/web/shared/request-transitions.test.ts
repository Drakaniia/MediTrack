import { describe, expect, it } from "vitest";

import {
  batchActions,
  canCancel,
  canEdit,
  canMove,
  isArchivedClaimed,
  isDirectTransition,
  isTerminal,
  primaryAction,
  REQUEST_STATUSES,
  type RequestStatus,
  requestActions,
} from "./request-transitions";

const EXPECTED: Record<RequestStatus, RequestStatus[]> = {
  approved: ["denied", "pending", "ready"],
  cancelled: [],
  claimed: [],
  denied: ["pending"],
  pending: ["approved", "denied", "ready"],
  ready: ["approved", "claimed"],
};

describe("canMove", () => {
  it("matches the transition table for every pair", () => {
    for (const from of REQUEST_STATUSES) {
      for (const to of REQUEST_STATUSES) {
        expect(canMove(from, to), `${from} -> ${to}`).toBe(
          EXPECTED[from].includes(to)
        );
      }
    }
  });

  it("keeps claimed, denied and cancelled terminal except Denied -> Pending", () => {
    expect(canMove("claimed", "pending")).toBe(false);
    expect(canMove("claimed", "denied")).toBe(false);
    expect(canMove("denied", "claimed")).toBe(false);
    expect(canMove("denied", "pending")).toBe(true);
    expect(canMove("cancelled", "pending")).toBe(false);
  });

  it("never lets a direct transition reach claimed or cancelled", () => {
    expect(isDirectTransition("ready", "claimed")).toBe(false);
    expect(isDirectTransition("pending", "cancelled")).toBe(false);
    expect(isDirectTransition("pending", "approved")).toBe(true);
  });
});

describe("cancel and edit rules", () => {
  it("allows cancel only before hand-over", () => {
    expect(REQUEST_STATUSES.filter(canCancel)).toEqual([
      "pending",
      "approved",
      "ready",
    ]);
  });

  it("allows edits only while pending or approved", () => {
    expect(REQUEST_STATUSES.filter(canEdit)).toEqual(["pending", "approved"]);
  });

  it("flags claimed and cancelled as terminal", () => {
    expect(REQUEST_STATUSES.filter(isTerminal)).toEqual([
      "claimed",
      "cancelled",
    ]);
  });
});

describe("requestActions", () => {
  it("offers only moves the machine allows", () => {
    for (const status of REQUEST_STATUSES) {
      for (const action of requestActions(status)) {
        if (action.to !== undefined) {
          expect(canMove(status, action.to), `${status}:${action.id}`).toBe(
            true
          );
        }
      }
    }
  });

  it("marks every process action with the process permission", () => {
    const pending = requestActions("pending");
    expect(pending.find((action) => action.id === "approve")?.permission).toBe(
      "requests.process"
    );
    expect(pending.find((action) => action.id === "view")?.permission).toBe(
      undefined
    );
  });

  it("derives the primary action from the status", () => {
    expect(primaryAction("pending")?.id).toBe("approve");
    expect(primaryAction("ready")?.id).toBe("dispense");
    expect(primaryAction("claimed")).toBeNull();
    expect(primaryAction("cancelled")).toBeNull();
  });
});

describe("batchActions", () => {
  it("is column-aware", () => {
    expect(batchActions(["pending", "pending"]).map((a) => a.id)).toEqual([
      "approve-all",
      "deny-all",
    ]);
    expect(batchActions(["approved"]).map((a) => a.id)).toEqual([
      "prepare-all",
      "move-all-pending",
      "deny-all",
    ]);
    expect(batchActions(["ready"]).map((a) => a.id)).toEqual([
      "dispense-all",
      "move-all-approved",
    ]);
    expect(batchActions(["claimed"])).toEqual([]);
    expect(batchActions([])).toEqual([]);
  });

  it("collapses a mixed selection to Deny when something is deniable", () => {
    expect(batchActions(["pending", "ready"]).map((a) => a.id)).toEqual([
      "deny-all",
    ]);
    expect(batchActions(["ready", "claimed"])).toEqual([]);
  });
});

describe("isArchivedClaimed", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");

  it("archives a claimed request after 24 hours or when marked", () => {
    const base = { archivedAt: null, status: "claimed" as const };
    expect(
      isArchivedClaimed({ ...base, claimedAt: "2026-11-11T11:59:00.000Z" }, now)
    ).toBe(true);
    expect(
      isArchivedClaimed({ ...base, claimedAt: "2026-11-12T01:00:00.000Z" }, now)
    ).toBe(false);
    expect(
      isArchivedClaimed(
        { ...base, archivedAt: "2026-11-12T11:00:00.000Z", claimedAt: null },
        now
      )
    ).toBe(true);
  });

  it("never archives other statuses", () => {
    expect(
      isArchivedClaimed(
        {
          archivedAt: null,
          claimedAt: "2020-01-01T00:00:00.000Z",
          status: "ready",
        },
        now
      )
    ).toBe(false);
  });
});
