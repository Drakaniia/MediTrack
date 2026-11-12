import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import type { ItemSummaryDto } from "@shared/schemas/inventory";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, PackagePlus, Search } from "lucide-react";
import { type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";
import { formatDate, formatQuantity } from "@/lib/format";

import {
  fetchExpiringSoon,
  fetchRecentlyReceived,
  useDebouncedValue,
  useItemSearch,
  useItemWithBatches,
} from "../hooks/label-queries";
import type { LabelSelection } from "../hooks/use-label-selection";
import type { LabelBatch } from "../lib/label-layout";
import { labelBatchFromDto } from "../lib/label-source";

function ItemBatches({
  itemId,
  selection,
}: {
  itemId: string;
  selection: LabelSelection;
}): ReactElement {
  const detail = useItemWithBatches(itemId);
  if (detail.isPending) {
    return <p className="text-muted-foreground text-sm">Loading batches…</p>;
  }
  if (detail.isError || !detail.data) {
    return <p className="text-destructive text-sm" role="alert">Could not load this item's batches.</p>;
  }
  const item = detail.data;
  if (item.batches.length === 0) {
    return <p className="text-muted-foreground text-sm">This item has no batches yet.</p>;
  }
  const all = item.batches.map((batch) => labelBatchFromDto(batch, item));
  return (
    <fieldset className="space-y-1">
      <legend className="font-medium text-sm">Batches of {item.displayName}</legend>
      <ul className="divide-y rounded-lg border">
        {item.batches.map((batch, index) => (
          <li key={batch.id}>
            <label className="tap-target flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <input
                checked={selection.has(batch.id)}
                className="size-4 accent-primary"
                onChange={() => selection.toggle(all[index])}
                type="checkbox"
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{batch.batchNumber}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {batch.expiry ? `expires ${formatDate(batch.expiry)}` : "no expiry"} ·{" "}
                  {formatQuantity(batch.qty, item.unit)}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Button
        onClick={() => selection.addMany(all)}
        size="sm"
        type="button"
        variant="outline"
      >
        Select all {all.length} {all.length === 1 ? "batch" : "batches"}
      </Button>
    </fieldset>
  );
}

function SearchResults({
  onOpen,
  openId,
  term,
}: {
  onOpen: (itemId: string) => void;
  openId: string | null;
  term: string;
}): ReactElement | null {
  const results = useItemSearch(term);
  if (term.trim() === "") {
    return null;
  }
  if (results.isPending) {
    return <p className="text-muted-foreground text-sm">Searching…</p>;
  }
  if (results.isError) {
    return <p className="text-destructive text-sm" role="alert">Search failed. Try again.</p>;
  }
  const items: ItemSummaryDto[] = results.data ?? [];
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">No items match “{term.trim()}”.</p>;
  }
  return (
    <ul aria-label="Matching items" className="divide-y rounded-lg border">
      {items.map((item) => (
        <li key={item.id}>
          <Button
            aria-pressed={openId === item.id}
            className="tap-target h-auto w-full justify-start rounded-none py-2 text-left aria-pressed:bg-muted"
            onClick={() => onOpen(item.id)}
            variant="ghost"
          >
            {item.displayName}
          </Button>
        </li>
      ))}
    </ul>
  );
}

async function runQuickAdd(
  load: () => Promise<LabelBatch[]>,
  selection: LabelSelection,
  emptyMessage: string
): Promise<void> {
  try {
    const found = await load();
    if (found.length === 0) {
      toast.info(emptyMessage);
      return;
    }
    const added = selection.addMany(found);
    toast.success(`Added ${added} ${added === 1 ? "batch" : "batches"}.`);
  } catch (error) {
    toast.error(errorMessage(error, "Could not load those batches."));
  }
}

/** Finds batches to label: search an item and tick its batches, or add a ready-made set. */
export function LabelPicker({ selection }: { selection: LabelSelection }): ReactElement {
  const searchId = useId();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const debounced = useDebouncedValue(term);

  return (
    <section aria-label="Choose batches" className="space-y-4">
      <div className="space-y-2">
        <label className="font-medium text-sm" htmlFor={searchId}>
          Search items
        </label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoComplete="off"
            className="tap-target pl-8"
            id={searchId}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Name, SKU or barcode"
            type="search"
            value={term}
          />
        </div>
        <SearchResults onOpen={setOpenItemId} openId={openItemId} term={debounced} />
      </div>
      {openItemId ? <ItemBatches itemId={openItemId} selection={selection} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          className="tap-target"
          onClick={() =>
            void runQuickAdd(
              () => fetchExpiringSoon(queryClient),
              selection,
              "No batches are expiring soon."
            )
          }
          type="button"
          variant="outline"
        >
          <Clock aria-hidden />
          Add batches expiring soon
        </Button>
        <Button
          className="tap-target"
          onClick={() =>
            void runQuickAdd(
              () => fetchRecentlyReceived(queryClient),
              selection,
              "No recent batches found."
            )
          }
          type="button"
          variant="outline"
        >
          <PackagePlus aria-hidden />
          Add recent batches
        </Button>
      </div>
    </section>
  );
}
