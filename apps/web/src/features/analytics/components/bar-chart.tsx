import type { ReactElement } from "react";

export interface BarSeries {
  /** SVG fill class, e.g. `fill-primary`. */
  fill: string;
  label: string;
  /** Legend swatch class, e.g. `bg-primary`. */
  swatch: string;
  /** One value per category (negative values are drawn as zero). */
  values: readonly number[];
}

export interface BarChartProps {
  /** X-axis labels, one per slot. Only the first and last are printed. */
  categories: readonly string[];
  /** Accessible summary of what the chart shows. */
  label: string;
  series: readonly BarSeries[];
  /** Stack the series in one bar per slot instead of side by side. */
  stacked?: boolean;
}

const HEIGHT = 120;
const SLOT = 10;
const GAP_RATIO = 0.2;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + Math.max(value, 0), 0);
}

function maxValue(
  series: readonly BarSeries[],
  stacked: boolean,
  categories: readonly string[]
): number {
  let max = 0;
  for (const slot of categories.keys()) {
    const slotValues = series.map((entry) => Math.max(entry.values[slot] ?? 0, 0));
    max = Math.max(max, stacked ? sum(slotValues) : Math.max(0, ...slotValues));
  }
  return max;
}

interface Rect {
  fill: string;
  height: number;
  key: string;
  width: number;
  x: number;
  y: number;
}

function layout(
  series: readonly BarSeries[],
  categories: readonly string[],
  stacked: boolean,
  max: number
): Rect[] {
  const rects: Rect[] = [];
  const inner = SLOT * (1 - GAP_RATIO);
  const barWidth = stacked ? inner : inner / Math.max(series.length, 1);
  for (const slot of categories.keys()) {
    let stackTop = HEIGHT;
    for (const [index, entry] of series.entries()) {
      const height = (Math.max(entry.values[slot] ?? 0, 0) / max) * HEIGHT;
      const x = slot * SLOT + (SLOT - inner) / 2 + (stacked ? 0 : index * barWidth);
      const y = stacked ? stackTop - height : HEIGHT - height;
      stackTop = y;
      if (height > 0) {
        rects.push({ fill: entry.fill, height, key: `${slot}-${index}`, width: barWidth, x, y });
      }
    }
  }
  return rects;
}

/**
 * A minimal SVG bar chart (grouped or stacked) that stretches to its container. Exact numbers
 * live in the legend totals and the accessible label, so colour is never the only signal.
 */
export function BarChart({
  categories,
  label,
  series,
  stacked = false,
}: BarChartProps): ReactElement {
  const slots = categories.length;
  const max = maxValue(series, stacked, categories);
  const rects = max > 0 ? layout(series, categories, stacked, max) : [];
  return (
    <figure className="grid gap-2">
      <svg
        aria-label={label}
        className="h-32 w-full rounded-md bg-muted/30"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${Math.max(slots, 1) * SLOT} ${HEIGHT}`}
      >
        {rects.map((rect) => (
          <rect
            className={rect.fill}
            height={rect.height}
            key={rect.key}
            width={rect.width}
            x={rect.x}
            y={rect.y}
          />
        ))}
      </svg>
      <div className="flex justify-between text-muted-foreground text-xs" aria-hidden>
        <span>{categories[0]}</span>
        <span>{categories.at(-1)}</span>
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((entry) => (
            <li className="flex items-center gap-1.5" key={entry.label}>
              <span aria-hidden className={`size-2.5 rounded-sm ${entry.swatch}`} />
              <span className="text-muted-foreground">{entry.label}</span>
              <span className="font-medium tabular-nums">{sum(entry.values)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
