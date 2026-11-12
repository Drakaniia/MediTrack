import { relativeExpiryText } from "@shared/expiry";
import type {
  AlertBannerCounts,
  AlertBannerTopItem,
} from "@shared/schemas/alerts";

/**
 * What the dashboard banner says and when it comes back after being dismissed.
 * Dismissal lasts for the browser session only, and a banner that was dismissed
 * reappears as soon as ANY count goes up (a new problem is never hidden by an old click).
 */

export const BANNER_DISMISSED_KEY = "meditract:alerts:banner-dismissed";

export type BannerPartKind = keyof AlertBannerCounts;

export interface BannerPart {
  count: number;
  href: "/inventory/expiry" | "/inventory/low-stock" | "/inventory/quarantine";
  kind: BannerPartKind;
  /** "2 batches expired" */
  label: string;
}

const COUNT_KEYS = ["expired", "urgent", "lowStock"] as const;

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function hasAlerts(counts: AlertBannerCounts): boolean {
  return COUNT_KEYS.some((key) => counts[key] > 0);
}

/** The non-zero parts of the banner in severity order: expired, urgent, low stock. */
export function bannerParts(counts: AlertBannerCounts): BannerPart[] {
  const parts: BannerPart[] = [];
  if (counts.expired > 0) {
    parts.push({
      count: counts.expired,
      href: "/inventory/quarantine",
      kind: "expired",
      label: `${counts.expired} ${plural(counts.expired, "batch", "batches")} expired`,
    });
  }
  if (counts.urgent > 0) {
    parts.push({
      count: counts.urgent,
      href: "/inventory/expiry",
      kind: "urgent",
      label: `${counts.urgent} urgent`,
    });
  }
  if (counts.lowStock > 0) {
    parts.push({
      count: counts.lowStock,
      href: "/inventory/low-stock",
      kind: "lowStock",
      label: `${counts.lowStock} ${plural(counts.lowStock, "item", "items")} low on stock`,
    });
  }
  return parts;
}

/** The whole sentence, e.g. "2 batches expired · 3 urgent · 4 items low on stock". */
export function bannerSummary(counts: AlertBannerCounts): string {
  return bannerParts(counts)
    .map((part) => part.label)
    .join(" · ");
}

/** "Amoxicillin 500 mg · batch B-12 · Expired 3d ago" / "Gauze · 5 of 20 roll available". */
export function describeTopItem(item: AlertBannerTopItem): string {
  if (item.kind === "low_stock") {
    return `${item.itemName} · ${item.available ?? 0} of ${item.threshold ?? 0} ${item.unit} available`.trim();
  }
  const batch = item.batchNumber ? ` · batch ${item.batchNumber}` : "";
  return `${item.itemName}${batch} · ${relativeExpiryText(item.daysUntil)}`;
}

/** True when any count is higher than what was on screen when the banner was dismissed. */
export function countsIncreased(
  counts: AlertBannerCounts,
  baseline: AlertBannerCounts
): boolean {
  return COUNT_KEYS.some((key) => counts[key] > baseline[key]);
}

/**
 * The dismissal baseline after counts fell: a later rise from the lower number must bring
 * the banner back, so the baseline follows the counts down (never up).
 */
export function lowerBaseline(
  counts: AlertBannerCounts,
  baseline: AlertBannerCounts
): AlertBannerCounts {
  return {
    expired: Math.min(counts.expired, baseline.expired),
    lowStock: Math.min(counts.lowStock, baseline.lowStock),
    urgent: Math.min(counts.urgent, baseline.urgent),
  };
}

export function bannerVisible(
  counts: AlertBannerCounts,
  baseline: AlertBannerCounts | null
): boolean {
  if (!hasAlerts(counts)) {
    return false;
  }
  return baseline === null || countsIncreased(counts, baseline);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseBaseline(raw: string | null): AlertBannerCounts | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const { expired, lowStock, urgent } = parsed as Record<string, unknown>;
    return isCount(expired) && isCount(lowStock) && isCount(urgent)
      ? { expired, lowStock, urgent }
      : null;
  } catch {
    return null;
  }
}

/**
 * Storage access that never throws (private mode, blocked storage): a failure just means
 * the banner cannot remember being dismissed.
 */
export function readBaseline(): AlertBannerCounts | null {
  try {
    return parseBaseline(sessionStorage.getItem(BANNER_DISMISSED_KEY));
  } catch {
    return null;
  }
}

export function writeBaseline(counts: AlertBannerCounts): void {
  try {
    sessionStorage.setItem(BANNER_DISMISSED_KEY, JSON.stringify(counts));
  } catch {
    // Not remembering the dismissal is harmless.
  }
}
