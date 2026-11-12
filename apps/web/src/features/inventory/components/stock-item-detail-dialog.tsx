import { Button, buttonVariants } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import type { BatchDto, ItemDetailDto } from "@shared/schemas/inventory";
import { Link } from "@tanstack/react-router";
import { ClipboardPlus, PackagePlus, Pencil, Trash2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/components/can";
import { DataState } from "@/components/data-state";
import { ExpiryBadge } from "@/components/expiry-badge";
import { useNewRequestDialog } from "@/features/requests/new-request-dialog-context";
import { errorMessage } from "@/lib/api/errors";
import { formatQuantity } from "@/lib/format";

import { useDeleteBatch, useDeleteItem } from "../hooks/inventory-mutations";
import { useItemDetail } from "../hooks/inventory-queries";
import { BatchEditDialog } from "./batch-edit-dialog";
import { BatchesTable } from "./batches-table";
import { ConfirmDialog } from "./confirm-dialog";
import { ItemEditPanel } from "./item-edit-panel";
import { ItemHistory } from "./item-history";
import { LowStockChip } from "./stock-chip";

type Tab = "batches" | "edit" | "history";

const TABS: { label: string; value: Tab }[] = [
  { label: "Batches", value: "batches" },
  { label: "History", value: "history" },
];

export interface StockItemDetailDialogProps {
  batchId?: string;
  itemId: string | null;
  onClose: () => void;
}

interface BatchGroups {
  active: BatchDto[];
  inactive: BatchDto[];
  quarantined: BatchDto[];
}

function groupBatches(batches: readonly BatchDto[]): BatchGroups {
  const groups: BatchGroups = { active: [], inactive: [], quarantined: [] };
  for (const batch of batches) {
    if (batch.fefoRank !== null) {
      groups.active.push(batch);
    } else if (batch.quarantined) {
      groups.quarantined.push(batch);
    } else {
      groups.inactive.push(batch);
    }
  }
  return groups;
}

function Summary({ item }: { item: ItemDetailDto }): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ExpiryBadge expiryClass={item.worstClass} />
      <LowStockChip status={item.lowStock} />
      <span className="text-sm">
        {formatQuantity(item.onHand, item.unit)} on hand
        {item.available === item.onHand ? "" : `, ${item.available} available`}
      </span>
      {item.lowStockThreshold > 0 ? (
        <span className="text-muted-foreground text-xs">
          Low-stock level {item.lowStockThreshold}
        </span>
      ) : null}
    </div>
  );
}

function BatchSection({
  batches,
  caption,
  focusBatchId,
  heading,
  onDelete,
  onEdit,
  unit,
}: {
  batches: readonly BatchDto[];
  caption: string;
  focusBatchId?: string;
  heading: string;
  onDelete: (batch: BatchDto) => void;
  onEdit: (batch: BatchDto) => void;
  unit: string;
}): ReactElement | null {
  if (batches.length === 0) {
    return null;
  }
  return (
    <section aria-label={heading} className="grid gap-2">
      <h3 className="font-medium text-sm">{heading}</h3>
      <BatchesTable
        batches={batches}
        caption={caption}
        focusBatchId={focusBatchId}
        onDelete={onDelete}
        onEdit={onEdit}
        unit={unit}
      />
    </section>
  );
}

function BatchesTab({
  focusBatchId,
  item,
  onDelete,
  onEdit,
}: {
  focusBatchId?: string;
  item: ItemDetailDto;
  onDelete: (batch: BatchDto) => void;
  onEdit: (batch: BatchDto) => void;
}): ReactElement {
  const groups = groupBatches(item.batches);
  if (item.batches.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-muted-foreground text-sm">
        No batches yet. Add stock to start tracking expiry dates.
      </p>
    );
  }
  const shared = { focusBatchId, onDelete, onEdit, unit: item.unit };
  return (
    <div className="grid gap-4">
      <BatchSection
        {...shared}
        batches={groups.active}
        caption="Batches in first-expired-first-out order"
        heading="Use in this order"
      />
      <BatchSection
        {...shared}
        batches={groups.quarantined}
        caption="Expired batches waiting for disposal"
        heading="Quarantined (expired)"
      />
      <BatchSection
        {...shared}
        batches={groups.inactive}
        caption="Empty or disposed batches"
        heading="Empty or disposed"
      />
    </div>
  );
}

function TabSwitch({
  onChange,
  value,
}: {
  onChange: (tab: Tab) => void;
  value: Tab;
}): ReactElement {
  return (
    <fieldset className="m-0 flex min-w-0 gap-1 border-0 p-0">
      <legend className="sr-only">Item sections</legend>
      {TABS.map((tab) => (
        <Button
          aria-pressed={value === tab.value}
          key={tab.value}
          onClick={() => onChange(tab.value)}
          size="sm"
          variant={value === tab.value ? "secondary" : "ghost"}
        >
          {tab.label}
        </Button>
      ))}
    </fieldset>
  );
}

