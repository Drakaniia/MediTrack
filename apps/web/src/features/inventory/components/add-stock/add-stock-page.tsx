import { Button, buttonVariants } from "@cmis/ui/components/button";
import { Link } from "@tanstack/react-router";
import { CircleCheck, ClipboardPaste, X } from "lucide-react";
import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import { PageHeader } from "@/components/page-header";
import { useItemDetail } from "../../hooks/inventory-queries";
import { useAddStockForm } from "../../hooks/use-add-stock-form";
import { BatchRowsEditor } from "./batch-rows-editor";
import { DuplicateBatchDialog } from "./duplicate-batch-dialog";
import { NewProductFields } from "./new-product-fields";
import { PasteImportDialog } from "./paste-import-dialog";
import { ProductPicker } from "./product-picker";
import { ReviewStep } from "./review-step";

type Form = ReturnType<typeof useAddStockForm>;

function ModeSwitch({ form }: { form: Form }): ReactElement {
  return (
    <fieldset className="m-0 flex min-w-0 gap-1 border-0 p-0">
      <legend className="sr-only">Product</legend>
      <Button
        aria-pressed={form.mode === "existing"}
        onClick={() => form.setMode("existing")}
        variant={form.mode === "existing" ? "secondary" : "ghost"}
      >
        Existing product
      </Button>
      <Button
        aria-pressed={form.mode === "new"}
        onClick={() => form.setMode("new")}
        variant={form.mode === "new" ? "secondary" : "ghost"}
      >
        New product
      </Button>
    </fieldset>
  );
}

function SelectedProduct({ form }: { form: Form }): ReactElement | null {
  if (!form.selected) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3">
      <span className="text-sm">
        <span className="font-medium">{form.selected.displayName}</span>
        <span className="block text-muted-foreground text-xs">
          {form.selected.onHand} {form.selected.unit} on hand
          {form.selected.hasExpiry ? "" : " · no expiry tracking"}
        </span>
      </span>
      <Button onClick={() => form.setSelected(null)} size="sm" variant="ghost">
        <X aria-hidden data-icon="inline-start" />
        Change product
      </Button>
    </div>
  );
}

function ProductSection({ form }: { form: Form }): ReactElement {
  return (
    <section aria-label="Product details" className="grid gap-3">
      <ModeSwitch form={form} />
      {form.mode === "existing" ? (
        <>
          {form.selected ? (
            <SelectedProduct form={form} />
          ) : (
            <ProductPicker onSelect={form.selectItem} />
          )}
          {form.pickerError ? (
            <p className="text-destructive text-sm" role="alert">
              Choose the product you are receiving, or switch to New product.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <NewProductFields
            draft={form.draft}
            errors={form.productErrors}
            onChange={form.setDraft}
          />
          {form.conflict ? (
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
              role="alert"
            >
              <span className="flex-1">{form.conflict.message}</span>
              <Button
                onClick={() =>
                  form.adoptExisting(form.conflict?.existingItemId ?? "")
                }
                size="sm"
                variant="outline"
              >
                Add stock to the existing product
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Success({ form }: { form: Form }): ReactElement | null {
  const { done } = form;
  if (!done) {
    return null;
  }
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-expiry-safe/40 bg-expiry-safe/10 p-3"
      role="status"
    >
      <CircleCheck aria-hidden className="size-5 text-expiry-safe" />
      <span className="flex-1 text-sm">
        Saved {done.batches} {done.batches === 1 ? "batch" : "batches"} of{" "}
        {done.productName}.
      </span>
      <Link
        className={buttonVariants({ size: "sm", variant: "outline" })}
        to="/inventory"
      >
        View inventory
      </Link>
      <Button onClick={() => form.setDone(null)} size="sm" variant="ghost">
        Dismiss
      </Button>
    </div>
  );
}

function EditForm({ form }: { form: Form }): ReactElement {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    form.requestReview();
  };
  return (
    <form className="grid max-w-3xl gap-6" noValidate onSubmit={submit}>
      <ProductSection form={form} />
      <BatchRowsEditor
        errors={form.rowErrors}
        hasExpiry={form.hasExpiry}
        onChange={form.setRows}
        rows={form.rows}
        suggest={form.suggest}
        today={form.today}
      />
      <div>
        <Button type="submit">Review</Button>
      </div>
    </form>
  );
}

/** Opens the product named in `?itemId=` once, e.g. from "Add batch" in the item dialog. */
function useInitialProduct(form: Form, initialItemId: string | undefined) {
  const detail = useItemDetail(initialItemId ?? null);
  const applied = useRef(false);
  const { selectItem } = form;
  useEffect(() => {
    if (detail.data && !applied.current) {
      applied.current = true;
      selectItem(detail.data);
    }
  }, [detail.data, selectItem]);
}

export function AddStockPage({
  initialItemId,
}: {
  initialItemId?: string;
}): ReactElement {
  const form = useAddStockForm();
  const [pasteOpen, setPasteOpen] = useState(false);
  useInitialProduct(form, initialItemId);

  return (
    <div>
      <PageHeader
        actions={
          <Button onClick={() => setPasteOpen(true)} variant="outline">
            <ClipboardPaste aria-hidden data-icon="inline-start" />
            Paste from spreadsheet
          </Button>
        }
        description="Receive new stock. Batch numbers can be left blank and are filled in for you."
        title="Add stock"
      />
      <Success form={form} />
      {form.step === "review" ? (
        <ReviewStep
          hasExpiry={form.hasExpiry}
          onBack={() => form.setStep("edit")}
          onConfirm={form.save}
          pending={form.pending}
          productName={form.productName}
          rows={form.rows}
          today={form.today}
        />
      ) : (
        <EditForm form={form} />
      )}
      {form.duplicate ? (
        <DuplicateBatchDialog
          batchNumber={form.duplicate.batchNumber}
          existingQty={form.duplicate.existingQty}
          onCancel={() => form.setDuplicate(null)}
          onMerge={form.mergeDuplicate}
          pending={form.pending}
          qty={form.duplicate.qty}
        />
      ) : null}
      {pasteOpen ? (
        <PasteImportDialog onClose={() => setPasteOpen(false)} />
      ) : null}
    </div>
  );
}
