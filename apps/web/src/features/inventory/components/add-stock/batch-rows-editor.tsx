import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import { isIsoDate } from "@shared/dates";
import { isExpired } from "@shared/expiry";
import { Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { type ReactElement, useId } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";

import {
  type BatchDraftRow,
  newBatchRow,
  otherNumbers,
  type RowError,
} from "../../lib/batch-rows";

export interface BatchRowsEditorProps {
  errors: ReadonlyMap<string, RowError>;
  hasExpiry: boolean;
  onChange: (rows: BatchDraftRow[]) => void;
  rows: readonly BatchDraftRow[];
  /** A fresh batch number that avoids the `taken` ones (server for existing items). */
  suggest: (taken: string[]) => Promise<string>;
  today: string;
}

interface FieldProps {
  error?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}

function Field({
  error,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: FieldProps): ReactElement {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        id={id}
        inputMode={type === "number" ? "numeric" : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {error ? (
        <p className="text-destructive text-xs" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ExpiredNotice({ expiry, today }: { expiry: string; today: string }) {
  if (!(isIsoDate(expiry) && isExpired(expiry, today))) {
    return null;
  }
  return (
    <p
      className="flex items-center gap-1.5 text-expiry-urgent text-xs md:col-span-2"
      role="status"
    >
      <TriangleAlert aria-hidden className="size-3.5" />
      This date has already passed. The batch is accepted but quarantined for
      disposal.
    </p>
  );
}

function BatchRowFields({
  error,
  hasExpiry,
  index,
  onChange,
  onRemove,
  onSuggest,
  row,
  today,
}: {
  error?: RowError;
  hasExpiry: boolean;
  index: number;
  onChange: (patch: Partial<BatchDraftRow>) => void;
  onRemove: () => void;
  onSuggest: () => void;
  row: BatchDraftRow;
  today: string;
}): ReactElement {
  const label = `Batch ${index + 1}`;
  return (
    <li>
      <fieldset className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
        <legend className="px-1 font-medium text-sm">{label}</legend>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field
              error={error?.batchNumber}
              label={`${label} number`}
              onChange={(batchNumber) => onChange({ batchNumber })}
              placeholder="Leave blank to number automatically"
              value={row.batchNumber}
            />
          </div>
          <Button
            aria-label={`Suggest ${label} number`}
            onClick={onSuggest}
            size="icon"
            type="button"
            variant="outline"
          >
            <Sparkles aria-hidden />
          </Button>
        </div>
        {hasExpiry ? (
          <Field
            error={error?.expiry}
            label={`${label} expiry date`}
            onChange={(expiry) => onChange({ expiry })}
            type="date"
            value={row.expiry}
          />
        ) : null}
        <Field
          error={error?.qty}
          label={`${label} quantity`}
          onChange={(qty) => onChange({ qty })}
          type="number"
          value={row.qty}
        />
        <Field
          label={`${label} supplier`}
          onChange={(supplier) => onChange({ supplier })}
          value={row.supplier}
        />
        <ExpiredNotice expiry={row.expiry} today={today} />
        <div className="flex justify-end md:col-span-2">
          <Button
            aria-label={`Remove ${label}`}
            onClick={onRemove}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden data-icon="inline-start" />
            Remove
          </Button>
        </div>
      </fieldset>
    </li>
  );
}

export function BatchRowsEditor({
  errors,
  hasExpiry,
  onChange,
  rows,
  suggest,
  today,
}: BatchRowsEditorProps): ReactElement {
  const patchRow = (key: string, patch: Partial<BatchDraftRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const removeRow = (key: string) => {
    const remaining = rows.filter((row) => row.key !== key);
    onChange(remaining.length > 0 ? remaining : [newBatchRow()]);
  };

  const suggestFor = async (key: string) => {
    try {
      const batchNumber = await suggest(otherNumbers(rows, key));
      patchRow(key, { batchNumber });
    } catch (error) {
      toast.error(errorMessage(error, "Could not suggest a batch number."));
    }
  };

  return (
    <section aria-label="Batches" className="grid gap-3">
      <ul className="grid gap-3">
        {rows.map((row, index) => (
          <BatchRowFields
            error={errors.get(row.key)}
            hasExpiry={hasExpiry}
            index={index}
            key={row.key}
            onChange={(patch) => patchRow(row.key, patch)}
            onRemove={() => removeRow(row.key)}
            onSuggest={() => suggestFor(row.key)}
            row={row}
            today={today}
          />
        ))}
      </ul>
      <div>
        <Button
          onClick={() => onChange([...rows, newBatchRow()])}
          type="button"
          variant="outline"
        >
          <Plus aria-hidden data-icon="inline-start" />
          Add another batch
        </Button>
      </div>
    </section>
  );
}
