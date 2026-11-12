import type {
  DisposalDto,
  ExpiryRowDto,
  ExpirySummaryDto,
  LowStockRowDto,
  QuarantineRowDto,
} from "@shared/schemas/expiry";
import type { BatchDto } from "@shared/schemas/inventory";

/** The `BatchDto` the adjust endpoint answers with. */
export function makeBatchDto(overrides: Partial<BatchDto> = {}): BatchDto {
  return {
    barcode: null,
    batchNumber: "LOT-1",
    code: "ABCDEFGHJK",
    createdAt: "2026-11-01T00:00:00.000Z",
    daysUntil: 120,
    expiry: "2027-03-12",
    expiryClass: "safe",
    fefoRank: 1,
    id: "b-1",
    initialQty: 40,
    itemId: "item-1",
    qty: 40,
    quarantined: false,
    receivedOn: "2026-11-01",
    status: "active",
    supplier: "",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

/** DTO factories for component tests. */

export function makeExpiryRow(
  overrides: Partial<ExpiryRowDto> = {}
): ExpiryRowDto {
  return {
    batchId: "batch-1",
    batchNumber: "LOT-1",
    categoryId: "cat-1",
    categoryName: "Analgesic",
    code: "ABCDEFGHJK",
    daysUntil: 5,
    displayName: "Paracetamol 500 mg",
    expiry: "2026-11-17",
    expiryClass: "urgent",
    fefoRank: 1,
    itemId: "item-1",
    itemName: "Paracetamol",
    qty: 40,
    quarantined: false,
    status: "active",
    unit: "tab",
    ...overrides,
  };
}

export function makeSummary(
  overrides: Partial<ExpirySummaryDto> = {}
): ExpirySummaryDto {
  return {
    counts: {
      expired: { batches: 1, units: 6 },
      near_expiry: { batches: 4, units: 120 },
      safe: { batches: 30, units: 900 },
      urgent: { batches: 2, units: 45 },
    },
    expiringThisMonth: { batches: 3, units: 51 },
    month: "2026-11",
    thresholds: { nearDays: 30, urgentDays: 7 },
    today: "2026-11-12",
    ...overrides,
  };
}

export function makeLowStockRow(
  overrides: Partial<LowStockRowDto> = {}
): LowStockRowDto {
  return {
    available: 4,
    categoryId: "cat-1",
    categoryName: "Antibiotic",
    displayName: "Amoxicillin 500 mg",
    gap: 6,
    itemId: "item-2",
    lowStockThreshold: 10,
    name: "Amoxicillin",
    nearestExpiry: "2027-01-15",
    onHand: 4,
    status: "low",
    strength: "500 mg",
    suggestedReorderQty: 16,
    supplier: "MediSupply",
    unit: "cap",
    ...overrides,
  };
}

export function makeQuarantineRow(
  overrides: Partial<QuarantineRowDto> = {}
): QuarantineRowDto {
  return {
    batchId: "batch-9",
    batchNumber: "OLD-9",
    canDispose: true,
    categoryId: "cat-1",
    categoryName: "Analgesic",
    code: "ZYXWVUTSRQ",
    daysOverdue: 12,
    displayName: "Ibuprofen 200 mg",
    expiry: "2026-10-31",
    itemId: "item-3",
    itemName: "Ibuprofen",
    qty: 6,
    unit: "tab",
    ...overrides,
  };
}

export function makeDisposal(
  overrides: Partial<DisposalDto> = {}
): DisposalDto {
  return {
    batchId: "batch-8",
    batchNumber: "GONE-8",
    disposedAt: "2026-11-10T02:00:00.000Z",
    disposedByName: "Test Admin",
    expiry: "2026-10-01",
    id: "disposal-1",
    itemId: "item-4",
    itemName: "Gauze",
    note: "",
    qty: 20,
    reason: "expired",
    ...overrides,
  };
}
