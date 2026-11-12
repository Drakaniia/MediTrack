import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import { cn } from "@cmis/ui/lib/utils";
import {
  type ChangeEvent,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useCallback,
  useId,
} from "react";

/**
 * Small labelled form controls shared by the Users, Audit and Settings screens.
 * Every control has a visible label; hints and errors are wired to the control
 * with `aria-describedby`, and errors never rely on colour alone.
 */

function describedBy(
  id: string,
  hint: ReactNode,
  error: string | undefined
): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(
    Boolean
  );
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function FieldNotes({
  error,
  hint,
  id,
}: {
  error?: string;
  hint?: ReactNode;
  id: string;
}): ReactElement | null {
  if (!(hint || error)) {
    return null;
  }
  return (
    <>
      {hint ? (
        <p className="text-muted-foreground text-xs" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-xs" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </>
  );
}

export interface TextFieldProps
  extends Omit<ComponentProps<typeof Input>, "id" | "onChange" | "value"> {
  error?: string;
  hint?: ReactNode;
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}

export function TextField({
  className,
  error,
  hint,
  label,
  onValueChange,
  value,
  ...inputProps
}: TextFieldProps): ReactElement {
  const id = useId();
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value),
    [onValueChange]
  );
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...inputProps}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        className={cn("h-9", className)}
        id={id}
        onChange={handleChange}
        value={value}
      />
      <FieldNotes error={error} hint={hint} id={id} />
    </div>
  );
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectFieldProps {
  className?: string;
  disabled?: boolean;
  error?: string;
  hint?: ReactNode;
  label: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  value: string;
}

/** A labelled native `<select>`: works with every keyboard, screen reader and phone picker. */
export function SelectField({
  className,
  disabled,
  error,
  hint,
  label,
  onValueChange,
  options,
  value,
}: SelectFieldProps): ReactElement {
  const id = useId();
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) =>
      onValueChange(event.target.value),
    [onValueChange]
  );
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <select
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        className="h-9 w-full rounded-none border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:opacity-60 aria-invalid:border-destructive"
        disabled={disabled}
        id={id}
        onChange={handleChange}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldNotes error={error} hint={hint} id={id} />
    </div>
  );
}

export interface ToggleRowProps {
  checked: boolean;
  description?: ReactNode;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

/** An on/off setting: a native checkbox exposed as a switch, with its label and description. */
export function ToggleRow({
  checked,
  description,
  disabled,
  label,
  onCheckedChange,
}: ToggleRowProps): ReactElement {
  const id = useId();
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onCheckedChange(event.target.checked),
    [onCheckedChange]
  );
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border bg-background p-3 has-focus-visible:ring-2 has-focus-visible:ring-ring">
      <span className="grid gap-0.5">
        <span className="font-medium text-sm" id={`${id}-label`}>
          {label}
        </span>
        {description ? (
          <span className="text-muted-foreground text-xs" id={`${id}-desc`}>
            {description}
          </span>
        ) : null}
      </span>
      <input
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        aria-labelledby={`${id}-label`}
        checked={checked}
        className="mt-0.5 size-4 shrink-0 accent-primary"
        disabled={disabled}
        onChange={handleChange}
        role="switch"
        type="checkbox"
      />
    </label>
  );
}

/** A form-level message (the server said no). Announced when it appears. */
export function FormAlert({ children }: { children: ReactNode }): ReactElement {
  return (
    <p
      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm"
      role="alert"
    >
      {children}
    </p>
  );
}

/** One opaque section card: title, optional description, body, optional footer. */
export function SectionCard({
  children,
  description,
  footer,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  title: string;
}): ReactElement {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold text-sm tracking-tight" id={id}>
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
        ) : null}
      </div>
      <div className="grid gap-4 p-4">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
