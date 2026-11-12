import { classifyDays, type ExpiryThresholds } from "@shared/expiry";
import type { ReactElement } from "react";

import { ExpiryBadge } from "@/components/expiry-badge";

/** Days worth showing: the day before, the day of, and both sides of each boundary. */
export function previewDays(thresholds: ExpiryThresholds): number[] {
  const { nearDays, urgentDays } = thresholds;
  const days = [-1, 0, urgentDays, urgentDays + 1, nearDays, nearDays + 1];
  return [...new Set(days)].sort((a, b) => a - b);
}

/** What a batch expiring in N days looks like under `thresholds`, so a change can be judged before saving. */
export function ExpiryPreviewStrip({
  thresholds,
}: {
  thresholds: ExpiryThresholds;
}): ReactElement {
  return (
    <ul
      aria-label="How batches will be classified"
      className="flex flex-wrap gap-2"
    >
      {previewDays(thresholds).map((days) => (
        <li key={days}>
          <ExpiryBadge
            daysUntil={days}
            expiryClass={classifyDays(days, thresholds)}
          />
        </li>
      ))}
    </ul>
  );
}
