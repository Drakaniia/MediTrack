import { Button } from "@cmis/ui/components/button";
import {
  type ExpiryThresholds,
  MAX_THRESHOLD_DAYS,
  validateThresholds,
} from "@shared/expiry";
import type { AppSettings } from "@shared/settings";
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useState,
} from "react";
import { toast } from "sonner";

import { useFacility } from "@/lib/auth/guards";

import { useUpdateSettings } from "../hooks/settings-queries";
import { useReportDirty } from "../hooks/use-report-dirty";
import { serverFormErrors } from "../lib/form-errors";
import { buildSettingsPatch, isEmptyPatch } from "../lib/settings-patch";
import { ExpiryPreviewStrip } from "./expiry-preview-strip";
import { FormAlert, SectionCard, TextField } from "./form-controls";

const EXPLANATION =
  "These two numbers decide what counts as Urgent and Near Expiry on the dashboard, the expiry list, in-app and push alerts, the reports and the daily email digest. A batch is never marked: its class is worked out from its expiry date every time, so a change here applies everywhere at once.";

function toDays(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

/** Which field the validation message is about. */
function messageField(thresholds: ExpiryThresholds): "nearDays" | "urgentDays" {
  return thresholds.urgentDays < 0 ? "urgentDays" : "nearDays";
}

/** The explanation and a preview strip, shown to everyone (read-only for non-admins). */
export function ThresholdsSummary(): ReactElement {
  const { nearDays, urgentDays } = useFacility();
  return (
    <SectionCard
      description="Only a system administrator can change these."
      title="Expiry thresholds"
    >
      <p className="text-sm">
        Urgent: {urgentDays} days or fewer. Near Expiry: {nearDays} days or
        fewer.
      </p>
      <ExpiryPreviewStrip thresholds={{ nearDays, urgentDays }} />
      <p className="text-muted-foreground text-xs">{EXPLANATION}</p>
    </SectionCard>
  );
}

export interface ThresholdsTabProps {
  onDirtyChange: (dirty: boolean) => void;
  settings: AppSettings;
}

/** Urgent / Near Expiry day counts with live validation and a preview of the result. */
export function ThresholdsTab({
  onDirtyChange,
  settings,
}: ThresholdsTabProps): ReactElement {
  const [urgentText, setUrgentText] = useState(
    String(settings.expiry.urgentDays)
  );
  const [nearText, setNearText] = useState(String(settings.expiry.nearDays));
  const [formError, setFormError] = useState<string | undefined>();
  const update = useUpdateSettings();

  const draft: ExpiryThresholds = {
    nearDays: toDays(nearText),
    urgentDays: toDays(urgentText),
  };
  const validation = validateThresholds(draft);
  const patch = validation.ok
    ? buildSettingsPatch(settings, { ...settings, expiry: draft })
    : {};
  const dirty =
    draft.urgentDays !== settings.expiry.urgentDays ||
    draft.nearDays !== settings.expiry.nearDays;
  useReportDirty(dirty, onDirtyChange);

  const message = validation.ok ? undefined : validation.message;
  const field = messageField(draft);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(undefined);
      if (isEmptyPatch(patch)) {
        return;
      }
      try {
        await update.mutateAsync(patch);
        toast.success("Expiry thresholds saved.");
      } catch (error) {
        setFormError(
          serverFormErrors(error, "Couldn't save the thresholds.").form
        );
      }
    },
    [patch, update]
  );

  return (
    <form
      aria-busy={update.isPending}
      className="grid gap-4"
      noValidate
      onSubmit={handleSubmit}
    >
      <SectionCard
        description={EXPLANATION}
        footer={
          <Button
            disabled={!dirty || Boolean(message) || update.isPending}
            type="submit"
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        }
        title="Expiry thresholds"
      >
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            error={field === "urgentDays" ? message : undefined}
            hint="Urgent: expires in this many days or fewer."
            inputMode="numeric"
            label="Urgent days"
            max={MAX_THRESHOLD_DAYS}
            min={0}
            onValueChange={setUrgentText}
            step={1}
            type="number"
            value={urgentText}
          />
          <TextField
            error={field === "nearDays" ? message : undefined}
            hint="Near Expiry: expires in this many days or fewer."
            inputMode="numeric"
            label="Near Expiry days"
            max={MAX_THRESHOLD_DAYS}
            min={1}
            onValueChange={setNearText}
            step={1}
            type="number"
            value={nearText}
          />
        </div>
        <div className="grid gap-2">
          <h3 className="font-medium text-sm">Preview</h3>
          <ExpiryPreviewStrip
            thresholds={validation.ok ? draft : settings.expiry}
          />
          {validation.ok ? null : (
            <p className="text-muted-foreground text-xs">
              The preview shows the saved thresholds until these are valid.
            </p>
          )}
        </div>
      </SectionCard>
    </form>
  );
}
