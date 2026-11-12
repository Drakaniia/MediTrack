/**
 * Client-side parser for text copied from a spreadsheet or CSV (spec §7.4), limited to
 * what the server's bulk endpoint accepts: it maps
 * columns to `BulkRow` fields and leaves ALL validation to the server, so the rules live in
 * one place.
 *
 * With a header row the columns are matched by name; without one they are read by position
 * (`POSITIONAL_COLUMNS`).
 */

export const BULK_FIELDS = [
  "name",
  "strength",
  "batchNumber",
  "expiry",
  "qty",
  "unit",
  "category",
  "supplier",
  "sku",
  "barcode",
  "threshold",
  "packSize",
  "packUnit",
  "notes",
  "hasExpiry",
  "receivedOn",
] as const;

export type BulkField = (typeof BULK_FIELDS)[number];
export type BulkPayloadRow = Record<BulkField, string>;

/** Column order assumed when the pasted text has no header row. */
export const POSITIONAL_COLUMNS: readonly BulkField[] = [
  "name",
  "strength",
  "batchNumber",
  "expiry",
  "qty",
  "unit",
  "category",
  "supplier",
];

const ALIASES: Record<BulkField, readonly string[]> = {
  barcode: ["barcode", "ean"],
  batchNumber: [
    "batch",
    "lot",
    "lot-no",
    "batch-no",
    "batch-lot",
    "lot-number",
    "batch-number",
    "batchnumber",
  ],
  category: ["category", "group", "class"],
  expiry: ["expiry", "expiry-date", "exp", "exp-date", "expires"],
  hasExpiry: ["has-expiry", "hasexpiry", "expires-at-all", "tracks-expiry"],
  name: [
    "name",
    "product",
    "product-name",
    "medicine",
    "medicine-name",
    "item",
  ],
  notes: ["notes", "note", "comment", "comments"],
  packSize: ["pack-size", "packsize", "pack"],
  packUnit: ["pack-unit", "packunit"],
  qty: ["qty", "quantity", "amount", "count"],
  receivedOn: ["received", "received-on", "receivedon", "date-received"],
  sku: ["sku", "stock-code", "code", "item-code"],
  strength: ["strength", "dose", "dosage"],
  supplier: ["supplier", "vendor", "manufacturer"],
  threshold: ["threshold", "low-stock", "reorder", "reorder-level"],
  unit: ["unit", "uom", "form"],
};

const NOISE = /[^a-z0-9]+/g;
const EDGE_DASH = /^-|-$/g;
const LINE_BREAK = /\r\n?/g;
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const ISO_MONTH = /^(\d{4})-(\d{1,2})$/;
const SLASHED_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
const DOUBLE_QUOTE = /""/g;
/** `""` inside a quoted cell is one literal quote; park it while splitting. */
const QUOTE_PLACEHOLDER = "\u0000";

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(NOISE, "-").replace(EDGE_DASH, "");
}

const FIELD_BY_ALIAS = new Map<string, BulkField>();
for (const field of BULK_FIELDS) {
  for (const alias of [field.toLowerCase(), ...ALIASES[field]]) {
    FIELD_BY_ALIAS.set(normalizeHeader(alias), field);
  }
}

export function fieldForHeader(header: string): BulkField | null {
  return FIELD_BY_ALIAS.get(normalizeHeader(header)) ?? null;
}

/** Quote-aware split for tab- or comma-separated text. */
export function splitCells(line: string, delimiter: string): string[] {
  const text = line.replace(DOUBLE_QUOTE, QUOTE_PLACEHOLDER);
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.replaceAll(QUOTE_PLACEHOLDER, '"').trim());
}

/**
 * Unambiguous date shapes become ISO; anything else is passed through unchanged so the
 * server reports it instead of a guess landing as a date. `01/03/2027` reads as MM/DD/YYYY.
 */
export function normalizePasteDate(value: string): string {
  const text = value.trim();
  if (ISO_DATE_PREFIX.test(text)) {
    return text.slice(0, 10);
  }
  const month = ISO_MONTH.exec(text);
  if (month) {
    return `${month[1]}-${month[2].padStart(2, "0")}-01`;
  }
  const slashed = SLASHED_DATE.exec(text);
  if (slashed) {
    return `${slashed[3]}-${slashed[1].padStart(2, "0")}-${slashed[2].padStart(2, "0")}`;
  }
  return text;
}

export interface ParsedPaste {
  /** True when the first line was read as a header row. */
  hasHeader: boolean;
  rows: BulkPayloadRow[];
  /** Header cells that matched no field (reported, never guessed). */
  unmappedHeaders: string[];
}

function blankRow(): BulkPayloadRow {
  const row = {} as BulkPayloadRow;
  for (const field of BULK_FIELDS) {
    row[field] = "";
  }
  return row;
}

function mapHeaders(headers: readonly string[]): {
  mapping: (BulkField | null)[];
  unmapped: string[];
} {
  const seen = new Set<BulkField>();
  const unmapped: string[] = [];
  const mapping = headers.map((header) => {
    const field = fieldForHeader(header);
    if (field && !seen.has(field)) {
      seen.add(field);
      return field;
    }
    if (header.trim() !== "") {
      unmapped.push(header.trim());
    }
    return null;
  });
  return { mapping, unmapped };
}

function rowFrom(
  cells: readonly string[],
  mapping: readonly (BulkField | null)[]
): BulkPayloadRow {
  const row = blankRow();
  for (const [index, field] of mapping.entries()) {
    if (field) {
      row[field] =
        field === "expiry" || field === "receivedOn"
          ? normalizePasteDate(cells[index] ?? "")
          : (cells[index] ?? "").trim();
    }
  }
  return row;
}

function isEmptyRow(row: BulkPayloadRow): boolean {
  return BULK_FIELDS.every((field) => row[field] === "");
}

export function parsePaste(text: string): ParsedPaste {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const lines = text
    .replace(LINE_BREAK, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const cells = lines.map((line) => splitCells(line, delimiter));
  const [first, ...rest] = cells;
  if (!first) {
    return { hasHeader: false, rows: [], unmappedHeaders: [] };
  }
  const { mapping, unmapped } = mapHeaders(first);
  const hasHeader = mapping.some((field) => field !== null);
  const dataRows = hasHeader ? rest : cells;
  const columns: (BulkField | null)[] = hasHeader
    ? mapping
    : [...POSITIONAL_COLUMNS];
  return {
    hasHeader,
    rows: dataRows
      .map((row) => rowFrom(row, columns))
      .filter((row) => !isEmptyRow(row)),
    unmappedHeaders: hasHeader ? unmapped : [],
  };
}
