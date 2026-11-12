import { permissionsFor } from "@shared/permissions";
import type { Role } from "@shared/roles";
import { describe, expect, it } from "vitest";

import { makeRequest } from "../test-data";
import { allowedActionsFor } from "./use-allowed-actions";

function ids(
  role: Role,
  request = makeRequest(),
  userId: string | null = null
) {
  return allowedActionsFor(request, permissionsFor(role), userId).map(
    (a) => a.id
  );
}

describe("allowedActionsFor", () => {
  it("gives pharmacists and admins every pending action", () => {
    for (const role of ["pharmacist", "admin"] as const) {
      expect(ids(role)).toEqual([
        "view",
        "approve",
        "move-to-ready",
        "deny",
        "cancel",
      ]);
    }
  });

  it("gives a nurse no process action, only cancel on their own request", () => {
    expect(ids("nurse", makeRequest({ requestedBy: "u1" }), "u1")).toEqual([
      "view",
      "cancel",
    ]);
    expect(ids("nurse", makeRequest({ requestedBy: "u2" }), "u1")).toEqual([
      "view",
    ]);
  });

  it("gives a health administrator the view only", () => {
    expect(
      ids("health_admin", makeRequest({ requestedBy: "u1" }), "u1")
    ).toEqual(["view"]);
  });

  it("only lets a partly handed-over request be completed", () => {
    const partial = makeRequest({
      dispensedQty: 2,
      remaining: 3,
      status: "ready",
    });
    expect(ids("pharmacist", partial)).toEqual(["view", "dispense"]);
  });

  it("offers re-open for denied and nothing for claimed beyond viewing", () => {
    expect(ids("pharmacist", makeRequest({ status: "denied" }))).toEqual([
      "view",
      "reopen",
    ]);
    expect(ids("pharmacist", makeRequest({ status: "claimed" }))).toEqual([
      "view",
      "view-dispensing-record",
    ]);
  });
});
