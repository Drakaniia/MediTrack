import type { ReactElement } from "react";

/** Inline validation message; only render it after the form was submitted. */
export function FieldError({
  error,
  id,
}: {
  error?: string;
  id: string;
}): ReactElement | null {
  if (!error) {
    return null;
  }
  return (
    <p className="text-destructive text-xs" id={id} role="alert">
      {error}
    </p>
  );
}

export const NATIVE_SELECT_CLASS =
  "h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive";
