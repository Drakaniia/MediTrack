import { EXPIRY_CLASS_LABELS } from "@shared/expiry";
import type { LowStockStatus } from "@shared/schemas/inventory";
import type { ExpiryReportDto, StockReportDto } from "@shared/schemas/reports";

/** One table of a report: what the screen shows and what PDF / XLSX export write. */
export interface ReportTable {
  body: (number | string)[][];
  head: string[];
  /** Sheet name in the workbook (≤ 31 chars, Excel's limit). */
  name: string;
}

const LOW_STOCK_LABELS: Record<LowStockStatus, string> = {
  in_stock: "OK",
  low: "Low",
  out: "Out",
};

/** Item totals, grouped by category in the order the API sends (Uncategorized last). */
export function stockItemsTable(report: StockReportDto): ReportTable {
  const body: (number | string)[][] = [];
  for (const category of report.categories) {
    for (const item of category.items) {
      body.push([
        category.name,
        item.displayName,
        item.unit,
        item.openingQty,
        item.received,
        item.dispensed,
        item.disposed,
        item.adjusted,
        item.closingQty,
        item.available,
        item.nearestExpiry ?? "",
        LOW_STOCK_LABELS[item.status],
      ]);
    }
  }
  return {
    body,
    head: [
      "Category",
      "Item",
      "Unit",
      "Opening",
      "Received",
      "Dispensed",
      "Disposed",
      "Adjusted",
      "Closing",
      "Available",
      "Nearest expiry",
      "Stock",
    ],
    name: "Stock by item",
  };
}

/** Monthly activity per batch (spec §7.5: dispensing is recorded and reported by batch). */
export function stockBatchesTable(report: StockReportDto): ReportTable {
  const body: (number | string)[][] = [];
  for (const category of report.categories) {
    for (const item of category.items) {
      for (const batch of item.byBatch) {
        body.push([
          item.displayName,
          batch.batchNumber,
          batch.expiry ?? "No expiry",
          EXPIRY_CLASS_LABELS[batch.expiryClass],
          batch.openingQty,
          batch.received,
          batch.dispensed,
          batch.disposed,
          batch.adjusted,
          batch.closingQty,
        ]);
      }
    }
  }
  return {
    body,
    head: [
      "Item",
      "Batch",
      "Expiry",
      "Status",
      "Opening",
      "Received",
      "Dispensed",
      "Disposed",
      "Adjusted",
      "Closing",
    ],
    name: "Stock by batch",
  };
}

export function expiryTable(report: ExpiryReportDto): ReportTable {
  return {
    body: report.rows.map((row) => [
      row.section === "expiring" ? "Expires this month" : "Expired earlier",
      row.itemName,
      row.categoryName,
      row.batchNumber,
      row.expiry,
      row.daysUntilNow,
      EXPIRY_CLASS_LABELS[row.classNow],
      row.qty,
      row.unit,
      row.disposed,
    ]),
    head: [
      "Section",
      "Item",
      "Category",
      "Batch",
      "Expiry",
      "Days left",
      "Status now",
      "Qty",
      "Unit",
      "Disposed",
    ],
    name: "Expiry",
  };
}

export function reportFileName(kind: "expiry" | "stock", month: string, extension: "pdf" | "xlsx"): string {
  return `meditract-${kind}-report-${month}.${extension}`;
}
