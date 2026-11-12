import { cn } from "@cmis/ui/lib/utils";
import {
  EXPIRY_CLASS_LABELS,
  type ExpiryClass,
  relativeExpiryText,
} from "@shared/expiry";
import {
  CircleCheck,
  Clock,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import type { ReactElement } from "react";

export interface ExpiryBadgeProps {
  className?: string;
  /** Days from the facility's today to expiry; negative = already expired, null = no expiry. */
  daysUntil?: number | null;
  expiryClass: ExpiryClass;
}

interface ClassStyle {
  icon: LucideIcon;
  tone: string;
}

/** Colour is never the only signal: every class also has its own icon and its name. */
const CLASS_STYLES: Record<ExpiryClass, ClassStyle> = {
  expired: {
    icon: OctagonAlert,
    tone: "bg-expiry-expired/15 text-expiry-expired",
  },
  near_expiry: { icon: Clock, tone: "bg-expiry-near/15 text-expiry-near" },
  safe: { icon: CircleCheck, tone: "bg-expiry-safe/15 text-expiry-safe" },
  urgent: {
    icon: TriangleAlert,
    tone: "bg-expiry-urgent/15 text-expiry-urgent",
  },
};

/**
 * Expiry class pill: icon + class name (+ relative text such as "In 12d" when
 * `daysUntil` is given). The class itself is computed by `shared/expiry.ts`,
 * never stored.
 */
export function ExpiryBadge({
  className,
  daysUntil,
  expiryClass,
}: ExpiryBadgeProps): ReactElement {
  const { icon: Icon, tone } = CLASS_STYLES[expiryClass];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs",
        tone,
        className
      )}
      data-expiry-class={expiryClass}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span>{EXPIRY_CLASS_LABELS[expiryClass]}</span>
      {daysUntil === undefined ? null : (
        <span className="font-normal opacity-80">
          · {relativeExpiryText(daysUntil)}
        </span>
      )}
    </span>
  );
}
