import { Button } from "@cmis/ui/components/button";
import { Boxes, PackageSearch, SearchX, Tag } from "lucide-react";
import type { ReactElement } from "react";

import { useFacility } from "@/lib/auth/guards";
import { formatTime } from "@/lib/format";

import type { RecentScan } from "../hooks/use-scan-session";
import type { RecentKind } from "../lib/scan-messages";

const KIND_ICONS = {
  ambiguous: Boxes,
  batch: Tag,
  item: PackageSearch,
  not_found: SearchX,
} as const satisfies Record<RecentKind, unknown>;

const KIND_LABELS: Record<RecentKind, string> = {
  ambiguous: "Several items",
  batch: "Batch",
  item: "Item",
  not_found: "Not found",
};

export interface RecentScansProps {
  onSelect: (code: string) => void;
  scans: RecentScan[];
}

/** This session's last scans. Selecting one looks the code up again, so the figures are fresh. */
export function RecentScans({ onSelect, scans }: RecentScansProps): ReactElement {
  const { timezone } = useFacility();
  return (
    <section aria-labelledby="recent-scans-heading" className="space-y-2">
      <h2 className="font-medium text-sm" id="recent-scans-heading">
        Recent scans
      </h2>
      {scans.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing scanned yet this session.</p>
      ) : (
        <ul aria-label="Recent scans" className="divide-y rounded-lg border">
          {scans.map((scan) => {
            const Icon = KIND_ICONS[scan.kind];
            return (
              <li key={scan.code}>
                <Button
                  aria-label={`${scan.label}, ${KIND_LABELS[scan.kind]}, code ${scan.code}. Look up again`}
                  className="tap-target h-auto w-full justify-start gap-3 rounded-none py-2 text-left"
                  onClick={() => onSelect(scan.code)}
                  variant="ghost"
                >
                  <Icon aria-hidden className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-sm">{scan.label}</span>
                    <span className="block truncate font-mono text-muted-foreground text-xs">
                      {scan.code}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                    {formatTime(scan.at, timezone)}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
