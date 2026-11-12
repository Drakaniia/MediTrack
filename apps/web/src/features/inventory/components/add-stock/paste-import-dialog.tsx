import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { Label } from "@cmis/ui/components/label";
import { Textarea } from "@cmis/ui/components/textarea";
import type { BulkImportResultDto } from "@shared/schemas/inventory";
import { type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage, isApiError } from "@/lib/api/errors";

import { useBulkImport } from "../../hooks/inventory-mutations";
import { type ParsedPaste, parsePaste } from "../../lib/paste";

interface RowIssue {
  field: string;
  message: string;
  row: number;
}

function issuesFrom(error: unknown): RowIssue[] {
  if (!(isApiError(error) && error.code === "validation_error")) {
    return [];
  }
  const details = error.details as { issues?: Partial<RowIssue>[] } | undefined;
  return (details?.issues ?? []).flatMap((issue) =>
    typeof issue.row === "number" && typeof issue.message === "string"
      ? [{ field: issue.field ?? "", message: issue.message, row: issue.row }]
      : []
  );
}

function Summary({ result }: { result: BulkImportResultDto }): ReactElement {
  return (
    <p className="rounded-lg border bg-muted p-3 text-sm" role="status">
      Ready: {result.items} new {result.items === 1 ? "product" : "products"}
      {result.existingItems > 0
        ? `, ${result.existingItems} existing ${result.existingItems === 1 ? "product" : "products"} getting new batches`
        : ""}
      , {result.batches} {result.batches === 1 ? "batch" : "batches"}
      {result.categories > 0 ? `, ${result.categories} new categories` : ""}.
    </p>
  );
}

function Issues({ issues }: { issues: readonly RowIssue[] }): ReactElement {
  return (
    <div className="grid gap-1" role="alert">
      <p className="font-medium text-destructive text-sm">
        {issues.length} {issues.length === 1 ? "problem" : "problems"} to fix.
        Nothing was imported.
      </p>
      <ul className="max-h-48 list-disc overflow-auto pl-5 text-sm">
        {issues.map((issue) => (
          <li key={`${issue.row}-${issue.field}-${issue.message}`}>
            Row {issue.row}
            {issue.field ? ` (${issue.field})` : ""}: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PasteImportDialog({
  onClose,
}: {
  onClose: () => void;
}): ReactElement {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedPaste | null>(null);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [preview, setPreview] = useState<BulkImportResultDto | null>(null);
  const textId = useId();
  const bulk = useBulkImport();

  const run = (dryRun: boolean) => {
    const next = parsePaste(text);
    setParsed(next);
    setIssues([]);
    setPreview(null);
    if (next.rows.length === 0) {
      return;
    }
    bulk.mutate(
      { dryRun, rows: next.rows },
      {
        onError: (error) => {
          const found = issuesFrom(error);
          setIssues(found);
          if (found.length === 0) {
            toast.error(errorMessage(error, "The import failed."));
          }
        },
        onSuccess: (result) => {
          if (dryRun) {
            setPreview(result);
            return;
          }
          toast.success(
            `Imported ${result.items} new and ${result.existingItems} existing products with ${result.batches} batches.`
          );
          onClose();
        },
      }
    );
  };

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste from a spreadsheet</DialogTitle>
          <DialogDescription>
            Copy rows from Excel, Sheets or a CSV. Use a header row (name,
            strength, batch, expiry, qty, unit, category, supplier…) or paste
            the columns in that order. Every row is checked before anything is
            saved.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          <Label htmlFor={textId}>Pasted rows</Label>
          <Textarea
            className="min-h-40 font-mono text-xs"
            id={textId}
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
            }}
            value={text}
          />
        </div>
        {parsed && parsed.rows.length === 0 ? (
          <p className="text-destructive text-sm" role="alert">
            No rows found in the pasted text.
          </p>
        ) : null}
        {parsed && parsed.unmappedHeaders.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Ignored columns: {parsed.unmappedHeaders.join(", ")}.
          </p>
        ) : null}
        {issues.length > 0 ? <Issues issues={issues} /> : null}
        {preview ? <Summary result={preview} /> : null}
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={bulk.isPending || text.trim() === ""}
            onClick={() => run(true)}
            variant="outline"
          >
            Check rows
          </Button>
          <Button
            disabled={bulk.isPending || preview === null}
            onClick={() => run(false)}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
