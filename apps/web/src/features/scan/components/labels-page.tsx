import { Button } from "@cmis/ui/components/button";
import { Input } from "@cmis/ui/components/input";
import { Printer, X } from "lucide-react";
import {
  type ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { PageHeader } from "@/components/page-header";

import { useLabelBatchById } from "../hooks/label-queries";
import { type LabelSelection, useLabelSelection } from "../hooks/use-label-selection";
import {
  buildLabels,
  clampCopies,
  DEFAULT_LABEL_SIZE,
  LABEL_SIZE_IDS,
  LABEL_SIZES,
  type LabelSize,
  type LabelSizeId,
  MAX_COPIES,
  MIN_COPIES,
  pageCount,
} from "../lib/label-layout";
import { LabelPicker } from "./label-picker";
import { LabelSheets } from "./label-sheets";
import "./labels.css";

function SizeChooser({
  onChange,
  value,
}: {
  onChange: (id: LabelSizeId) => void;
  value: LabelSizeId;
}): ReactElement {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium text-sm">Label size</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {LABEL_SIZE_IDS.map((id) => {
          const size = LABEL_SIZES[id];
          return (
            <label
              className="tap-target flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm has-checked:border-primary has-checked:bg-primary/5"
              key={id}
            >
              <input
                checked={value === id}
                className="mt-0.5 size-4 accent-primary"
                name="label-size"
                onChange={() => onChange(id)}
                type="radio"
                value={id}
              />
              <span>
                <span className="block font-medium">{size.name}</span>
                <span className="block text-muted-foreground text-xs">{size.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SelectedBatches({ selection }: { selection: LabelSelection }): ReactElement {
  if (selection.batches.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No batches chosen yet. Search an item or use a quick add above.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <ul aria-label="Chosen batches" className="flex flex-wrap gap-1.5">
        {selection.batches.map((batch) => (
          <li
            className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-0.5 pl-2.5 text-xs"
            key={batch.id}
          >
            <span>
              {batch.itemName} {batch.strength} · {batch.batchNumber}
            </span>
            <Button
              aria-label={`Remove ${batch.itemName} ${batch.batchNumber}`}
              onClick={() => selection.remove(batch.id)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <Button onClick={selection.clear} size="sm" type="button" variant="ghost">
        Clear all
      </Button>
    </div>
  );
}

function PageRule({ size }: { size: LabelSize }): ReactElement {
  // `@page` cannot be set from a class, and it must match the sheets or the printer rescales.
  return (
    <style>{`@page { size: ${size.pageWidthMm}mm ${size.pageHeightMm}mm; margin: 0; }`}</style>
  );
}

function usePreselectedBatch(initialBatchId: string | undefined, selection: LabelSelection) {
  const preselected = useLabelBatchById(initialBatchId);
  const applied = useRef(false);
  const { addMany } = selection;
  useEffect(() => {
    if (preselected.data && !applied.current) {
      applied.current = true;
      addMany([preselected.data]);
    }
  }, [addMany, preselected.data]);
  return preselected;
}

export interface LabelsPageProps {
  /** `?batch=<id>`: a batch to start with. */
  initialBatchId?: string;
}

/**
 * /labels: choose batches, pick a label size, preview the sheets and print. Each label carries the
 * product, lot, expiry, a QR of the batch code and the code in human form.
 */
export function LabelsPage({ initialBatchId }: LabelsPageProps): ReactElement {
  const copiesId = useId();
  const selection = useLabelSelection();
  const preselected = usePreselectedBatch(initialBatchId, selection);
  const [sizeId, setSizeId] = useState<LabelSizeId>(DEFAULT_LABEL_SIZE);
  const [copies, setCopies] = useState(MIN_COPIES);
  const size = LABEL_SIZES[sizeId];
  const labels = useMemo(
    () => buildLabels(selection.batches, size, copies),
    [copies, selection.batches, size]
  );
  const pages = pageCount(labels.length, size);
  const summary =
    labels.length === 0
      ? "No labels to print."
      : `${labels.length} ${labels.length === 1 ? "label" : "labels"} on ${pages} ${pages === 1 ? "page" : "pages"}.`;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Button
            className="tap-target"
            disabled={labels.length === 0}
            onClick={() => window.print()}
            type="button"
          >
            <Printer aria-hidden />
            Print labels
          </Button>
        }
        description="Print QR labels for batches. A scan of the label finds the batch instantly."
        title="Labels"
      />
      {preselected.isError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
          The batch from the link could not be found. Choose batches below.
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="space-y-6">
          <LabelPicker selection={selection} />
          <SizeChooser onChange={setSizeId} value={sizeId} />
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor={copiesId}>
              Copies of each label
            </label>
            <Input
              className="tap-target w-24"
              id={copiesId}
              inputMode="numeric"
              max={MAX_COPIES}
              min={MIN_COPIES}
              onChange={(event) => setCopies(clampCopies(Number(event.target.value)))}
              type="number"
              value={copies}
            />
          </div>
          <section aria-label="Chosen batches" className="space-y-2">
            <h2 className="font-medium text-sm">Chosen batches ({selection.batches.length})</h2>
            <SelectedBatches selection={selection} />
          </section>
        </div>
        <section aria-label="Label preview" className="min-w-0 space-y-2">
          <h2 className="font-medium text-sm">Preview</h2>
          <p aria-live="polite" className="text-muted-foreground text-sm" role="status">
            {summary}
          </p>
          <div className="max-h-[70vh] overflow-auto rounded-lg border bg-muted/30 p-3">
            <div className="flex w-max flex-col gap-3">
              <LabelSheets labels={labels} size={size} />
            </div>
          </div>
        </section>
      </div>
      <PageRule size={size} />
      {labels.length > 0
        ? createPortal(
            <div aria-hidden className="label-print-root" data-testid="label-print-root">
              <LabelSheets labels={labels} size={size} />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
