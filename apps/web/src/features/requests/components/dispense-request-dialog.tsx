import { Button } from "@cmis/ui/components/button";
import { Checkbox } from "@cmis/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { Label } from "@cmis/ui/components/label";
import { QuantityStepper } from "@cmis/ui/components/quantity-stepper";
import { type DeductPlan, planDeduct } from "@shared/deduct-plan";
import { type FefoBatchLike, fefoOrder } from "@shared/fefo";
import type { RequestDto } from "@shared/schemas/requests";
import { type ReactElement, useId, useState } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";
import { useFacility } from "@/lib/auth/guards";
import { formatDate, formatQuantity } from "@/lib/format";

import { useDispenseRequest } from "../hooks/request-mutations";
import { useItemDetail } from "../hooks/request-queries";

export interface DispenseRequestDialogProps {
  onClose: () => void;
  request: RequestDto;
}

interface Preview {
  available: number;
  message: string | null;
  plan: DeductPlan | null;
}

function takeLabel(take: DeductPlan["takes"][number], unit: string): string {
  const expiry = take.expiry === null ? "no expiry" : formatDate(take.expiry);
  return `${take.batchNumber}: ${formatQuantity(take.qty, unit)} (expires ${expiry})`;
}

/** Lists the FEFO batches this hand-over will draw on, from the item's current batches. */
function BatchPreview({
  plan,
  unit,
}: {
  plan: DeductPlan;
  unit: string;
}): ReactElement {
  return (
    <div className="grid gap-1">
      <p className="font-medium text-sm">Batches that will be used (FEFO)</p>
      <ul className="grid gap-0.5 rounded-md border bg-muted/30 p-2 text-sm">
        {plan.takes.map((take) => (
          <li key={take.batchId}>{takeLabel(take, unit)}</li>
        ))}
      </ul>
    </div>
  );
}

export function DispenseRequestDialog({
  onClose,
  request,
}: DispenseRequestDialogProps): ReactElement {
  const qtyId = useId();
  const { today } = useFacility();
  const detail = useItemDetail(request.itemId);
  const dispense = useDispenseRequest();
  const [qty, setQty] = useState<number | "">(request.remaining);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const wanted = qty === "" ? 0 : qty;
  const validQty = wanted >= 1 && wanted <= request.remaining;
  const preview = buildPreview(
    detail.data?.batches,
    wanted,
    today,
    request.unit
  );
  const short = preview.plan !== null && preview.plan.remaining > 0;
  const nothing = detail.data !== undefined && preview.plan === null;
  const canSubmit =
    validQty &&
    !nothing &&
    (!short || onlyAvailable) &&
    detail.data !== undefined &&
    !dispense.isPending;

  const submit = () => {
    setServerError(null);
    dispense.mutate(
      {
        allowPartial: short && onlyAvailable,
        id: request.id,
        qty: wanted,
      },
      {
        onError: (error) =>
          setServerError(errorMessage(error, "Could not dispense.")),
        onSuccess: ({ partial, record }) => {
          toast.success(
            partial
              ? `Handed over ${record.qty} of ${request.qty}. The rest stays Ready to Claim.`
              : `${request.code} dispensed.`
          );
          onClose();
        },
      }
    );
  };

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispense {request.code}</DialogTitle>
          <DialogDescription>
            {request.itemName}:{" "}
            {formatQuantity(request.remaining, request.unit)} still to hand over
            {request.dispensedQty > 0
              ? ` (${request.dispensedQty} already given)`
              : ""}
            .
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor={qtyId}>Quantity to hand over</Label>
            <QuantityStepper
              id={qtyId}
              invalid={!validQty}
              max={request.remaining}
              min={1}
              onChange={setQty}
              value={qty}
            />
            {validQty ? null : (
              <p className="text-destructive text-xs" role="alert">
                Enter a whole number from 1 to {request.remaining}.
              </p>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {detail.isPending
              ? "Checking stock…"
              : `Available now: ${formatQuantity(preview.available, request.unit)} (expired and quarantined stock is excluded).`}
          </p>
          {preview.plan ? (
            <BatchPreview plan={preview.plan} unit={request.unit} />
          ) : null}
          {nothing ? (
            <p className="text-destructive text-sm" role="alert">
              {preview.message}
            </p>
          ) : null}
          {short ? (
            <div className="flex items-start gap-2 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2 text-sm">
              <Checkbox
                checked={onlyAvailable}
                id={`${qtyId}-partial`}
                onCheckedChange={(checked) =>
                  setOnlyAvailable(checked === true)
                }
              />
              <Label htmlFor={`${qtyId}-partial`}>
                Only {formatQuantity(preview.plan?.take ?? 0, request.unit)} can
                be handed over now. Hand over just that; the rest stays Ready to
                Claim.
              </Label>
            </div>
          ) : null}
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit} type="button">
            Dispense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What the hand-over would do with the item's batches as they are right now. */
function buildPreview(
  batches: readonly FefoBatchLike[] | undefined,
  wanted: number,
  today: string,
  unit: string
): Preview {
  if (!batches) {
    return { available: 0, message: null, plan: null };
  }
  const available = fefoOrder(batches, today).reduce(
    (sum, batch) => sum + batch.qty,
    0
  );
  const outcome = planDeduct({
    allowPartial: true,
    batches,
    requested: Math.max(wanted, 1),
    today,
    unit,
  });
  if (outcome.ok) {
    return { available, message: null, plan: outcome.plan };
  }
  return { available, message: outcome.message, plan: null };
}
