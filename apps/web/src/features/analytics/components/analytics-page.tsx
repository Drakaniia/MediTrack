import { addDays } from "@shared/dates";
import { BarChart3 } from "lucide-react";
import { type ReactElement, useState } from "react";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { useCategories } from "@/features/inventory/hooks/inventory-queries";
import { useFacility } from "@/lib/auth/guards";
import { formatDate } from "@/lib/format";

import { useAnalytics } from "../hooks/analytics-queries";
import {
  DispensedVsRequestedWidget,
  ExpiryTimelineWidget,
  LowStockTrendWidget,
  StockMovementWidget,
  TopDispensedWidget,
  UsageWidget,
} from "./analytics-widgets";

const RANGE_OPTIONS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
] as const;
const DEFAULT_RANGE_DAYS = 30;

const SELECT_CLASS =
  "h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Analytics (spec §7.7): usage, top dispensed, expiry timeline, movement, low stock, demand. */
export function AnalyticsPage(): ReactElement {
  const { today } = useFacility();
  const [rangeDays, setRangeDays] = useState<number>(DEFAULT_RANGE_DAYS);
  const [categoryId, setCategoryId] = useState("");
  const categories = useCategories();
  const query = useAnalytics({
    categoryId,
    from: addDays(today, -(rangeDays - 1)),
    to: today,
  });
  const { data } = query;

  return (
    <div>
      <PageHeader
        actions={
          <>
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-muted-foreground">Range</span>
              <select
                className={SELECT_CLASS}
                onChange={(event) => setRangeDays(Number(event.target.value))}
                value={String(rangeDays)}
              >
                {RANGE_OPTIONS.map((option) => (
                  <option key={option.days} value={option.days}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-muted-foreground">Category</span>
              <select
                className={SELECT_CLASS}
                onChange={(event) => setCategoryId(event.target.value)}
                value={categoryId}
              >
                <option value="">All categories</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
        description={
          data
            ? `${formatDate(data.range.from)} – ${formatDate(data.range.to)}`
            : undefined
        }
        title="Analytics"
      />
      <DataState
        empty={{ icon: BarChart3, title: "No data yet" }}
        error={data ? undefined : query.error}
        isLoading={query.isPending}
        onRetry={() => query.refetch()}
      >
        {data ? (
          <div
            aria-busy={query.isPlaceholderData}
            className="grid gap-4 lg:grid-cols-2"
          >
            <UsageWidget usage={data.usage} />
            <TopDispensedWidget items={data.topDispensed} />
            <StockMovementWidget movement={data.stockMovement} />
            <DispensedVsRequestedWidget data={data.dispensedVsRequested} />
            <ExpiryTimelineWidget timeline={data.expiryTimeline} />
            <LowStockTrendWidget trend={data.lowStockTrend} />
          </div>
        ) : null}
      </DataState>
    </div>
  );
}
