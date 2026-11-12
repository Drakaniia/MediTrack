/**
 * Tiny SQL text builders. The seeds produce a `.sql` FILE for `wrangler d1 execute --file`,
 * so values are inlined as escaped literals (there is nowhere to bind them). Every value in
 * the demo dataset is trusted repository data; the admin values are validated before they
 * get here. Statements are emitted one per line, because that is the one shape every D1
 * entry point (wrangler local, wrangler remote import, node:sqlite) agrees on.
 */

import { SeedError } from "./errors.mjs";

const LINE_BREAKS = /\r?\n|\r/gu;
const NUL = "\u0000";
const DEFAULT_CHUNK = 20;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SeedError(`Cannot write a non-finite number to SQL: ${value}`);
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value !== "string") {
    throw new SeedError(`Cannot write a ${typeof value} to SQL.`);
  }
  if (value.includes(NUL)) {
    throw new SeedError("A SQL string contains a NUL character.");
  }
  return `'${value.replaceAll("'", "''").replace(LINE_BREAKS, " ")}'`;
}

/**
 * @param {string} table
 * @param {string[]} columns
 * @param {Record<string, unknown>} row
 */
function tupleOf(table, columns, row) {
  const keys = Object.keys(row);
  const sameShape =
    keys.length === columns.length &&
    keys.every((key, index) => key === columns[index]);
  if (!sameShape) {
    throw new SeedError(`Rows of ${table} do not share the same columns.`);
  }
  return `(${columns.map((column) => sqlValue(row[column])).join(", ")})`;
}

/**
 * One `INSERT … VALUES …` statement per `chunkSize` rows. Columns come from the first row;
 * every row must have the same keys in the same order.
 * @param {string} table
 * @param {readonly Record<string, unknown>[]} rows
 * @param {number} [chunkSize]
 * @returns {string[]}
 */
export function insertStatements(table, rows, chunkSize = DEFAULT_CHUNK) {
  if (rows.length === 0) {
    return [];
  }
  const columns = Object.keys(rows[0]);
  const statements = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const tuples = rows
      .slice(start, start + chunkSize)
      .map((row) => tupleOf(table, columns, row));
    statements.push(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")};`
    );
  }
  return statements;
}
