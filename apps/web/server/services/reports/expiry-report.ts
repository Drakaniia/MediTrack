/**
 * `GET /api/reports/expiry?month=YYYY-MM` (spec §7.8): batches whose expiry falls inside the
 * month, plus batches that expired earlier and still held stock at the month's end. Each row
 * carries its class at the month's last day and at `asOf`.
 */

import { daysBetween } from "../../../shared/dates";
import { assessExpiry } from "../../../shared/expiry";
import { UNCATEGORIZED_LABEL } from "../../../shared/schemas/analytics";
import type {
  ExpiryReportDto,
  ExpiryReportRowDto,
  ExpiryReportSummaryDto,
} from "../../../shared/schemas/reports";
import type { D1DatabaseLike } from "../../env";
import { type LedgerBatch, loadBatchLedger } from "./batch-ledger";
import { emptyClassSplit } from "./stock-report";
import { loadReportContext, type ReportContext } from "./report-context";
import {
  compareText,
  displayNameOf,
  loadReportItems,
  type ReportItem,
} from "./report-items";

function toRow(
  batch: LedgerBatch & { expiry: string },
  item: ReportItem,
  header: ReportContext["header"]
): ExpiryReportRowDto {
  const atEnd = assessExpiry(batch.expiry, header.monthEnd, header.thresholds);
  const now = assessExpiry(batch.expiry, header.asOf, header.thresholds);
  return {
    batchId: batch.batchId,
    batchNumber: batch.batchNumber,
    categoryId: item.categoryId,
    categoryName: item.categoryName ?? UNCATEGORIZED_LABEL,
    classAtMonthEnd: atEnd.expiryClass,
    classNow: now.expiryClass,
    daysUntilMonthEnd: daysBetween(header.monthEnd, batch.expiry),
    daysUntilNow: daysBetween(header.asOf, batch.expiry),
    disposed: batch.disposed,
    expiry: batch.expiry,
    itemId: item.id,
    itemName: displayNameOf(item),
    openingQty: batch.openingQty,
    qty: batch.closingQty,
    section: batch.expiry >= header.monthStart ? "expiring" : "expired",
    unit: item.unit,
  };
}

function hasExpiry(batch: LedgerBatch): batch is LedgerBatch & { expiry: string } {
  return batch.expiry !== null;
}

/** In the month: held stock at either end of it. Earlier: still holding stock at month end. */
function belongsInReport(
  batch: LedgerBatch & { expiry: string },
  header: ReportContext["header"]
): boolean {
  if (batch.expiry > header.monthEnd) {
    return false;
  }
  if (batch.expiry >= header.monthStart) {
    return batch.closingQty > 0 || batch.openingQty > 0;
  }
  return batch.closingQty > 0;
}

function compareRows(left: ExpiryReportRowDto, right: ExpiryReportRowDto): number {
  if (left.section !== right.section) {
    return left.section === "expiring" ? -1 : 1;
  }
  return (
    left.expiry.localeCompare(right.expiry) ||
    compareText(left.itemName, right.itemName) ||
    compareText(left.batchNumber, right.batchNumber)
  );
}

export function summarizeExpiry(
  rows: readonly ExpiryReportRowDto[]
): ExpiryReportSummaryDto {
  const summary: ExpiryReportSummaryDto = {
    classes: emptyClassSplit(),
    classesNow: emptyClassSplit(),
    expired: { batches: 0, units: 0 },
    expiring: { batches: 0, units: 0 },
    total: { batches: 0, units: 0 },
  };
  for (const row of rows) {
    const section = row.section === "expiring" ? summary.expiring : summary.expired;
    for (const target of [section, summary.total]) {
      target.batches += 1;
      target.units += row.qty;
    }
    summary.classes[row.classAtMonthEnd].batches += 1;
    summary.classes[row.classAtMonthEnd].units += row.qty;
    summary.classesNow[row.classNow].batches += 1;
    summary.classesNow[row.classNow].units += row.qty;
  }
  return summary;
}

export function buildExpiryReport(
  context: ReportContext,
  items: readonly ReportItem[],
  ledger: readonly LedgerBatch[]
): ExpiryReportDto {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows: ExpiryReportRowDto[] = [];
  for (const batch of ledger.filter(hasExpiry)) {
    const item = byId.get(batch.itemId);
    if (item && belongsInReport(batch, context.header)) {
      rows.push(toRow(batch, item, context.header));
    }
  }
  rows.sort(compareRows);
  return { ...context.header, rows, summary: summarizeExpiry(rows) };
}

export async function loadExpiryReport(
  db: D1DatabaseLike,
  input: { month?: string; now: Date }
): Promise<ExpiryReportDto> {
  const context = await loadReportContext(db, input.now, input.month);
  const [items, ledger] = await Promise.all([
    loadReportItems(db),
    loadBatchLedger(db, context),
  ]);
  return buildExpiryReport(context, items, ledger);
}

