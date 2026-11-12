import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import { Textarea } from "@cmis/ui/components/textarea";
import type { ItemDetailDto } from "@shared/schemas/inventory";
import { type FormEvent, type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage, fieldErrors } from "@/lib/api/errors";

import { useUpdateItem } from "../hooks/inventory-mutations";
import { useCategories } from "../hooks/inventory-queries";
import { NativeSelect } from "./native-select";

interface Draft {
  barcode: string;
  categoryId: string;
  lowStockThreshold: string;
  name: string;
  notes: string;
  packSize: string;
  packUnit: string;
  sku: string;
  strength: string;
  supplier: string;
  unit: string;
}

const WHOLE_NUMBER = /^\d+$/;

function toDraft(item: ItemDetailDto): Draft {
  return {
    barcode: item.barcode ?? "",
    categoryId: item.categoryId ?? "",
    lowStockThreshold: String(item.lowStockThreshold),
    name: item.name,
    notes: item.notes,
    packSize: item.packSize === null ? "" : String(item.packSize),
    packUnit: item.packUnit,
    sku: item.sku ?? "",
    strength: item.strength,
    supplier: item.supplier,
    unit: item.unit,
  };
}

function validate(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.name.trim() === "") {
    errors.name = "Enter the product name.";
  }
  if (draft.unit.trim() === "") {
    errors.unit = "Enter the unit.";
  }
  if (!WHOLE_NUMBER.test(draft.lowStockThreshold.trim())) {
    errors.lowStockThreshold = "Use a whole number, 0 or more.";
  }
  if (
    draft.packSize.trim() !== "" &&
    !WHOLE_NUMBER.test(draft.packSize.trim())
  ) {
    errors.packSize = "Use a whole number.";
  }
  return errors;
}

function orNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

function toBody(draft: Draft) {
  return {
    barcode: orNull(draft.barcode),
    categoryId: orNull(draft.categoryId),
    lowStockThreshold: Number(draft.lowStockThreshold),
    name: draft.name.trim(),
    notes: draft.notes.trim(),
    packSize: draft.packSize.trim() === "" ? null : Number(draft.packSize),
    packUnit: draft.packUnit.trim(),
    sku: orNull(draft.sku),
    strength: draft.strength.trim(),
    supplier: draft.supplier.trim(),
    unit: draft.unit.trim(),
  };
}

function TextField({
  error,
  label,
  onChange,
  value,
}: {
  error?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}): ReactElement {
  const id = useId();
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        id={id}
        onChange={(event) => onChange(event.target.value)}
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

export interface ItemEditPanelProps {
  item: ItemDetailDto;
  onDone: () => void;
}

/** Edits the product's details. Errors appear only after the first Save press. */
export function ItemEditPanel({
  item,
  onDone,
}: ItemEditPanelProps): ReactElement {
  const [draft, setDraft] = useState<Draft>(() => toDraft(item));
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const notesId = useId();
  const update = useUpdateItem(item.id);
  const { data: categories = [] } = useCategories();
  const errors = submitted ? { ...validate(draft), ...serverErrors } : {};
  const set = (key: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validate(draft)).length > 0) {
      return;
    }
    update.mutate(toBody(draft), {
      onError: (error) => {
        setServerErrors(fieldErrors(error));
        toast.error(errorMessage(error, "Could not save the product."));
      },
      onSuccess: () => {
        toast.success("Product updated.");
        onDone();
      },
    });
  };

  return (
    <form
      aria-label="Edit product"
      className="grid gap-3 md:grid-cols-2"
      noValidate
      onSubmit={submit}
    >
      <TextField
        error={errors.name}
        label="Name"
        onChange={set("name")}
        value={draft.name}
      />
      <TextField
        label="Strength"
        onChange={set("strength")}
        value={draft.strength}
      />
      <TextField
        error={errors.unit}
        label="Unit"
        onChange={set("unit")}
        value={draft.unit}
      />
      <NativeSelect
        label="Category"
        onChange={set("categoryId")}
        options={[
          { label: "Uncategorised", value: "" },
          ...categories.map((category) => ({
            label: category.name,
            value: category.id,
          })),
        ]}
        value={draft.categoryId}
      />
      <TextField
        label="Pack unit"
        onChange={set("packUnit")}
        value={draft.packUnit}
      />
      <TextField
        error={errors.packSize}
        label="Pack size"
        onChange={set("packSize")}
        value={draft.packSize}
      />
      <TextField
        label="Supplier"
        onChange={set("supplier")}
        value={draft.supplier}
      />
      <TextField
        error={errors.lowStockThreshold}
        label="Low-stock threshold"
        onChange={set("lowStockThreshold")}
        value={draft.lowStockThreshold}
      />
      <TextField
        error={errors.sku}
        label="SKU"
        onChange={set("sku")}
        value={draft.sku}
      />
      <TextField
        error={errors.barcode}
        label="Barcode"
        onChange={set("barcode")}
        value={draft.barcode}
      />
      <div className="grid gap-1 md:col-span-2">
        <Label htmlFor={notesId}>Notes</Label>
        <Textarea
          id={notesId}
          onChange={(event) => set("notes")(event.target.value)}
          value={draft.notes}
        />
      </div>
      <div className="flex justify-end gap-2 md:col-span-2">
        <Button onClick={onDone} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={update.isPending} type="submit">
          Save product
        </Button>
      </div>
    </form>
  );
}
