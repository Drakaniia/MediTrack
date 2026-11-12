import { Button } from "@cmis/ui/components/button";
import { type AppSettings, MAX_FACILITY_NAME_LENGTH } from "@shared/settings";
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useState,
} from "react";
import { toast } from "sonner";

import { DensityToggle } from "@/components/density-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { useFacility } from "@/lib/auth/guards";
import { useMinuteClock } from "@/lib/clock";
import { useUpdateSettings } from "../hooks/settings-queries";
import { useReportDirty } from "../hooks/use-report-dirty";
import { serverFormErrors } from "../lib/form-errors";
import { buildSettingsPatch, isEmptyPatch } from "../lib/settings-patch";
import { localTimePreview } from "../lib/timezones";
import { FormAlert, SectionCard, TextField } from "./form-controls";
import { TimezoneSelect } from "./timezone-select";

/** Theme and density live in this browser only (no server call, nothing to save). */
export function DevicePreferences(): ReactElement {
  return (
    <SectionCard
      description="Saved on this device only. Other people and your other devices keep their own."
      title="This device"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium text-sm">Theme</span>
        <ThemeToggle />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium text-sm">Density</span>
        <DensityToggle />
      </div>
    </SectionCard>
  );
}

/** What everyone but an administrator sees: the facility settings, read-only, from `/auth/me`. */
export function FacilitySummary(): ReactElement {
  const { name, timezone } = useFacility();
  const clock = useMinuteClock();
  return (
    <SectionCard
      description="Only a system administrator can change these."
      title="Facility"
    >
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">Facility name</dt>
          <dd className="text-sm">{name}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground text-xs">Timezone</dt>
          <dd className="text-sm">{timezone}</dd>
          <dd className="text-muted-foreground text-xs">
            {localTimePreview(new Date(clock), timezone)}
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

export interface GeneralTabProps {
  onDirtyChange: (dirty: boolean) => void;
  settings: AppSettings;
}

/** Facility name and timezone (admin). Saving refreshes `/auth/me`, so the header and tab title change at once. */
export function GeneralTab({
  onDirtyChange,
  settings,
}: GeneralTabProps): ReactElement {
  const [name, setName] = useState(settings.facility.name);
  const [timezone, setTimezone] = useState(settings.facility.timezone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const update = useUpdateSettings();

  const patch = buildSettingsPatch(settings, {
    ...settings,
    facility: { name: name.trim(), timezone },
  });
  const dirty = !isEmptyPatch(patch);
  useReportDirty(dirty, onDirtyChange);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(undefined);
      if (name.trim() === "") {
        setErrors({ "facility.name": "Enter the facility name." });
        return;
      }
      setErrors({});
      try {
        await update.mutateAsync(patch);
        toast.success("Settings saved.");
      } catch (error) {
        const failed = serverFormErrors(error, "Couldn't save the settings.");
        setErrors(failed.fields);
        setFormError(failed.form);
      }
    },
    [name, patch, update]
  );

  return (
    <div className="grid gap-4">
      <form
        aria-busy={update.isPending}
        className="grid gap-4"
        noValidate
        onSubmit={handleSubmit}
      >
        <SectionCard
          description="Shown in the header and the browser tab, and used for every date and time on screen."
          footer={
            <Button disabled={!dirty || update.isPending} type="submit">
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          }
          title="Facility"
        >
          {formError ? <FormAlert>{formError}</FormAlert> : null}
          <TextField
            autoComplete="organization"
            error={errors["facility.name"]}
            label="Facility name"
            maxLength={MAX_FACILITY_NAME_LENGTH}
            onValueChange={setName}
            value={name}
          />
          <TimezoneSelect
            error={errors["facility.timezone"]}
            onValueChange={setTimezone}
            value={timezone}
          />
        </SectionCard>
      </form>
      <DevicePreferences />
    </div>
  );
}
