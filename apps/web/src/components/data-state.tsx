import { Button } from "@cmis/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@cmis/ui/components/empty";
import { Skeleton } from "@cmis/ui/components/skeleton";
import { cn } from "@cmis/ui/lib/utils";
import { CircleAlert, Inbox, type LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { errorMessage } from "@/lib/api/errors";

export interface DataStateEmpty {
  action?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  title: ReactNode;
}

export interface DataStateProps {
  children?: ReactNode;
  /** What to show when `isEmpty`. */
  empty?: DataStateEmpty;
  /** The query's error (any thrown value). A truthy value shows the error state. */
  error?: unknown;
  /** True when the request succeeded but returned nothing. */
  isEmpty?: boolean;
  isLoading?: boolean;
  /** Shown as a "Try again" button in the error state. */
  onRetry?: () => void;
  /** Replaces the default skeleton rows while loading. */
  skeleton?: ReactNode;
  /** Number of default skeleton rows. */
  skeletonRows?: number;
}

const DEFAULT_SKELETON_ROWS = 5;
const DEFAULT_EMPTY: DataStateEmpty = { title: "Nothing here yet" };
const FALLBACK_ERROR = "Something went wrong while loading this.";

function skeletonRowKeys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `row-${index}`);
}

function LoadingState({
  rows,
  skeleton,
}: {
  rows: number;
  skeleton?: ReactNode;
}): ReactElement {
  return (
    <div aria-busy="true" aria-label="Loading" role="status">
      <span className="sr-only">Loading…</span>
      {skeleton ?? (
        <div className="space-y-2">
          {skeletonRowKeys(rows).map((key) => (
            <Skeleton className="h-10 w-full" key={key} />
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
      )}
      role="alert"
    >
      <CircleAlert aria-hidden className="size-6 text-destructive" />
      <div className="space-y-1">
        <p className="font-medium text-sm">We couldn't load this</p>
        <p className="text-muted-foreground text-sm">
          {errorMessage(error, FALLBACK_ERROR)}
        </p>
      </div>
      {onRetry ? (
        <Button className="tap-target" onClick={onRetry} variant="outline">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function EmptyState({ empty }: { empty: DataStateEmpty }): ReactElement {
  const Icon = empty.icon ?? Inbox;
  return (
    <Empty className="rounded-lg border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{empty.title}</EmptyTitle>
        {empty.description ? (
          <EmptyDescription>{empty.description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {empty.action ? <EmptyContent>{empty.action}</EmptyContent> : null}
    </Empty>
  );
}

/**
 * The three non-happy states of a data view, in priority order: loading
 * (skeleton) → error (message + retry) → empty (message + optional action) →
 * `children`. Wrap a list/table in it and pass the query's flags:
 *
 *   <DataState error={q.error} isEmpty={q.data?.length === 0}
 *              isLoading={q.isPending} onRetry={q.refetch}>…</DataState>
 */
export function DataState({
  children,
  empty = DEFAULT_EMPTY,
  error,
  isEmpty = false,
  isLoading = false,
  onRetry,
  skeleton,
  skeletonRows = DEFAULT_SKELETON_ROWS,
}: DataStateProps): ReactNode {
  if (isLoading) {
    return <LoadingState rows={skeletonRows} skeleton={skeleton} />;
  }
  if (error !== undefined && error !== null && error !== false) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }
  if (isEmpty) {
    return <EmptyState empty={empty} />;
  }
  return children;
}
