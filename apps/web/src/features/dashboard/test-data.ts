import { can } from "@shared/permissions";
import type { Role } from "@shared/roles";
import type { DashboardDto } from "@shared/schemas/dashboard";
import type { FefoEntryDto } from "@shared/schemas/inventory";

/** `FefoEntryDto` factory for the "use first" list. */
export function makeFefoEntry(
  overrides: { batch?: Partial<FefoEntryDto["batch"]>; item?: Partial<FefoEntryDto["item"]> } = {}
): FefoEntryDto {
  return {
    batch: {
      barcode: null,
      batchNumber: "LOT-1",
      code: "ABCDEFGHJK",
      createdAt: "2026-11-01T00:00:00.000Z",
      daysUntil: 5,
      expiry: "2026-11-17",
      expiryClass: "urgent",
      fefoRank: 1,
      id: "batch-1",
      initialQty: 40,
      itemId: "item-1",
      qty: 40,
      quarantined: false,
      receivedOn: "2026-11-01",
      status: "active",
      supplier: "",
      updatedAt: "2026-11-01T00:00:00.000Z",
      ...overrides.batch,
    },
    item: {
      categoryName: "Analgesic",
      displayName: "Paracetamol 500 mg",
      id: "item-1",
      name: "Paracetamol",
      strength: "500 mg",
      unit: "tab",
      ...overrides.item,
    },
  };
}

/** A full payload (what an admin gets) for `month`. */
export function makeDashboard(
  month: string,
  overrides: Partial<DashboardDto> = {}
): DashboardDto {
  return {
    activity: {
      disposals: { count: 2, units: 30 },
      month,
      unitsDispensed: 120,
      unitsReceived: 300,
    },
    expiringThisMonth: {
      batches: 10,
      items: [
        {
          batchId: "batch-9",
          batchNumber: "AMX-9",
          daysUntil: 3,
          expiry: `${month}-20`,
          expiryClass: "urgent",
          itemId: "item-9",
          itemName: "Amoxicillin 250 mg",
          qty: 12,
          unit: "cap",
        },
      ],
      month,
      units: 90,
    },
    generatedAt: "2026-11-12T02:00:00.000Z",
    month,
    pendingRequests: {
      counts: { approved: 2, pending: 3, ready: 1 },
      oldestPending: [
        {
          code: "REQ-2026-0001",
          id: "req-1",
          itemId: "item-1",
          itemName: "Gauze",
          qty: 4,
          requestorName: "Nurse Joy",
          submittedAt: "2026-11-10T01:00:00.000Z",
          unit: "box",
        },
      ],
    },
    recentDispensing: [
      {
        batches: [
          { batchNumber: "LOT-A", qty: 2 },
          { batchNumber: "LOT-B", qty: 1 },
        ],
        dispensedAt: "2026-11-11T03:00:00.000Z",
        dispensedByName: "Dana Pharmacist",
        id: "disp-1",
        itemId: "item-1",
        itemName: "Ibuprofen 200 mg",
        qty: 3,
        source: "queue",
        unit: "tab",
      },
    ],
    thresholds: { nearDays: 30, urgentDays: 7 },
    timezone: "Asia/Manila",
    today: "2026-11-12",
    totals: {
      classes: {
        expired: { batches: 1, units: 6 },
        near_expiry: { batches: 4, units: 120 },
        safe: { batches: 30, units: 900 },
        urgent: { batches: 2, units: 45 },
      },
      itemCount: 20,
      lowStockCount: 3,
      outOfStockCount: 1,
    },
    useFirst: [
      makeFefoEntry(),
      makeFefoEntry({
        batch: {
          batchNumber: "LOT-2",
          daysUntil: 20,
          expiry: "2026-12-02",
          expiryClass: "near_expiry",
          id: "batch-2",
          itemId: "item-2",
          qty: 8,
        },
        item: { displayName: "Gauze", id: "item-2", name: "Gauze", unit: "box" },
      }),
    ],
    ...overrides,
  };
}

/** The payload the server would send `role`: cards the role may not see are left out. */
export function makeDashboardFor(
  role: Role,
  month: string,
  overrides: Partial<DashboardDto> = {}
): DashboardDto {
  const full = makeDashboard(month, overrides);
  const { activity, pendingRequests, recentDispensing, ...rest } = full;
  return {
    ...rest,
    ...(can(role, "analytics.view") && activity ? { activity } : {}),
    ...(can(role, "requests.view") && pendingRequests ? { pendingRequests } : {}),
    ...(can(role, "dispensing.view") && recentDispensing
      ? { recentDispensing }
      : {}),
  };
}
