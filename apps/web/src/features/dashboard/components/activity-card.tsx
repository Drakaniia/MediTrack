import type { DashboardActivityDto } from "@shared/schemas/dashboard";
import type { ReactElement } from "react";

import { formatQuantity } from "@/lib/format";

import {
  DONUT_CIRCUMFERENCE,
  DONUT_RADIUS,
  donutSegments,
} from "../lib/donut";
import { formatMonthLabel } from "../lib/months";
import { DashboardCard } from "./dashboard-card";

interface ActivityEntry {
  /** Tailwind classes: `swatch` paints the legend dot, `stroke` the arc. */
  stroke: string;
  swatch: string;
  label: string;
  value: number;
  detail?: string;
}

function entriesOf(data: DashboardActivityDto): ActivityEntry[] {
  return [
    {
      label: "Dispensed",
      stroke: "stroke-primary",
      swatch: "bg-primary",
      value: data.unitsDispensed,
    },
    {
      label: "Received",
      stroke: "stroke-expiry-safe",
      swatch: "bg-expiry-safe",
      value: data.unitsReceived,
    },
    {
      detail: `${data.disposals.count} ${data.disposals.count === 1 ? "disposal" : "disposals"}`,
      label: "Disposed",
      stroke: "stroke-expiry-expired",
      swatch: "bg-expiry-expired",
      value: data.disposals.units,
    },
  ];
}

const VIEWBOX = 100;
const CENTRE = VIEWBOX / 2;
const STROKE_WIDTH = 14;

function Donut({
  entries,
  label,
}: {
  entries: readonly ActivityEntry[];
  label: string;
}): ReactElement {
  const segments = donutSegments(entries.map((entry) => entry.value));
  return (
    <svg
      aria-label={label}
      className="size-28 shrink-0 -rotate-90"
      role="img"
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
    >
      <circle
        className="stroke-muted"
        cx={CENTRE}
        cy={CENTRE}
        fill="none"
        r={DONUT_RADIUS}
        strokeWidth={STROKE_WIDTH}
      />
      {segments.map((segment, index) =>
        segment.dash > 0 ? (
          <circle
            className={entries[index].stroke}
            cx={CENTRE}
            cy={CENTRE}
            fill="none"
            key={entries[index].label}
            r={DONUT_RADIUS}
            strokeDasharray={`${segment.dash} ${DONUT_CIRCUMFERENCE - segment.dash}`}
            strokeDashoffset={segment.offset}
            strokeWidth={STROKE_WIDTH}
          />
        ) : null
      )}
    </svg>
  );
}

export interface ActivityCardProps {
  data: DashboardActivityDto;
}

/** Units dispensed, received and disposed in the selected month (analytics roles only). */
export function ActivityCard({ data }: ActivityCardProps): ReactElement {
  const label = formatMonthLabel(data.month);
  const entries = entriesOf(data);
  const quiet = entries.every((entry) => entry.value === 0);
  return (
    <DashboardCard
      description="Units moved, from the stock ledger."
      title={`Activity in ${label}`}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Donut
          entries={entries}
          label={
            quiet
              ? `No stock movement in ${label}`
              : entries
                  .map((entry) => `${entry.label} ${entry.value} units`)
                  .join(", ")
          }
        />
        <dl className="grid min-w-40 flex-1 gap-2">
          {entries.map((entry) => (
            <div className="flex items-center gap-2" key={entry.label}>
              <span
                aria-hidden
                className={`size-2.5 shrink-0 rounded-full ${entry.swatch}`}
              />
              <dt className="text-muted-foreground text-sm">{entry.label}</dt>
              <dd className="ml-auto text-right font-medium text-sm tabular-nums">
                {formatQuantity(entry.value, "unit")}
                {entry.detail ? (
                  <span className="block font-normal text-muted-foreground text-xs">
                    {entry.detail}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {quiet ? (
        <p className="text-muted-foreground text-xs">
          No stock moved in {label}.
        </p>
      ) : null}
    </DashboardCard>
  );
}
