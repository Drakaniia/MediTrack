import { Rows2, Rows3 } from "lucide-react";
import type { ReactElement } from "react";

import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/segmented-control";
import { type Density, useDensity } from "@/hooks/use-density";

const DENSITY_OPTIONS: readonly SegmentedOption<Density>[] = [
  { icon: Rows2, label: "Comfortable density", value: "comfortable" },
  { icon: Rows3, label: "Compact density", value: "compact" },
];

export function DensityToggle({
  className,
}: {
  className?: string;
}): ReactElement {
  const { density, setDensity } = useDensity();
  return (
    <SegmentedControl
      className={className}
      label="Density"
      onChange={setDensity}
      options={DENSITY_OPTIONS}
      value={density}
    />
  );
}
