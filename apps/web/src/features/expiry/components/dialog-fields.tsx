import { Label } from "@cmis/ui/components/label";
import { Textarea } from "@cmis/ui/components/textarea";
import { MAX_NOTE_LENGTH } from "@shared/schemas/expiry";
import { type ReactElement, useId } from "react";

export interface ReasonOption {
  label: string;
  value: string;
}

export interface ReasonFieldProps {
  /** Shown only after the form was submitted. */
  error?: string;
  onChange: (value: string) => void;
  options: readonly ReasonOption[];
  value: string;
}

/** The required "Reason" select of the stock dialogs. Starts on a "Choose a reason" placeholder. */
export function ReasonField({
  error,
  onChange,
  options,
  value,
}: ReasonFieldProps): ReactElement {
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>Reason</Label>
      <select
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">Choose a reason</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldError error={error} id={`${id}-error`} />
    </div>
  );
}

export function NoteField({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}): ReactElement {
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>Note (optional)</Label>
      <Textarea
        id={id}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        value={value}
      />
    </div>
  );
}

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
