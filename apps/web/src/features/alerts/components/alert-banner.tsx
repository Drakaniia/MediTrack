import { Button } from "@cmis/ui/components/button";
import { cn } from "@cmis/ui/lib/utils";
import type { AlertBannerDto } from "@shared/schemas/alerts";
import { Link } from "@tanstack/react-router";
import {
  Clock,
  type LucideIcon,
  OctagonAlert,
  PackageMinus,
  X,
} from "lucide-react";
import type { ReactElement } from "react";

import { useCan } from "@/lib/auth/guards";

import { useAlertBannerData } from "../hooks/alert-queries";
import { useBannerDismissal } from "../hooks/use-banner-dismissal";
import {
  type BannerPart,
  type BannerPartKind,
  bannerParts,
  describeTopItem,
} from "../lib/banner-model";

const PART_ICONS: Record<BannerPartKind, LucideIcon> = {
  expired: OctagonAlert,
  lowStock: PackageMinus,
  urgent: Clock,
};

const CRITICAL_STYLE =
  "border-destructive/40 bg-[color-mix(in_oklch,var(--destructive),transparent_90%)]";
const WARNING_STYLE =
  "border-[color-mix(in_oklch,var(--warning),transparent_55%)] bg-[color-mix(in_oklch,var(--warning),transparent_88%)]";

function BannerLink({ part }: { part: BannerPart }): ReactElement {
  const Icon = PART_ICONS[part.kind];
  return (
    <Link
      className="inline-flex items-center gap-1.5 rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      to={part.href}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {part.label}
    </Link>
  );
}

function TopItems({ banner }: { banner: AlertBannerDto }): ReactElement | null {
  if (banner.topItems.length === 0) {
    return null;
  }
  return (
    <ul className="mt-1 hidden gap-x-4 text-muted-foreground text-xs sm:flex sm:flex-wrap">
      {banner.topItems.map((item) => (
        <li
          className="max-w-full truncate"
          key={`${item.kind}-${item.batchId ?? item.itemId}`}
        >
          {describeTopItem(item)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The live stock banner under the header: expired batches, urgent batches and low-stock
 * items, computed by the server at request time. Every part carries an icon AND words
 * (never colour alone). Dismissing hides it for this browser session until a count rises.
 */
export function AlertBanner(): ReactElement | null {
  const canView = useCan("alerts.view");
  const { data: banner } = useAlertBannerData(canView);
  const counts = banner?.enabled ? banner.counts : undefined;
  const { dismiss, visible } = useBannerDismissal(counts);

  if (!(banner && counts && visible)) {
    return null;
  }
  const parts = bannerParts(counts);
  return (
    <section
      aria-label="Stock alerts"
      className={cn(
        "flex items-start gap-3 border-b px-3 py-2 text-sm md:px-6",
        counts.expired > 0 ? CRITICAL_STYLE : WARNING_STYLE
      )}
    >
      <div className="min-w-0 flex-1">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {parts.map((part) => (
            <li key={part.kind}>
              <BannerLink part={part} />
            </li>
          ))}
        </ul>
        <TopItems banner={banner} />
      </div>
      <Button
        aria-label="Dismiss stock alerts"
        className="tap-target -my-1 shrink-0"
        onClick={dismiss}
        size="icon-sm"
        variant="ghost"
      >
        <X aria-hidden />
      </Button>
    </section>
  );
}
