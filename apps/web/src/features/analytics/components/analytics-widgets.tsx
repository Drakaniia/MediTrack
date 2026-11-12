import { EXPIRY_CLASS_LABELS, EXPIRY_CLASSES, type ExpiryClass } from "@shared/expiry";
import type { AnalyticsDto } from "@shared/schemas/analytics";
import type { ReactElement } from "react";

import { CardEmpty, DashboardCard } from "@/features/dashboard/components/dashboard-card";
import { DONUT_CIRCUMFERENCE, DONUT_RADIUS, donutSegments } from "@/features/dashboard/lib/donut";
import { formatMonthLabel } from "@/features/dashboard/lib/months";
import { formatDate, formatQuantity } from "@/lib/format";

import { BarChart, type BarSeries } from "./bar-chart";

/** Five tones of the brand colour; the legend always names each slice. */
const SLICE_TONES = [
  { stroke: "stroke-primary", swatch: "bg-primary" },
  { stroke: "stroke-primary/75", swatch: "bg-primary/75" },
  { stroke: "stroke-primary/50", swatch: "bg-primary/50" },
  { stroke: "stroke-primary/30", swatch: "bg-primary/30" },
  { stroke: "stroke-muted-foreground/40", swatch: "bg-muted-foreground/40" },
] as const;

const CLASS_TONES: Record<ExpiryClass, { fill: string; swatch: string }> = {
  expired: { fill: "fill-expiry-expired", swatch: "bg-expiry-expired" },
  near_expiry: { fill: "fill-expiry-near", swatch: "bg-expiry-near" },
  safe: { fill: "fill-expiry-safe", swatch: "bg-expiry-safe" },
  urgent: { fill: "fill-expiry-urgent", swatch: "bg-expiry-urgent" },
};

const VIEWBOX = 100;
const CENTRE = VIEWBOX / 2;
const STROKE_WIDTH = 14;
const PERCENT = 100;