function ItemActions({
  item,
  onClose,
  onDelete,
  onEdit,
}: {
  item: ItemDetailDto;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
}): ReactElement {
  const { openNewRequest } = useNewRequestDialog();
  return (
    <div className="flex flex-wrap gap-2">
      <Can permission="requests.create">
        <Button
          onClick={() => {
            onClose();
            openNewRequest({ itemId: item.id });
          }}
        >
          <ClipboardPlus aria-hidden data-icon="inline-start" />
          New request for this stock
        </Button>
      </Can>
      <Can permission="inventory.write">
        <Link
          className={buttonVariants({ variant: "outline" })}
          onClick={onClose}
          search={{ itemId: item.id }}
          to="/inventory/add"
        >
          <PackagePlus aria-hidden data-icon="inline-start" />
          Add batch
        </Link>
        <Button onClick={onEdit} variant="outline">
          <Pencil aria-hidden data-icon="inline-start" />
          Edit product
        </Button>
      </Can>
      <Can permission="inventory.delete">
        <Button onClick={onDelete} variant="outline">
          <Trash2 aria-hidden data-icon="inline-start" />
          Delete product
        </Button>
      </Can>
    </div>
  );
}

type Confirm =
  | { batch: BatchDto; kind: "batch" }
  | { kind: "item" }
  | { kind: "none" };

function DialogBody({
  batchId,
  item,
  onClose,
}: {
  batchId?: string;
  item: ItemDetailDto;
  onClose: () => void;
}): ReactElement {
  const [tab, setTab] = useState<Tab>("batches");
  const [editingBatch, setEditingBatch] = useState<BatchDto | null>(null);
  const [confirm, setConfirm] = useState<Confirm>({ kind: "none" });
  const removeItem = useDeleteItem();
  const removeBatch = useDeleteBatch();

  const confirmDelete = () => {
    if (confirm.kind === "item") {
      removeItem.mutate(item.id, {
        onError: (error) =>
          toast.error(errorMessage(error, "Could not delete the product.")),
        onSuccess: () => {
          toast.success(`Moved "${item.displayName}" to the Trash.`);
          onClose();
        },
      });
    } else if (confirm.kind === "batch") {
      const { batch } = confirm;
      removeBatch.mutate(batch.id, {
        onError: (error) =>
          toast.error(errorMessage(error, "Could not delete the batch.")),
        onSuccess: () => {
          toast.success(`Moved batch ${batch.batchNumber} to the Trash.`);
          setConfirm({ kind: "none" });
        },
      });
    }
  };

  return (
    <div className="grid gap-4">
      <Summary item={item} />
      <ItemActions
        item={item}
        onClose={onClose}
        onDelete={() => setConfirm({ kind: "item" })}
        onEdit={() => setTab("edit")}
      />
      {tab === "edit" ? (
        <ItemEditPanel item={item} onDone={() => setTab("batches")} />
      ) : (
        <>
          <TabSwitch onChange={setTab} value={tab} />
          {tab === "batches" ? (
            <BatchesTab
              focusBatchId={batchId}
              item={item}
              onDelete={(batch) => setConfirm({ batch, kind: "batch" })}
              onEdit={setEditingBatch}
            />
          ) : (
            <ItemHistory itemId={item.id} />
          )}
        </>
      )}
      {editingBatch ? (
        <BatchEditDialog
          batch={editingBatch}
          hasExpiry={item.hasExpiry}
          onClose={() => setEditingBatch(null)}
        />
      ) : null}
      {confirm.kind === "none" ? null : (
        <ConfirmDialog
          confirmLabel="Move to Trash"
          description="An administrator can restore it from the Trash later."
          destructive
          onCancel={() => setConfirm({ kind: "none" })}
          onConfirm={confirmDelete}
          pending={removeItem.isPending || removeBatch.isPending}
          title={
            confirm.kind === "item"
              ? `Move "${item.displayName}" to the Trash?`
              : `Move batch ${confirm.batch.batchNumber} to the Trash?`
          }
        />
      )}
    </div>
  );
}

export function StockItemDetailDialog({
  batchId,
  itemId,
  onClose,
}: StockItemDetailDialogProps): ReactElement {
  const query = useItemDetail(itemId);
  const item = query.data;
  return (
    <Dialog
      onOpenChange={(open) => (open ? undefined : onClose())}
      open={itemId !== null}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{item?.displayName ?? "Item details"}</DialogTitle>
          <DialogDescription>
            {item
              ? `${item.categoryName ?? "Uncategorised"}${item.sku ? ` · SKU ${item.sku}` : ""}`
              : "Stock, batches and history"}
          </DialogDescription>
        </DialogHeader>
        <DataState
          error={query.error}
          isLoading={query.isPending}
          onRetry={() => query.refetch()}
        >
          {item ? (
            <DialogBody batchId={batchId} item={item} onClose={onClose} />
          ) : null}
        </DataState>
      </DialogContent>
    </Dialog>
  );
}
