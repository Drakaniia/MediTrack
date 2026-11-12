import { cn } from "@cmis/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import { type ReactElement, useCallback, useId } from "react";

export interface SegmentedOption<T extends string> {
  icon: LucideIcon;
  /** Accessible name of the option (the icon alone is not enough). */
  label: string;
  value: T;
}

export interface SegmentedControlProps<T extends string> {
  className?: string;
  /** Accessible name of the whole group, e.g. "Theme". */
  label: string;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  value: T | undefined;
}

function SegmentedRadio<T extends string>({
  checked,
  name,
  onSelect,
  option,
}: {
  checked: boolean;
  name: string;
  onSelect: (value: T) => void;
  option: SegmentedOption<T>;
}): ReactElement {
  const handleChange = useCallback(
    () => onSelect(option.value),
    [onSelect, option.value]
  );
  return (
    <label
      className="tap-target relative flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground has-checked:bg-accent has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring [&_svg]:size-4"
      title={option.label}
    >
      <input
        aria-label={option.label}
        checked={checked}
        className="sr-only"
        name={name}
        onChange={handleChange}
        type="radio"
        value={option.value}
      />
      <option.icon aria-hidden />
    </label>
  );
}

/**
 * A small icon-only radio group (native radios, so arrow keys and screen
 * readers work). Used by the theme and density toggles.
 */
export function SegmentedControl<T extends string>({
  className,
  label,
  onChange,
  options,
  value,
}: SegmentedControlProps<T>): ReactElement {
  const name = useId();
  return (
    <fieldset
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border bg-background p-0.5",
        className
      )}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <SegmentedRadio
          checked={value === option.value}
          key={option.value}
          name={name}
          onSelect={onChange}
          option={option}
        />
      ))}
    </fieldset>
  );
}
