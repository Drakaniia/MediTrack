/**
 * `GET /api/reports/stock?month=YYYY-MM` (spec §7.8): per item, grouped by category, with the
 * month's activity aggregated PER BATCH (spec §7.5). Three statements: settings, items, batches
 * with their ledger aggregate.
 */

import {
  assessExpiry,
  EXPIRY_CLASSES,
  type ExpiryClass,
  type ExpiryThresholds,
} from "../../../shared/expiry";
import { classifyLowStock } from "../../../shared/low-stock";
import {
  UNCATEGORIZED_LABEL,
} from "../../../shared/schemas/analytics";
import type {
  ReportClassSplitDto,
  StockReportBatchDto,
  StockReportCategoryDto,
  StockReportDto,
  StockReportItemDto,
  StockReportSummaryDto,
} from "../../../shared/schemas/reports";
import type { D1DatabaseLike } from "../../env";
import {
  isRelevantBatch,
  type LedgerBatch,
  loadBatchLedger,
} from "./batch-ledger";
import { loadReportContext, type ReportContext } from "./report-context";
import {
  compareText,
  displayNameOf,
  loadReportItems,
  type ReportItem,
} from "./report-items";

export function emptyClassSplit(): ReportClassSplitDto {
  const split = {} as ReportClassSplitDto;
  for (const expiryClass of EXPIRY_CLASSES) {
    split[expiryClass] = { batches: 0, units: 0 };
  }
  return split;
}

/** No expiry last, then earliest first, then batch number. */
function compareBatches(left: LedgerBatch, right: LedgerBatch): number {
  if (left.expiry !== right.expiry) {
    if (left.expiry === null) {
      return 1;
    }
    if (right.expiry === null) {
      return -1;
    }
    return left.expiry < right.expiry ? -1 : 1;
  }
  return compareText(left.batchNumber, right.batchNumber);
}

function classOf(
  expiry: string | null,
  asOf: string,
  thresholds: ExpiryThresholds
): ExpiryClass {
  return assessExpiry(expiry, asOf, thresholds).expiryClass;
}

function toBatchDto(
  batch: LedgerBatch,
  asOf: string,
  thresholds: ExpiryThresholds
): StockReportBatchDto {
  return {
    adjusted: batch.adjusted,
    batchId: batch.batchId,
    batchNumber: batch.batchNumber,
    closingQty: batch.closingQty,
    dispensed: batch.dispensed,
    disposed: batch.disposed,
    expiry: batch.expiry,
    expiryClass: classOf(batch.expiry, asOf, thresholds),
    openingQty: batch.openingQty,
    received: batch.received,
  };
}

function sum(
  batches: readonly LedgerBatch[],
  pick: (batch: LedgerBatch) => number
): number {
  return batches.reduce((total, batch) => total + pick(batch), 0);
}

function nearestExpiry(
  holding: readonly LedgerBatch[],
  asOf: string
): string | null {
  let nearest: string | null = null;
  for (const batch of holding) {
    const { expiry } = batch;
    if (expiry !== null && expiry >= asOf && (nearest === null || expiry < nearest)) {
      nearest = expiry;
    }
  }
  return nearest;
}

export function buildItemRow(
  item: ReportItem,
  batches: readonly LedgerBatch[],
  header: Pick<StockReportDto, "asOf" | "thresholds">
): StockReportItemDto {
  const { asOf, thresholds } = header;
  const listed = batches.filter(isRelevantBatch).sort(compareBatches);
  const holding = listed.filter((batch) => batch.closingQty > 0);
  const classCounts = emptyClassSplit();
  for (const batch of holding) {
    const count = classCounts[classOf(batch.expiry, asOf, thresholds)];
    count.batches += 1;
    count.units += batch.closingQty;
  }
  const onHand = sum(holding, (batch) => batch.closingQty);
  const available = sum(
    holding.filter((batch) => batch.expiry === null || batch.expiry >= asOf),
    (batch) => batch.closingQty
  );
  return {
    adjusted: sum(listed, (batch) => batch.adjusted),
    available,
    batchCount: holding.length,
    byBatch: listed.map((batch) => toBatchDto(batch, asOf, thresholds)),
    categoryId: item.categoryId,
    classCounts,
    closingQty: onHand,
    dispensed: sum(listed, (batch) => batch.dispensed),
    disposed: sum(listed, (batch) => batch.disposed),
    displayName: displayNameOf(item),
    itemId: item.id,
    name: item.name,
    nearestExpiry: nearestExpiry(holding, asOf),
    onHand,
    openingQty: sum(listed, (batch) => batch.openingQty),
    received: sum(listed, (batch) => batch.received),
    status: classifyLowStock({ available, threshold: item.threshold }),
    strength: item.strength,
    threshold: item.threshold,
    unit: item.unit,
  };
}

