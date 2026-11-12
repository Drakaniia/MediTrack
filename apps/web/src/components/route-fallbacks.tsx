import { Button, buttonVariants } from "@cmis/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { ReactElement } from "react";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";

function reloadApp(): void {
  window.location.reload();
}

/** Shown while a route's loader or lazy chunk is pending. */
export function RoutePending(): ReactElement {
  return (
    <div
      aria-label="Loading page"
      className="flex justify-center pt-16 text-muted-foreground"
      role="status"
    >
      <Loader2
        aria-hidden
        className="size-5 animate-spin motion-reduce:animate-none"
      />
    </div>
  );
}

export function RouteNotFound(): ReactElement {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        description="The page you're looking for doesn't exist or has moved."
        title="Page not found"
      />
      <Link className={buttonVariants({ variant: "outline" })} to="/">
        Back to the dashboard
      </Link>
    </div>
  );
}

/** A render or loader error inside a page. The shell around it keeps working. */
export function RouteError({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}): ReactElement {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <PageHeader title="Something went wrong" />
      <DataState error={error} onRetry={reset} />
      <Button onClick={reloadApp} variant="ghost">
        Reload the app
      </Button>
    </div>
  );
}
