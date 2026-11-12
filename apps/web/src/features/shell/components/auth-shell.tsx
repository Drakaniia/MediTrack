import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import {
  type ChangeEvent,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useCallback,
} from "react";

import { Brand } from "@/components/shell/brand";

/** The bare, centred frame of /login and /change-password (no sidebar, no header). */
export function AuthShell({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  title: string;
}): ReactElement {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-6 shadow-sm">
        <div className="space-y-3">
          <Brand />
          <div className="space-y-1">
            <h1 className="font-semibold text-xl tracking-tight">{title}</h1>
            {description ? (
              <p className="text-muted-foreground text-sm">{description}</p>
            ) : null}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export interface AuthFieldProps
  extends Omit<ComponentProps<typeof Input>, "id" | "onChange" | "value"> {
  /** Shown under the field when set; also marks it invalid. */
  error?: string;
  hint?: ReactNode;
  id: string;
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}

/** A labelled input with an optional hint and error, both wired to the input for assistive tech. */
export function AuthField({
  error,
  hint,
  id,
  label,
  onValueChange,
  value,
  ...inputProps
}: AuthFieldProps): ReactElement {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value),
    [onValueChange]
  );
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="tap-target h-10 md:h-9"
        id={id}
        onChange={handleChange}
        value={value}
      />
      {hint ? (
        <p className="text-muted-foreground text-xs" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-xs" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A form-level error (server said no). Announced when it appears. */
export function FormError({ children }: { children: ReactNode }): ReactElement {
  return (
    <p
      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm"
      role="alert"
    >
      {children}
    </p>
  );
}
