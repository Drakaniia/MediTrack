/** Geometry for the activity donut (plain SVG circles drawn with `stroke-dasharray`). */

export const DONUT_RADIUS = 40;
export const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

export interface DonutSegment {
  /** Visible arc length along the circle. */
  dash: number;
  /** Negative start offset along the circle. */
  offset: number;
  value: number;
}

/**
 * One arc per positive value, laid end to end around the circle, proportional to its share of
 * the total. Zero (or negative) values get no arc; an all-zero input yields no segments.
 */
export function donutSegments(
  values: readonly number[],
  circumference: number = DONUT_CIRCUMFERENCE
): DonutSegment[] {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0) {
    return [];
  }
  const segments: DonutSegment[] = [];
  let used = 0;
  for (const value of values) {
    const dash = (Math.max(value, 0) / total) * circumference;
    segments.push({ dash, offset: -used, value });
    used += dash;
  }
  return segments;
}
