/**
 * Batch guards and database-error classification (ARCHITECTURE.md §2.7).
 *
 * A D1 `batch()` is one transaction: if any statement throws, everything before it is
 * rolled back. Two things can make a precondition throw:
 *
 *  - a table constraint (`CHECK (qty >= 0)`, a UNIQUE index), or
 *  - `guardChanged()`: a statement that RAISES when the previous write did not change
 *    exactly the expected number of rows (`UPDATE … WHERE id = ? AND status = 'pending'`
 *    matched nothing because someone else got there first).
 *
 * `batchOrConflict()` turns both into the HTTP error the caller chose, so the slice never
 * has to match on driver messages.
 */

import type { D1DatabaseLike, D1PreparedStatement, D1Result } from "./env";
import type { HttpError } from "./http";

/**
 * `abs()` of the most negative 64-bit integer overflows, which SQLite reports as an error
 * ("integer overflow"). It is the only way to make a plain statement abort a transaction.
 */
const GUARD_SQL =
  "SELECT CASE WHEN changes() = ? THEN 1 ELSE abs(-9223372036854775808) END";

const GUARD_FAILURE = /integer overflow/i;
const CHECK_VIOLATION = /CHECK constraint failed/i;
const UNIQUE_VIOLATION = /UNIQUE constraint failed/i;
const MAX_CAUSE_DEPTH = 5;

/**
 * Put right after a write inside `db.batch`: aborts (and rolls back) the whole batch when
 * that write changed a number of rows other than `expected`.
 */
export function guardChanged(
  db: D1DatabaseLike,
  expected = 1
): D1PreparedStatement {
  return db.prepare(GUARD_SQL).bind(expected);
}

function messageOf(value: unknown): string | null {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    const { message } = value as { message: unknown };
    return typeof message === "string" ? message : null;
  }
  return null;
}

/** The error's message plus the messages of its `cause` chain (D1 wraps driver errors). */
function messageChain(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current !== undefined;
    depth += 1
  ) {
    const message = messageOf(current);
    if (message !== null) {
      messages.push(message);
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join(" | ");
}

/** True when `error` came from a failed `guardChanged()`. */
export function isGuardFailure(error: unknown): boolean {
  return GUARD_FAILURE.test(messageChain(error));
}

/** True for `CHECK (…)` constraint violations such as a negative `batches.qty`. */
export function isCheckViolation(error: unknown): boolean {
  return CHECK_VIOLATION.test(messageChain(error));
}

/**
 * True for UNIQUE / PRIMARY KEY violations. `columnHint` narrows it to one column or index
 * name (e.g. `"users.email_lower"`, `"uq_items_identity"`), matched as a substring.
 */
export function isUniqueViolation(
  error: unknown,
  columnHint?: string
): boolean {
  const text = messageChain(error);
  if (!UNIQUE_VIOLATION.test(text)) {
    return false;
  }
  return columnHint === undefined || text.includes(columnHint);
}

/**
 * Runs `statements` as one atomic batch. A failed guard or a CHECK violation (both mean
 * "the world changed under us") throws `conflict`; every other failure is rethrown as is.
 */
export async function batchOrConflict(
  db: D1DatabaseLike,
  statements: D1PreparedStatement[],
  conflict: HttpError
): Promise<D1Result[]> {
  try {
    return await db.batch(statements);
  } catch (error) {
    if (isGuardFailure(error) || isCheckViolation(error)) {
      throw conflict;
    }
    throw error;
  }
}
