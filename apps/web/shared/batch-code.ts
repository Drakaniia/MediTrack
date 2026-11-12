/**
 * Batch identifiers (spec §7.3).
 *
 * - The batch CODE is a short opaque Crockford base32 string, the only thing a
 *   QR label encodes. It is unique in the database and generated here.
 * - The batch NUMBER is the human/manufacturer lot number. It is unique per
 *   item, compared trimmed and case-insensitively (`batch_number_lower`).
 *
 * Web APIs only (`crypto.getRandomValues`); randomness is injectable for tests.
 */

import { isIsoDate } from "./dates";

export const BATCH_CODE_LENGTH = 10;

/** Crockford base32: no I, L, O or U. */
export const BATCH_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const SYMBOL_COUNT = 32;
const MAX_INITIALS = 3;
const FALLBACK_INITIALS = "ITM";
const SEQUENCE_WIDTH = 2;

const BATCH_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const CODE_PREFIX = /^MT\s*[:-]\s*/;
const CODE_SEPARATORS = /[\s-]+/g;
const CONFUSABLE_ONE = /[IL]/g;
const CONFUSABLE_ZERO = /O/g;
const COMBINING_MARKS = /\p{M}+/gu;
const NON_LETTERS = /[^A-Z]+/;
const WHITESPACE_RUN = /\s+/g;

export type RandomBytes = (length: number) => Uint8Array;

const cryptoRandomBytes: RandomBytes = (length) =>
  crypto.getRandomValues(new Uint8Array(length));

/**
 * A fresh 10-character code (50 bits). One random byte per symbol, keeping the
 * value modulo 32 (its low 5 bits): 32 divides 256, so every symbol is exactly equally likely and no
 * rejection sampling is needed. Callers retry on a UNIQUE violation.
 */
export function generateBatchCode(
  random: RandomBytes = cryptoRandomBytes
): string {
  const bytes = random(BATCH_CODE_LENGTH);
  if (bytes.length < BATCH_CODE_LENGTH) {
    throw new Error(
      `Random source returned ${bytes.length} bytes, need ${BATCH_CODE_LENGTH}.`
    );
  }
  let code = "";
  for (let index = 0; index < BATCH_CODE_LENGTH; index += 1) {
    code += BATCH_CODE_ALPHABET.charAt(bytes[index] % SYMBOL_COUNT);
  }
  return code;
}

/**
 * Canonical form of whatever a person typed or a scanner sent: trimmed,
 * upper-case, an optional `MT:`/`MT-` prefix dropped, spaces and hyphens
 * removed, and Crockford's look-alikes mapped (I, L → 1; O → 0).
 */
export function normalizeBatchCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(CODE_PREFIX, "")
    .replace(CODE_SEPARATORS, "")
    .replace(CONFUSABLE_ONE, "1")
    .replace(CONFUSABLE_ZERO, "0");
}

export function isBatchCode(input: string): boolean {
  return BATCH_CODE_PATTERN.test(normalizeBatchCode(input));
}

/** `ABCDE-FGHJK`; anything that is not a valid code comes back normalised but ungrouped. */
export function formatBatchCodeForDisplay(code: string): string {
  const normalized = normalizeBatchCode(code);
  if (!BATCH_CODE_PATTERN.test(normalized)) {
    return normalized;
  }
  const half = BATCH_CODE_LENGTH / 2;
  return `${normalized.slice(0, half)}-${normalized.slice(half)}`;
}

/** The QR encodes only the bare normalised code, nothing else. */
export function qrPayloadForBatch(code: string): string {
  return normalizeBatchCode(code);
}

/** Trimmed, internal whitespace collapsed: what the unique index compares (lower-cased). */
export function normalizeBatchNumber(input: string): string {
  return input.trim().replace(WHITESPACE_RUN, " ");
}

/** The comparison key stored as `batch_number_lower`. */
export function batchNumberKey(input: string): string {
  return normalizeBatchNumber(input).toLowerCase();
}

export function batchNumbersEqual(a: string, b: string): boolean {
  return batchNumberKey(a) === batchNumberKey(b);
}

export interface SuggestBatchNumberInput {
  existingNumbers: readonly string[];
  itemName: string;
  /** `YYYY-MM-DD`. */
  receivedOn: string;
}

function initialsOf(itemName: string): string {
  const words = itemName
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toUpperCase()
    .split(NON_LETTERS)
    .filter((word) => word !== "");
  if (words.length === 0) {
    return FALLBACK_INITIALS;
  }
  if (words.length === 1) {
    return words[0].slice(0, MAX_INITIALS);
  }
  return words
    .slice(0, MAX_INITIALS)
    .map((word) => word.charAt(0))
    .join("");
}

function compactDate(receivedOn: string): string {
  if (!isIsoDate(receivedOn)) {
    throw new RangeError(`Invalid ISO date: ${String(receivedOn)}`);
  }
  return `${receivedOn.slice(2, 4)}${receivedOn.slice(5, 7)}${receivedOn.slice(8, 10)}`;
}

/**
 * The automatic batch number when the user leaves it blank:
 * `<INITIALS>-<YYMMDD>-<NN>`, e.g. `PM-261112-01`. NN is the smallest number
 * (at least two digits) not already used, compared case-insensitively.
 * Initials are the first letter of up to three words of the item name; a
 * one-word name contributes its first three letters; no letters gives `ITM`.
 */
export function suggestBatchNumber(input: SuggestBatchNumberInput): string {
  const prefix = `${initialsOf(input.itemName)}-${compactDate(input.receivedOn)}`;
  const used = new Set(input.existingNumbers.map(batchNumberKey));
  for (let sequence = 1; ; sequence += 1) {
    const candidate = `${prefix}-${String(sequence).padStart(SEQUENCE_WIDTH, "0")}`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}
