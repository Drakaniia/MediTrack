import { Checkbox } from "@cmis/ui/components/checkbox";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import type { ReactElement } from "react";
import { useId } from "react";

import { useCategories } from "../../hooks/inventory-queries";
import { NativeSelect } from "../native-select";

export interface NewProductDraft {
  barcode: string;
  categoryId: string;
  hasExpiry: boolean;
  lowStockThreshold: string;
  name: string;
  sku: string;
  strength: string;
  supplier: string;
  unit: string;
}

export const EMPTY_PRODUCT: NewProductDraft = {
  barcode: "",
  categoryId: "",
  hasExpiry: true,
  lowStockThreshold: "",
  name: "",
  sku: "",
  strength: "",
  supplier: "",
  unit: "tab",
};

const WHOLE_NUMBER = /^\d+$/;

export function validateProduct(
  draft: NewProductDraft
): Partial<Record<keyof NewProductDraft, string>> {
  const errors: Partial<Record<keyof NewProductDraft, string>> = {};
  if (draft.name.trim() === "") {
    errors.name = "Enter the product name.";
  }
  if (draft.unit.trim() === "") {
    errors.unit = "Enter the unit, for example tab or box.";
  }
  const threshold = draft.lowStockThreshold.trim();
  if (threshold !== "" && !WHOLE_NUMBER.test(threshold)) {
    errors.lowStockThreshold = "Use a whole number, 0 or more.";
  }
  return errors;
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

export interface NewProductFieldsProps {
  draft: NewProductDraft;
  /** Errors to display; the page passes an empty object until the user submits. */
  errors: Partial<Record<keyof NewProductDraft, string>>;
  onChange: (draft: NewProductDraft) => void;
}

export function NewProductFields({
  draft,
  errors,
  onChange,
}: NewProductFieldsProps): ReactElement {
  const { data: categories = [] } = useCategories();
  const expiryId = useId();
  const set = (key: keyof NewProductDraft) => (value: string) =>
    onChange({ ...draft, [key]: value });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField
        error={errors.name}
        label="Product name"
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
        error={errors.lowStockThreshold}
        label="Low-stock threshold"
        onChange={set("lowStockThreshold")}
        value={draft.lowStockThreshold}
      />
      <TextField
        label="Supplier"
        onChange={set("supplier")}
        value={draft.supplier}
      />
      <TextField label="SKU" onChange={set("sku")} value={draft.sku} />
      <TextField
        label="Barcode"
        onChange={set("barcode")}
        value={draft.barcode}
      />
      <div className="flex items-center gap-2 md:col-span-2">
        <Checkbox
          checked={draft.hasExpiry}
          id={expiryId}
          onCheckedChange={(checked) =>
            onChange({ ...draft, hasExpiry: checked === true })
          }
        />
        <Label htmlFor={expiryId}>This product has an expiry date</Label>
      </div>
    </div>
  );
}
