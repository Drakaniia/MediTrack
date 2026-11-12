import { Button } from "@cmis/ui/components/button";
import type { FefoEntryDto } from "@shared/schemas/inventory";
import type { ReactElement } from "react";
import { useState } from "react";

import { DataState } from "@/components/data-state";
import { ExpiryBadge } from "@/components/expiry-badge";
import { PageHeader } from "@/components/page-header";
import { formatDate, formatQuantity } from "@/lib/format";

import { useCategories, useFefoList } from "../hooks/inventory-queries";
import { useStockItemDetailDialog } from "../stock-item-detail-dialog-context";
import { NativeSelect } from "./native-select";

function FefoRow({
  entry,
  onOpen,
}: {
  entry: FefoEntryDto;
  onOpen: (itemId: string, batchId: string) => void;
}): ReactElement {
  const { batch, item } = entry;
  return (
    <li className="grid items-center gap-2 border-b px-3 py-2 last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
      <span className="min-w-0">
        <span className="block truncate font-medium text-sm">
          {item.displayName}
        </span>
        <span className="block truncate text-muted-foreground text-xs">
          {item.categoryName ?? "Uncategorised"}
        </span>
      </span>
      <span className="text-sm">
        <span className="block">Batch {batch.batchNumber}</span>
        <span className="block text-muted-foreground text-xs">
          {formatQuantity(batch.qty, item.unit)}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-sm">
        {batch.expiry ? formatDate(batch.expiry) : "No expiry"}
        <ExpiryBadge
          daysUntil={batch.daysUntil}
          expiryClass={batch.expiryClass}
        />
      </span>
      <Button
        aria-label={`Open ${item.displayName}`}
        onClick={() => onOpen(item.id, batch.id)}
        size="sm"
        variant="outline"
      >
        Details
      </Button>
    </li>
  );
}

/** "Use first": the next batch to pull for every item, earliest expiry first. */
export function FefoPage(): ReactElement {
  const [categoryId, setCategoryId] = useState("");
  const { data: categories = [] } = useCategories();
  const query = useFefoList(categoryId);
  const { openItemDetail } = useStockItemDetailDialog();
  const entries = query.data ?? [];

  return (
    <div>
      <PageHeader
        description="For each product, the batch to use next: the one that expires first."
        title="Use first"
      />
      <div className="max-w-xs pb-4">
        <NativeSelect
          label="Category"
          onChange={setCategoryId}
          options={[
            { label: "All categories", value: "" },
            ...categories.map((category) => ({
              label: category.name,
              value: category.id,
            })),
          ]}
          value={categoryId}
        />
      </div>
      <DataState
        empty={{
          description: "Products with usable stock will be listed here.",
          title: "Nothing to use right now",
        }}
        error={query.error}
        isEmpty={entries.length === 0}
        isLoading={query.isPending}
        onRetry={() => query.refetch()}
      >
        <ul aria-label="Batches to use first" className="rounded-lg border">
          {entries.map((entry) => (
            <FefoRow
              entry={entry}
              key={entry.batch.id}
              onOpen={(itemId, batchId) => openItemDetail(itemId, { batchId })}
            />
          ))}
        </ul>
      </DataState>
    </div>
  );
}
