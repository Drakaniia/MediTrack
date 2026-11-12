import { cn } from "@cmis/ui/lib/utils";
import type { NotificationSeverity } from "@shared/schemas/alerts";
import {
  Info,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import type { ReactElement } from "react";

import { SEVERITY_LABELS } from "../lib/notification-view";

const ICONS: Record<NotificationSeverity, LucideIcon> = {
  critical: OctagonAlert,
  info: Info,
  warning: TriangleAlert,
};

const TONES: Record<NotificationSeverity, string> = {
  critical:
    "border-destructive/40 bg-[color-mix(in_oklch,var(--destructive),transparent_90%)]",
  info: "border-border bg-muted",
  warning:
    "border-[color-mix(in_oklch,var(--warning),transparent_55%)] bg-[color-mix(in_oklch,var(--warning),transparent_88%)]",
};

/** Severity as icon + word + tint, so it never relies on colour alone. */
export function SeverityBadge({
  severity,
}: {
  severity: NotificationSeverity;
}): ReactElement {
  const Icon = ICONS[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-xs",
        TONES[severity]
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
