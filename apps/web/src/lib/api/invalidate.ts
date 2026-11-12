import type { QueryClient } from "@tanstack/react-query";

/**
 * Query-key roots (first element of a key) whose data changes when stock moves.
 * Append a root here when a new slice caches stock-derived data.
 */
export const STOCK_QUERY_ROOTS: ReadonlySet<unknown> = new Set([
  "inventory",
  "dashboard",
  "requests",
  "dispensing",
  "analytics",
  "reports",
  "alerts",
]);

/** Call after ANY mutation that changes a quantity, a batch, an item or a request. */
export function invalidateStockQueries(
  queryClient: QueryClient
): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => STOCK_QUERY_ROOTS.has(query.queryKey[0]),
  });
}
