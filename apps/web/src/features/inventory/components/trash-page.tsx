import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import { type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { errorMessage } from "@/lib/api/errors";
import { useFacility } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";

import {
  type TrashKind,
  usePurgeTrash,
  useRestoreTrash,
} from "../hooks/inventory-mutations";
import { useTrash } from "../hooks/inventory-queries";

export const PURGE_CONFIRMATION = "DELETE";

interface TrashEntry {
  deletedAt: string;
  deletedBy: string | null;
  detail: string;
  id: string;
  kind: TrashKind;
  note?: string;
  title: string;
}

interface Tab {
  kind: TrashKind;
  label: string;
}

const TABS: Tab[] = [
  { kind: "item", label: "Products" },
  { kind: "batch", label: "Batches" },
];

function PurgeDialog({
  entry,
  onCancel,
  onConfirm,
  pending,
}: {
  entry: TrashEntry;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}): ReactElement {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onCancel())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete "{entry.title}" permanently?</DialogTitle>
          <DialogDescription>
            This cannot be undone. Stock history keeps its record of the{" "}
            {entry.kind === "item" ? "product" : "batch"}, but it can never be
            restored.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          <Label htmlFor={inputId}>Type {PURGE_CONFIRMATION} to confirm</Label>
          <Input
            autoComplete="off"
            id={inputId}
            onChange={(event) => setTyped(event.target.value)}
            value={typed}
          />
        </div>
        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={typed !== PURGE_CONFIRMATION || pending}
            onClick={onConfirm}
            variant="destructive"
          >
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EntryRow({
  entry,
  onPurge,
  onRestore,
  pending,
  timezone,
}: {
  entry: TrashEntry;
  onPurge: () => void;
  onRestore: () => void;
  pending: boolean;
  timezone: string;
}): ReactElement {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0">
      <span className="min-w-0">
        <span className="block truncate font-medium text-sm">
          {entry.title}
        </span>
        <span className="block text-muted-foreground text-xs">
          {entry.detail} · Deleted {formatDateTime(entry.deletedAt, timezone)}
          {entry.deletedBy ? ` by ${entry.deletedBy}` : ""}
        </span>
        {entry.note ? (
          <span className="block text-muted-foreground text-xs">
            {entry.note}
          </span>
        ) : null}
      </span>
      <span className="flex gap-1">
        <Button
          aria-label={`Restore ${entry.title}`}
          disabled={pending}
          onClick={onRestore}
          size="sm"
          variant="outline"
        >
          Restore
        </Button>
        <Button
          aria-label={`Delete ${entry.title} permanently`}
          onClick={onPurge}
          size="sm"
          variant="ghost"
        >
          Delete permanently
        </Button>
      </span>
    </li>
  );
}

export function TrashPage(): ReactElement {
  const { timezone } = useFacility();
  const [kind, setKind] = useState<TrashKind>("item");
  const [purging, setPurging] = useState<TrashEntry | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const query = useTrash();
  const restore = useRestoreTrash();
  const purge = usePurgeTrash();

  const items: TrashEntry[] = (query.data?.items ?? []).map((item) => ({
    deletedAt: item.deletedAt,
    deletedBy: item.deletedBy,
    detail: `${item.batchCount} ${item.batchCount === 1 ? "batch" : "batches"}, ${item.onHand} on hand`,
    id: item.id,
    kind: "item",
    title: item.displayName,
  }));
  const batches: TrashEntry[] = (query.data?.batches ?? []).map((batch) => ({
    deletedAt: batch.deletedAt,
    deletedBy: batch.deletedBy,
    detail: `${batch.itemName} · ${batch.qty} units${batch.expiry ? ` · expires ${batch.expiry}` : ""}`,
    id: batch.id,
    kind: "batch",
    note: batch.deletedWithItem
      ? "Deleted together with its product. Restore the product to bring it back."
      : undefined,
    title: `Batch ${batch.batchNumber}`,
  }));
  const entries = kind === "item" ? items : batches;

  const doRestore = (entry: TrashEntry) => {
    setConflict(null);
    restore.mutate(
      { id: entry.id, kind: entry.kind },
      {
        onError: (error) => {
          const message = errorMessage(error, "Could not restore.");
          setConflict(message);
          toast.error(message);
        },
        onSuccess: () => toast.success(`Restored ${entry.title}.`),
      }
    );
  };

  const doPurge = (entry: TrashEntry) => {
    purge.mutate(
      { id: entry.id, kind: entry.kind },
      {
        onError: (error) =>
          toast.error(errorMessage(error, "Could not delete permanently.")),
        onSettled: () => setPurging(null),
        onSuccess: () => toast.success(`Permanently deleted ${entry.title}.`),
      }
    );
  };

  return (
    <div>
      <PageHeader
        description="Deleted products and batches stay here until you restore or erase them."
        title="Trash"
      />
      <fieldset className="m-0 flex min-w-0 gap-1 border-0 p-0 pb-3">
        <legend className="sr-only">Trash sections</legend>
        {TABS.map((tab) => (
          <Button
            aria-pressed={kind === tab.kind}
            key={tab.kind}
            onClick={() => setKind(tab.kind)}
            size="sm"
            variant={kind === tab.kind ? "secondary" : "ghost"}
          >
            {tab.label} ({tab.kind === "item" ? items.length : batches.length})
          </Button>
        ))}
      </fieldset>
      {conflict ? (
        <p
          className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
          role="alert"
        >
          {conflict}
        </p>
      ) : null}
      <DataState
        empty={{
          description: "Nothing deleted in this section.",
          title: "The Trash is empty",
        }}
        error={query.error}
        isEmpty={entries.length === 0}
        isLoading={query.isPending}
        onRetry={() => query.refetch()}
      >
        <ul aria-label="Deleted entries" className="rounded-lg border">
          {entries.map((entry) => (
            <EntryRow
              entry={entry}
              key={entry.id}
              onPurge={() => setPurging(entry)}
              onRestore={() => doRestore(entry)}
              pending={restore.isPending}
              timezone={timezone}
            />
          ))}
        </ul>
      </DataState>
      {purging ? (
        <PurgeDialog
          entry={purging}
          onCancel={() => setPurging(null)}
          onConfirm={() => doPurge(purging)}
          pending={purge.isPending}
        />
      ) : null}
    </div>
  );
}
