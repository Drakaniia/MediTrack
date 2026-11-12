import { cn } from "@cmis/ui/lib/utils";
import type { ReactElement } from "react";

export interface SelectOption {
  label: string;
  value: string;
}

export interface NativeSelectProps {
  className?: string;
  disabled?: boolean;
  /** Visible label above the control. */
  label: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  value: string;
}

/** A labelled native `<select>`: works with every keyboard, screen reader and phone picker. */
export function NativeSelect({
  className,
  disabled,
  label,
  onChange,
  options,
  value,
}: NativeSelectProps): ReactElement {
  return (
    <label className={cn("grid gap-1 text-xs", className)}>
      <span className="font-medium text-muted-foreground">{label}</span>
      <select
        className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
