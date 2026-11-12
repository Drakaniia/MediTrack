/** Small SQL building blocks for the request queries. Everything bound, identifiers whitelisted. */

import { escapeLike } from "../../http";

/** `WHERE` pieces: SQL text with `?` placeholders and the values to bind, in order. */
export interface Clause {
  params: unknown[];
  sql: string;
}

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

export function compact(clauses: readonly (Clause | null)[]): Clause[] {
  return clauses.filter((clause): clause is Clause => clause !== null);
}
