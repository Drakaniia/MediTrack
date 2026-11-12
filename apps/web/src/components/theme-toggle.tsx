import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import type { ReactElement } from "react";

import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/segmented-control";

type ThemeChoice = "dark" | "light" | "system";

const THEME_OPTIONS: readonly SegmentedOption<ThemeChoice>[] = [
  { icon: Monitor, label: "System theme", value: "system" },
  { icon: Sun, label: "Light theme", value: "light" },
  { icon: Moon, label: "Dark theme", value: "dark" },
];

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value === "dark" || value === "light" || value === "system";
}

export function ThemeToggle({
  className,
}: {
  className?: string;
}): ReactElement {
  const { setTheme, theme } = useTheme();
  return (
    <SegmentedControl
      className={className}
      label="Theme"
      onChange={setTheme}
      options={THEME_OPTIONS}
      value={isThemeChoice(theme) ? theme : undefined}
    />
  );
}
