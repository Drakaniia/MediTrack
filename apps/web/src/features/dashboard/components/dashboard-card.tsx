import { cn } from "@cmis/ui/lib/utils";
import { type ReactElement, type ReactNode, useId } from "react";

export interface DashboardCardProps {
  /** A link or button aligned to the title ("View all"). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
}

/** A titled region of the dashboard: `<section>` labelled by its `<h2>`. */
export function DashboardCard({
  action,
  children,
  className,
  description,
  title,
}: DashboardCardProps): ReactElement {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("grid content-start gap-3 rounded-lg border p-4", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="font-semibold text-sm" id={headingId}>
            {title}
          </h2>
          {description ? (
            <p className="text-muted-foreground text-xs">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export const CARD_LINK_CLASS =
  "rounded-sm text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring";

export const ROW_CLASS =
  "flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

export function CardEmpty({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="rounded-md bg-muted/40 px-3 py-4 text-center text-muted-foreground text-sm">
      {children}
    </p>
  );
}
