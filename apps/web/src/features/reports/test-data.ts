import type { AnalyticsDto } from "@shared/schemas/analytics";
import type { ExpiryReportDto, StockReportDto } from "@shared/schemas/reports";

const ZERO = { batches: 0, units: 0 };
const CLASSES = { expired: ZERO, near_expiry: ZERO, safe: ZERO, urgent: ZERO };

const HEADER = {
  asOf: "2026-11-12",
  facilityName: "Rizal Clinic",
  generatedAt: "2026-11-12T02:00:00.000Z",
  month: "2026-11",
  monthEnd: "2026-11-30",
  monthStart: "2026-11-01",
  thresholds: { nearDays: 30, urgentDays: 7 },
  timezone: "Asia/Manila",
  today: "2026-11-12",
};

export const STOCK_REPORT: StockReportDto = {
  ...HEADER,
  categories: [
    {
      categoryId: "c1",
      items: [
        {
          adjusted: -1,
          available: 30,
          batchCount: 2,
          byBatch: [
            {
              adjusted: -1,
              batchId: "b1",
              batchNumber: "A-1",
              closingQty: 10,
              dispensed: 5,
              disposed: 0,
              expiry: "2026-11-20",
              expiryClass: "near_expiry",
              openingQty: 16,
              received: 0,
            },
            {
              adjusted: 0,
              batchId: "b2",
              batchNumber: "A-2",
              closingQty: 20,
              dispensed: 0,
              disposed: 0,
              expiry: null,
              expiryClass: "safe",
              openingQty: 0,
              received: 20,
            },
          ],
          categoryId: "c1",
          classCounts: CLASSES,
          closingQty: 30,
          dispensed: 5,
          disposed: 0,
          displayName: "Paracetamol 500 mg",
          itemId: "i1",
          name: "Paracetamol",
          nearestExpiry: "2026-11-20",
          onHand: 30,
          openingQty: 16,
          received: 20,
          status: "low",
          strength: "500 mg",
          threshold: 50,
          unit: "tablet",
        },
      ],
      name: "Analgesics",
    },
  ],
  summary: {
    categories: 1,
    classes: CLASSES,
    dispensed: 5,
    disposed: 0,
    lowStockItems: 1,
    lowStockOut: 0,
    medicines: 1,
    received: 20,
    units: 30,
  },
};

export const EXPIRY_REPORT: ExpiryReportDto = {
  ...HEADER,
  rows: [
    {
      batchId: "b1",
      batchNumber: "A-1",
      categoryId: null,
      categoryName: "Uncategorized",
      classAtMonthEnd: "expired",
      classNow: "near_expiry",
      daysUntilMonthEnd: -10,
      daysUntilNow: 8,
      disposed: 0,
      expiry: "2026-11-20",
      itemId: "i1",
      itemName: "Paracetamol 500 mg",
      openingQty: 16,
      qty: 10,
      section: "expiring",
      unit: "tablet",
    },
  ],
  summary: {
    classes: CLASSES,
    classesNow: CLASSES,
    expired: ZERO,
    expiring: { batches: 1, units: 10 },
    total: ZERO,
  },
};

export const ANALYTICS: AnalyticsDto = {
  categoryId: null,
  dispensedVsRequested: {
    buckets: [{ dispensed: 3, from: "2026-11-06", requested: 4, to: "2026-11-12" }],
    granularity: "week",
  },
  expiryTimeline: {
    earlier: ZERO,
    months: [{ ...ZERO, classes: CLASSES, month: "2026-11" }],
  },
  generatedAt: "2026-11-12T02:00:00.000Z",
  lowStockTrend: {
    days: [{ date: "2026-11-12", out: 1, underThreshold: 2 }],
    itemsTracked: 5,
  },
  range: { days: 7, from: "2026-11-06", to: "2026-11-12" },
  stockMovement: {
    days: [{ adjusted: 0, date: "2026-11-12", dispensed: 5, disposed: 0, received: 20 }],
  },
  thresholds: { nearDays: 30, urgentDays: 7 },
  timezone: "Asia/Manila",
  today: "2026-11-12",
  topDispensed: [
    {
      batchCount: 1,
      batches: [{ batchNumber: "A-1", units: 5 }],
      itemId: "i1",
      name: "Paracetamol 500 mg",
      unit: "tablet",
      units: 5,
    },
  ],
  usage: {
    slices: [{ categoryId: "c1", name: "Analgesics", units: 5 }],
    totalUnits: 5,
  },
};
