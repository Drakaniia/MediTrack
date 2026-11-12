import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import { assessExpiry } from "@shared/expiry";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import { type ReactElement, useId, useState } from "react";

import { ExpiryBadge } from "@/components/expiry-badge";
import { useFacility } from "@/lib/auth/guards";
import { formatDate, formatQuantity } from "@/lib/format";
import { useItemSearch } from "../hooks/request-queries";
import { useDebouncedValue } from "../hooks/use-debounced-value";

export interface ItemPickerProps {
  disabled?: boolean;
  error?: string;
  label?: string;
  onPick: (item: ItemSummaryDto) => void;
}

/** What the picker shows for an item: availability and the nearest expiry as a badge. */
export function ItemAvailability({
  item,
}: {
  item: Pick<ItemSummaryDto, "available" | "nearestExpiry" | "unit">;
}): ReactElement {
  const { nearDays, today, urgentDays } = useFacility();
  const assessment =
    item.nearestExpiry === null
      ? null
      : assessExpiry(item.nearestExpiry, today, { nearDays, urgentDays });
  return (
    <span className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
      <span>{formatQuantity(item.available, item.unit)} available</span>
      {assessment && item.nearestExpiry ? (
        <>
          <ExpiryBadge
            daysUntil={assessment.daysUntil}
            expiryClass={assessment.expiryClass}
          />
          <span>nearest expiry {formatDate(item.nearestExpiry)}</span>
        </>
      ) : null}
    </span>
  );
}

/** Type to search `GET /api/items?search=`; click a result to pick it. */
export function ItemPicker({
  disabled,
  error,
  label = "Item",
  onPick,
}: ItemPickerProps): ReactElement {
  const inputId = useId();
  const listId = useId();
  const [text, setText] = useState("");
  const search = useDebouncedValue(text);
  const results = useItemSearch(search);
  const items = results.data ?? [];

  return (
    <div className="grid gap-1">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        aria-controls={listId}
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        disabled={disabled}
        id={inputId}
        onChange={(event) => setText(event.target.value)}
        placeholder="Search by name, SKU or barcode"
        type="search"
        value={text}
      />
      {error ? (
        <p
          className="text-destructive text-xs"
          id={`${inputId}-error`}
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <ul
        aria-label="Matching items"
        className="max-h-44 divide-y overflow-y-auto rounded-md border"
        id={listId}
      >
        {items.length === 0 ? (
          <li className="p-2 text-muted-foreground text-xs">
            {results.isPending ? "Searching…" : "No items match."}
          </li>
        ) : (
          items.map((item) => (
            <li key={item.id}>
              <button
                className="grid w-full gap-0.5 p-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => onPick(item)}
                type="button"
              >
                <span className="text-sm">{item.displayName}</span>
                <ItemAvailability item={item} />
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
