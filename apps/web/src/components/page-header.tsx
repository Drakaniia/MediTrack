import { cn } from "@cmis/ui/lib/utils";
import type { ReactElement, ReactNode } from "react";

export interface PageHeaderProps {
  /** Buttons and filters aligned to the right (they wrap under the title on phones). */
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  /** Small label above the title (e.g. a section name). */
  eyebrow?: ReactNode;
  title: ReactNode;
}

/** The page's `<h1>` with an optional description and action row. One per page. */
export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  title,
}: PageHeaderProps): ReactElement {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pb-4",
        className
      )}
    >
      <div className="min-w-0 flex-1 basis-64">
        {eyebrow ? (
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-balance font-semibold text-xl tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
