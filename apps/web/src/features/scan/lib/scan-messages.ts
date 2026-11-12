import type { ScanOutcome } from "../hooks/use-scan-lookup";

/** "Paracetamol 500 mg · LOT-7": what the toast and the recent list call a scan. */
export function foundLabel(outcome: ScanOutcome): string {
  if (outcome.status === "not_found") {
    return "Code not found";
  }
  const { result } = outcome;
  if (result.kind === "batch") {
    return `${result.item.displayName} · ${result.batch.batchNumber}`;
  }
  if (result.kind === "item") {
    return result.item.displayName;
  }
  return `${result.items.length} items match`;
}

/** The sentence a screen reader hears after a scan (live region). */
export function announcementFor(outcome: ScanOutcome): string {
  if (outcome.status === "not_found") {
    return `Code not found: ${outcome.code}.`;
  }
  const { result } = outcome;
  if (result.kind === "batch") {
    return `Found ${result.item.displayName}, batch ${result.batch.batchNumber}.`;
  }
  if (result.kind === "item") {
    return `Found ${result.item.displayName}.`;
  }
  return `${result.items.length} items match ${outcome.code}. Choose one.`;
}

export type RecentKind = "ambiguous" | "batch" | "item" | "not_found";

export function kindOf(outcome: ScanOutcome): RecentKind {
  return outcome.status === "not_found" ? "not_found" : outcome.result.kind;
}
