import type { AlertBannerCounts } from "@shared/schemas/alerts";
import { useCallback, useEffect, useState } from "react";

import {
  bannerVisible,
  lowerBaseline,
  readBaseline,
  writeBaseline,
} from "../lib/banner-model";

export interface BannerDismissal {
  dismiss: () => void;
  visible: boolean;
}

function sameCounts(a: AlertBannerCounts, b: AlertBannerCounts): boolean {
  return (
    a.expired === b.expired &&
    a.lowStock === b.lowStock &&
    a.urgent === b.urgent
  );
}

/**
 * Per-session dismissal of the banner. Dismissing remembers the counts that were on screen;
 * the banner returns when any of them rises. When counts fall the remembered numbers fall
 * with them, so "3 → 1 → 2" brings it back too.
 */
export function useBannerDismissal(
  counts: AlertBannerCounts | undefined
): BannerDismissal {
  const [baseline, setBaseline] = useState(readBaseline);

  useEffect(() => {
    if (!(counts && baseline)) {
      return;
    }
    const lowered = lowerBaseline(counts, baseline);
    if (!sameCounts(lowered, baseline)) {
      writeBaseline(lowered);
      setBaseline(lowered);
    }
  }, [baseline, counts]);

  const dismiss = useCallback(() => {
    if (!counts) {
      return;
    }
    writeBaseline(counts);
    setBaseline(counts);
  }, [counts]);

  return { dismiss, visible: counts ? bannerVisible(counts, baseline) : false };
}
