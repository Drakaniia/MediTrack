import { batchNumberKey, normalizeBatchNumber } from "@shared/batch-code";
import { isIsoDate } from "@shared/dates";

/** One editable batch line on the Add stock page. Text fields stay strings until submit. */
export interface BatchDraftRow {
  batchNumber: string;
  expiry: string;
  key: string;
  qty: string;
  supplier: string;
}

export interface RowError {
  batchNumber?: string;
  expiry?: string;
  qty?: string;
}

const WHOLE_NUMBER = /^\d+$/;
const TRAILING_SEQUENCE = /^(.*?)(\d+)$/;
const MAX_QTY = 10_000_000;

let rowCounter = 0;

export function newBatchRow(init: Partial<BatchDraftRow> = {}): BatchDraftRow {
  rowCounter += 1;
  return {
    batchNumber: "",
    expiry: "",
    key: `row-${rowCounter}`,
    qty: "",
    supplier: "",
    ...init,
  };
}

export function parseQty(text: string): number | null {
  const trimmed = text.trim();
  if (!WHOLE_NUMBER.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_QTY ? value : null;
}

/**
 * Field errors for every row. Callers show them ONLY after the user has pressed submit
 * (spec §7.4), so this is safe to compute on every render.
 */
export function validateRows(
  rows: readonly BatchDraftRow[],
  hasExpiry: boolean
): Map<string, RowError> {
  const errors = new Map<string, RowError>();
  const seen = new Set<string>();
  for (const row of rows) {
    const error: RowError = {};
    if (parseQty(row.qty) === null) {
      error.qty = "Enter a whole quantity of 1 or more.";
    }
    if (hasExpiry && !isIsoDate(row.expiry)) {
      error.expiry = "Enter a real expiry date.";
    }
    const key = batchNumberKey(row.batchNumber);
    if (key !== "") {
      if (seen.has(key)) {
        error.batchNumber = "This batch number is used twice.";
      }
      seen.add(key);
    }
    if (Object.keys(error).length > 0) {
      errors.set(row.key, error);
    }
  }
  return errors;
}

/**
 * Makes `suggestion` unique among `taken` by raising its trailing sequence number, so two
 * unsaved rows never get the same automatic number. `PAR-261112-01` → `PAR-261112-02`.
 */
export function bumpSuggestion(
  suggestion: string,
  taken: readonly string[]
): string {
  const used = new Set(taken.map(batchNumberKey));
  const match = TRAILING_SEQUENCE.exec(suggestion);
  if (!(match && used.has(batchNumberKey(suggestion)))) {
    return suggestion;
  }
  const [, prefix, digits] = match;
  let next = Number(digits);
  let candidate = suggestion;
  while (used.has(batchNumberKey(candidate))) {
    next += 1;
    candidate = `${prefix}${String(next).padStart(digits.length, "0")}`;
  }
  return candidate;
}

export function otherNumbers(
  rows: readonly BatchDraftRow[],
  exceptKey: string
): string[] {
  return rows
    .filter((row) => row.key !== exceptKey && row.batchNumber.trim() !== "")
    .map((row) => normalizeBatchNumber(row.batchNumber));
}
