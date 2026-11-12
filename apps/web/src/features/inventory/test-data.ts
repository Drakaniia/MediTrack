import type {
  BatchDto,
  ItemDetailDto,
  ItemSummaryDto,
} from "@shared/schemas/inventory";

/** DTO factories for component tests. */

export function makeBatch(overrides: Partial<BatchDto> = {}): BatchDto {
  return {
    barcode: null,
    batchNumber: "LOT-1",
    code: "ABCDEFGHJK",
    createdAt: "2026-11-01T00:00:00.000Z",
    daysUntil: 120,
    expiry: "2027-03-12",
    expiryClass: "safe",
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
    ...overrides,
  };
}

export function makeItem(
  overrides: Partial<ItemSummaryDto> = {}
): ItemSummaryDto {
  return {
    available: 40,
    barcode: null,
    batchCount: 1,
    categoryId: null,
    categoryName: "Analgesic",
    displayName: "Paracetamol 500 mg",
    hasExpiry: true,
    id: "item-1",
    lowStock: "in_stock",
    lowStockThreshold: 10,
    name: "Paracetamol",
    nearestExpiry: "2027-03-12",
    onHand: 40,
    packSize: null,
    packUnit: "",
    sku: null,
    strength: "500 mg",
    supplier: "",
    unit: "tab",
    updatedAt: "2026-11-01T00:00:00.000Z",
    worstClass: "safe",
    ...overrides,
  };
}

export function makeDetail(
  overrides: Partial<ItemDetailDto> = {}
): ItemDetailDto {
  return {
    ...makeItem(),
    batches: [makeBatch()],
    notes: "",
    ...overrides,
  };
}