function percent(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * PERCENT)}%` : "0%";
}

export function UsageWidget({ usage }: { usage: AnalyticsDto["usage"] }): ReactElement {
  const slices = usage.slices;
  const segments = donutSegments(slices.map((slice) => slice.units));
  return (
    <DashboardCard description="Units dispensed, by category." title="Usage">
      {slices.length === 0 ? (
        <CardEmpty>Nothing was dispensed in this range.</CardEmpty>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <svg
            aria-label={slices.map((slice) => `${slice.name} ${slice.units} units`).join(", ")}
            className="size-28 shrink-0 -rotate-90"
            role="img"
            viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          >
            <circle className="stroke-muted" cx={CENTRE} cy={CENTRE} fill="none" r={DONUT_RADIUS} strokeWidth={STROKE_WIDTH} />
            {segments.map((segment, index) => (
              <circle
                className={SLICE_TONES[Math.min(index, SLICE_TONES.length - 1)].stroke}
                cx={CENTRE}
                cy={CENTRE}
                fill="none"
                key={slices[index].categoryId ?? "none"}
                r={DONUT_RADIUS}
                strokeDasharray={`${segment.dash} ${DONUT_CIRCUMFERENCE - segment.dash}`}
                strokeDashoffset={segment.offset}
                strokeWidth={STROKE_WIDTH}
              />
            ))}
          </svg>
          <dl className="grid min-w-40 flex-1 gap-1.5">
            {slices.map((slice, index) => (
              <div className="flex items-center gap-2 text-sm" key={slice.categoryId ?? "none"}>
                <span
                  aria-hidden
                  className={`size-2.5 shrink-0 rounded-full ${SLICE_TONES[Math.min(index, SLICE_TONES.length - 1)].swatch}`}
                />
                <dt className="min-w-0 truncate text-muted-foreground">{slice.name}</dt>
                <dd className="ml-auto tabular-nums">
                  {slice.units}{" "}
                  <span className="text-muted-foreground text-xs">
                    ({percent(slice.units, usage.totalUnits)})
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </DashboardCard>
  );
}

export function TopDispensedWidget({
  items,
}: {
  items: AnalyticsDto["topDispensed"];
}): ReactElement {
  return (
    <DashboardCard description="Most units handed over, with the batches they came from." title="Top dispensed">
      {items.length === 0 ? (
        <CardEmpty>Nothing was dispensed in this range.</CardEmpty>
      ) : (
        <ol className="grid gap-1">
          {items.map((item, index) => (
            <li key={item.itemId ?? item.name}>
              <details className="rounded-md px-2 py-1.5 hover:bg-accent/50">
                <summary className="flex cursor-pointer items-center gap-2 text-sm">
                  <span className="w-5 text-muted-foreground tabular-nums">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="tabular-nums">{formatQuantity(item.units, item.unit)}</span>
                </summary>
                <ul className="mt-1 grid gap-0.5 pl-7 text-muted-foreground text-xs">
                  {item.batches.map((batch) => (
                    <li className="flex justify-between gap-2" key={batch.batchNumber}>
                      <span>Batch {batch.batchNumber}</span>
                      <span className="tabular-nums">{batch.units}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      )}
    </DashboardCard>
  );
}

export function ExpiryTimelineWidget({
  timeline,
}: {
  timeline: AnalyticsDto["expiryTimeline"];
}): ReactElement {
  const series: BarSeries[] = EXPIRY_CLASSES.map((expiryClass) => ({
    ...CLASS_TONES[expiryClass],
    label: EXPIRY_CLASS_LABELS[expiryClass],
    values: timeline.months.map((month) => month.classes[expiryClass].units),
  }));
  const months = timeline.months.map((month) => formatMonthLabel(month.month));
  const total = timeline.months.reduce((sum, month) => sum + month.units, 0);
  return (
    <DashboardCard
      description={`Units on the shelf by expiry month. ${timeline.earlier.units} units expired earlier and still await disposal.`}
      title="Expiry timeline"
    >
      <BarChart
        categories={months}
        label={`${total} units expiring over the next ${months.length} months`}
        series={series}
        stacked
      />
    </DashboardCard>
  );
}

export function StockMovementWidget({
  movement,
}: {
  movement: AnalyticsDto["stockMovement"];
}): ReactElement {
  const days = movement.days;
  const series: BarSeries[] = [
    { fill: "fill-expiry-safe", label: "Received", swatch: "bg-expiry-safe", values: days.map((day) => day.received) },
    { fill: "fill-primary", label: "Dispensed", swatch: "bg-primary", values: days.map((day) => day.dispensed) },
    { fill: "fill-expiry-expired", label: "Disposed", swatch: "bg-expiry-expired", values: days.map((day) => day.disposed) },
  ];
  const adjusted = days.reduce((sum, day) => sum + day.adjusted, 0);
  return (
    <DashboardCard description={`Units per day. Net count corrections: ${adjusted}.`} title="Stock movement">
      <BarChart
        categories={days.map((day) => formatDate(day.date))}
        label="Units received, dispensed and disposed per day"
        series={series}
      />
    </DashboardCard>
  );
}

export function LowStockTrendWidget({
  trend,
}: {
  trend: AnalyticsDto["lowStockTrend"];
}): ReactElement {
  const days = trend.days;
  const series: BarSeries[] = [
    { fill: "fill-expiry-near", label: "Below threshold", swatch: "bg-expiry-near", values: days.map((day) => day.underThreshold - day.out) },
    { fill: "fill-expiry-expired", label: "Out of stock", swatch: "bg-expiry-expired", values: days.map((day) => day.out) },
  ];
  const last = days.at(-1);
  return (
    <DashboardCard
      description={`End-of-day counts among ${trend.itemsTracked} items with a threshold. Today: ${last?.underThreshold ?? 0} low, ${last?.out ?? 0} out.`}
      title="Low-stock trend"
    >
      <BarChart
        categories={days.map((day) => formatDate(day.date))}
        label="Items below their low-stock threshold per day"
        series={series}
        stacked
      />
    </DashboardCard>
  );
}

export function DispensedVsRequestedWidget({
  data,
}: {
  data: AnalyticsDto["dispensedVsRequested"];
}): ReactElement {
  const buckets = data.buckets;
  const series: BarSeries[] = [
    { fill: "fill-muted-foreground/50", label: "Requested", swatch: "bg-muted-foreground/50", values: buckets.map((bucket) => bucket.requested) },
    { fill: "fill-primary", label: "Dispensed", swatch: "bg-primary", values: buckets.map((bucket) => bucket.dispensed) },
  ];
  return (
    <DashboardCard description={`Queue requests per ${data.granularity}.`} title="Dispensed vs requested">
      <BarChart
        categories={buckets.map((bucket) => formatDate(bucket.from))}
        label={`Requests submitted and dispensed per ${data.granularity}`}
        series={series}
      />
    </DashboardCard>
  );
}