function compareItems(left: StockReportItemDto, right: StockReportItemDto): number {
  return (
    compareText(left.name, right.name) ||
    compareText(left.strength, right.strength) ||
    left.itemId.localeCompare(right.itemId)
  );
}

/** Categories in their configured order, Uncategorized last; items by name. */
export function groupByCategory(
  items: readonly ReportItem[],
  rows: ReadonlyMap<string, StockReportItemDto>
): StockReportCategoryDto[] {
  const groups = new Map<
    string,
    { order: number; group: StockReportCategoryDto }
  >();
  for (const item of items) {
    const row = rows.get(item.id);
    if (!row) {
      continue;
    }
    const key = item.categoryId ?? "";
    const entry = groups.get(key) ?? {
      group: {
        categoryId: item.categoryId,
        items: [],
        name: item.categoryName ?? UNCATEGORIZED_LABEL,
      },
      order: item.categoryOrder,
    };
    entry.group.items.push(row);
    groups.set(key, entry);
  }
  return [...groups.values()]
    .sort((left, right) => {
      if (left.group.categoryId === null || right.group.categoryId === null) {
        return Number(left.group.categoryId === null) - Number(right.group.categoryId === null);
      }
      return left.order - right.order || compareText(left.group.name, right.group.name);
    })
    .map(({ group }) => ({ ...group, items: group.items.sort(compareItems) }));
}

export function summarize(
  categories: readonly StockReportCategoryDto[]
): StockReportSummaryDto {
  const summary: StockReportSummaryDto = {
    categories: categories.length,
    classes: emptyClassSplit(),
    dispensed: 0,
    disposed: 0,
    lowStockItems: 0,
    lowStockOut: 0,
    medicines: 0,
    received: 0,
    units: 0,
  };
  for (const category of categories) {
    for (const item of category.items) {
      summary.medicines += 1;
      summary.units += item.onHand;
      summary.received += item.received;
      summary.dispensed += item.dispensed;
      summary.disposed += item.disposed;
      summary.lowStockItems += item.status === "in_stock" ? 0 : 1;
      summary.lowStockOut += item.status === "out" ? 1 : 0;
      for (const expiryClass of EXPIRY_CLASSES) {
        summary.classes[expiryClass].batches += item.classCounts[expiryClass].batches;
        summary.classes[expiryClass].units += item.classCounts[expiryClass].units;
      }
    }
  }
  return summary;
}

export function buildStockReport(
  context: ReportContext,
  items: readonly ReportItem[],
  ledger: readonly LedgerBatch[]
): StockReportDto {
  const byItem = new Map<string, LedgerBatch[]>();
  for (const batch of ledger) {
    const list = byItem.get(batch.itemId) ?? [];
    list.push(batch);
    byItem.set(batch.itemId, list);
  }
  const rows = new Map<string, StockReportItemDto>();
  for (const item of items) {
    rows.set(item.id, buildItemRow(item, byItem.get(item.id) ?? [], context.header));
  }
  const categories = groupByCategory(items, rows);
  return { ...context.header, categories, summary: summarize(categories) };
}

export async function loadStockReport(
  db: D1DatabaseLike,
  input: { month?: string; now: Date }
): Promise<StockReportDto> {
  const context = await loadReportContext(db, input.now, input.month);
  const [items, ledger] = await Promise.all([
    loadReportItems(db),
    loadBatchLedger(db, context),
  ]);
  return buildStockReport(context, items, ledger);
}
