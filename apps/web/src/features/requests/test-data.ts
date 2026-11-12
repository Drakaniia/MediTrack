import type {
  BatchDto,
  ItemDetailDto,
  ItemSummaryDto,
} from "@shared/schemas/inventory";
import type { DispensingRecordDto, RequestDto } from "@shared/schemas/requests";

/** Factories for the REQ component tests (not shipped code paths). */

let sequence = 0;

function next(): number {
  sequence += 1;
  return sequence;
}

export function makeRequest(overrides: Partial<RequestDto> = {}): RequestDto {
  const n = next();
  return {
    archivedAt: null,
    availableNow: 20,
    boardPosition: n,
    claimedAt: null,
    code: `REQ-2026-${String(n).padStart(4, "0")}`,
    deniedNote: "",
    deniedReason: null,
    dispensedQty: 0,
    dispensing: [],
    events: [],
    id: `req-${n}`,
    itemId: "item-1",
    itemName: "Paracetamol 500 mg",
    qty: 5,
    reason: "",
    remaining: 5,
    requestedBy: "user-nurse",
    requestedByName: "Test Nurse",
    requestor: { email: "", name: "Ana", ref: "" },
    source: "queue",
    status: "pending",
    submittedAt: "2026-11-12T02:00:00.000Z",
    unit: "tab",
    updatedAt: "2026-11-12T02:00:00.000Z",
    ...overrides,
  };
}

export function makeItem(
  overrides: Partial<ItemSummaryDto> = {}
): ItemSummaryDto {
  return {
    available: 20,
    barcode: null,
    batchCount: 2,
    categoryId: null,
    categoryName: null,
    displayName: "Paracetamol 500 mg",
    hasExpiry: true,
    id: "item-1",
    lowStock: "in_stock",
    lowStockThreshold: 0,
    name: "Paracetamol",
    nearestExpiry: "2026-12-01",
    onHand: 20,
    packSize: null,
    packUnit: "",
    sku: null,
    strength: "500 mg",
    supplier: "",
    unit: "tab",
    updatedAt: "2026-11-01T00:00:00.000Z",
    worstClass: "near_expiry",
    ...overrides,
  };
}

export function makeBatch(overrides: Partial<BatchDto> = {}): BatchDto {
  const n = next();
  return {
    barcode: null,
    batchNumber: `LOT-${n}`,
    code: `CODE${String(n).padStart(6, "0")}`,
    createdAt: "2026-11-01T00:00:00.000Z",
    daysUntil: 19,
    expiry: "2026-12-01",
    expiryClass: "near_expiry",
    fefoRank: 1,
    id: `batch-${n}`,
    initialQty: 10,
    itemId: "item-1",
    qty: 10,
    quarantined: false,
    receivedOn: "2026-11-01",
    status: "active",
    supplier: "",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeItemDetail(
  batches: BatchDto[],
  overrides: Partial<ItemSummaryDto> = {}
): ItemDetailDto {
  return { ...makeItem(overrides), batches, notes: "" };
}

export function makeRecord(
  overrides: Partial<DispensingRecordDto> = {}
): DispensingRecordDto {
  const n = next();
  return {
    dispensedAt: "2026-11-12T02:00:00.000Z",
    dispensedBy: "user-pharmacist",
    dispensedByName: "Test Pharmacist",
    id: `rec-${n}`,
    itemId: "item-1",
    itemName: "Paracetamol 500 mg",
    lines: [
      {
        batchId: "batch-1",
        batchNumber: "LOT-A",
        expiry: "2026-12-01",
        id: `line-${n}`,
        qty: 3,
      },
    ],
    note: "",
    qty: 3,
    recipientName: "",
    requestCode: null,
    requestId: null,
    source: "queue",
    undoneAt: null,
    undoneBy: null,
    unit: "tab",
    ...overrides,
  };
}
