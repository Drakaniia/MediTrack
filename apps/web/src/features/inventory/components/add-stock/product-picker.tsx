import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import { Search } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { useItemSearch } from "../../hooks/inventory-queries";

const SEARCH_DEBOUNCE_MS = 250;

export interface ProductPickerProps {
  onSelect: (item: ItemSummaryDto) => void;
}

export function ProductPicker({ onSelect }: ProductPickerProps): ReactElement {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const results = useItemSearch(term, term !== "");
  const items = results.data ?? [];

  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
        />
        <Input
          aria-label="Find an existing product"
          className="pl-8"
          onChange={(event) => setText(event.target.value)}
          placeholder="Search by name, strength, SKU or barcode"
          type="search"
          value={text}
        />
      </div>
      {term !== "" && !results.isPending && items.length === 0 ? (
        <p className="text-muted-foreground text-sm" role="status">
          No product matches "{term}".
        </p>
      ) : null}
      <ul aria-label="Matching products" className="grid gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <Button
              className="w-full justify-between"
              onClick={() => onSelect(item)}
              variant="outline"
            >
              <span className="truncate">{item.displayName}</span>
              <span className="text-muted-foreground text-xs">
                {item.onHand} {item.unit} on hand
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
