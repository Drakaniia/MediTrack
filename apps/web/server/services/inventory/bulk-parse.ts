/**
 * Cell-level parsing and validation of bulk-import rows. Pure: no database, no clock
 * (`today` is passed in). Every problem becomes a `BulkIssueDto` tied to the 1-based row
 * the user sees, so a pasted sheet reports ALL its mistakes at once.
 */

import { isIsoDate } from "../../../shared/dates";
import type { BulkIssueDto } from "../../../shared/schemas/inventory";
import { type BulkRow, MAX_QTY } from "../../../shared/schemas/inventory-input";

export interface ParsedBulkItem {
  barcode: string | null;
  categoryName: string;
  hasExpiry: boolean;
  lowStockThreshold: number;
  name: string;
  notes: string;
  packSize: number | null;
  packUnit: string;
  sku: string | null;
  strength: string;
  supplier: string;
  unit: string;
}

export interface ParsedBulkBatch {
  batchNumber: string;
  expiry: string | null;
  qty: number;
  receivedOn: string;
}

export interface ParsedBulkRow {
  batch: ParsedBulkBatch | null;
  identityKey: string;
  item: ParsedBulkItem;
  /** 1-based, as shown to the user. */
  rowNumber: number;
}

const DIGITS = /^\d+$/;
const THOUSANDS = /,/g;
const FALSE_WORDS = /^(?:no|false|0|n|none)$/i;
const TRUE_WORDS = /^(?:yes|true|1|y)$/i;
const IDENTITY_SEPARATOR = "\u001f";

export function identityKeyOf(name: string, strength: string): string {
  return `${name.toLowerCase()}${IDENTITY_SEPARATOR}${strength.toLowerCase()}`;
}

type Report = (field: string, message: string) => void;

function parseCount(
  value: string,
  min: number,
  field: string,
  report: Report
): number | null {
  if (value === "") {
    return null;
  }
  const digits = value.replace(THOUSANDS, "");
  const parsed = DIGITS.test(digits) ? Number(digits) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > MAX_QTY) {
    report(field, `Use a whole number of ${min} or more.`);
    return null;
  }
  return parsed;
}

function parseHasExpiry(value: string, report: Report): boolean {
  if (value === "" || TRUE_WORDS.test(value)) {
    return true;
  }
  if (FALSE_WORDS.test(value)) {
    return false;
  }
  report("hasExpiry", 'Use "yes" or "no".');
  return true;
}

function parseDate(
  value: string,
  field: string,
  report: Report
): string | null {
  if (value === "") {
    return null;
  }
  if (!isIsoDate(value)) {
    report(field, "Use a real date as YYYY-MM-DD.");
    return null;
  }
  return value;
}

function parseItem(row: BulkRow, report: Report): ParsedBulkItem {
  const threshold = parseCount(row.threshold, 0, "threshold", report);
  return {
    barcode: row.barcode === "" ? null : row.barcode,
    categoryName: row.category,
    hasExpiry: parseHasExpiry(row.hasExpiry, report),
    lowStockThreshold: threshold ?? 0,
    name: row.name,
    notes: row.notes,
    packSize: parseCount(row.packSize, 1, "packSize", report),
    packUnit: row.packUnit,
    sku: row.sku === "" ? null : row.sku,
    strength: row.strength,
    supplier: row.supplier,
    unit: row.unit === "" ? "unit" : row.unit,
  };
}

function hasBatchCells(row: BulkRow): boolean {
  return row.qty !== "" || row.batchNumber !== "" || row.expiry !== "";
}

function parseBatch(
  row: BulkRow,
  today: string,
  report: Report
): ParsedBulkBatch | null {
  if (!hasBatchCells(row)) {
    return null;
  }
  const qty = parseCount(row.qty, 1, "qty", report);
  if (row.qty === "") {
    report("qty", "Enter the quantity received.");
  }
  const expiry = parseDate(row.expiry, "expiry", report);
  const receivedOn = parseDate(row.receivedOn, "receivedOn", report) ?? today;
  return {
    batchNumber: row.batchNumber,
    expiry,
    qty: qty ?? 0,
    receivedOn,
  };
}

export function parseBulkRows(
  rows: readonly BulkRow[],
  today: string
): { issues: BulkIssueDto[]; parsed: ParsedBulkRow[] } {
  const issues: BulkIssueDto[] = [];
  const parsed: ParsedBulkRow[] = [];
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    const report: Report = (field, message) => {
      issues.push({ field, message, row: rowNumber });
    };
    if (row.name === "") {
      report("name", "Enter the product name.");
    }
    const item = parseItem(row, report);
    const batch = parseBatch(row, today, report);
    parsed.push({
      batch,
      identityKey: identityKeyOf(item.name, item.strength),
      item,
      rowNumber,
    });
  }
  return { issues, parsed };
}
