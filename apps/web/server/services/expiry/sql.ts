/** Small SQL building blocks shared by the EXP queries. Everything bound, identifiers whitelisted. */

import { escapeLike } from "../../http";

/** `WHERE` pieces: SQL text with `?` placeholders and the values to bind, in order. */
export interface Clause {
  params: unknown[];
  sql: string;
}

/** Live (not trashed), active batches that still hold stock, on a live item. */
export const LIVE_STOCK_BATCH =
  "b.deleted_at IS NULL AND b.status = 'active' AND b.qty > 0 AND i.deleted_at IS NULL";

export const BATCH_JOINS =
  "FROM batches b JOIN items i ON i.id = b.item_id LEFT JOIN categories c ON c.id = i.category_id";

/** A `LIKE` pattern for case-insensitive substring search (use with `ESCAPE '\'`). */
export function likePattern(text: string): string {
  return `%${escapeLike(text.toLowerCase())}%`;
}

/** Appends `AND`-joined clauses to a base condition. */
export function joinWhere(base: string, clauses: readonly Clause[]): Clause {
  const parts = [base, ...clauses.map((clause) => `(${clause.sql})`)];
  return {
    params: clauses.flatMap((clause) => clause.params),
    sql: parts.join(" AND "),
  };
}

export function categoryClause(categoryId: string | undefined): Clause | null {
  return categoryId === undefined
    ? null
    : { params: [categoryId], sql: "i.category_id = ?" };
}

/** Item name + strength + batch number search for batch listings. */
export function batchSearchClause(search: string | undefined): Clause | null {
  if (search === undefined) {
    return null;
  }
  const pattern = likePattern(search);
  return {
    params: [pattern, pattern],
    sql: "lower(i.name || ' ' || i.strength) LIKE ? ESCAPE '\\' OR b.batch_number_lower LIKE ? ESCAPE '\\'",
  };
}

export function compact(clauses: readonly (Clause | null)[]): Clause[] {
  return clauses.filter((clause): clause is Clause => clause !== null);
}

export function displayName(name: string, strength: string): string {
  return strength === "" ? name : `${name} ${strength}`;
}
