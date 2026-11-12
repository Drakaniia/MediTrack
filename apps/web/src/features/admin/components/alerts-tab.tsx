import { Button } from "@cmis/ui/components/button";
import { isTimeOfDay } from "@shared/dates";
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
import { AlertJobPanel } from "./alert-job-panel";
import { FormAlert, SectionCard, TextField, ToggleRow } from "./form-controls";
import { RecipientsEditor } from "./recipients-editor";

export interface AlertsTabProps {
  onDirtyChange: (dirty: boolean) => void;
  settings: AppSettings;
}

const NO_RECIPIENTS_MESSAGE =
  "Add at least one recipient to enable the email digest.";

/** The first server message about the recipients list (`digest.recipients`, `digest.recipients.3`, …). */
function recipientsMessage(fields: Record<string, string>): string | undefined {
  const key = Object.keys(fields).find((field) =>
    field.startsWith("digest.recipients")
  );
  return key ? fields[key] : undefined;
}

function draftSettings(
  base: AppSettings,
  draft: {
    dailyTime: string;
    emailDigest: boolean;
    inApp: boolean;
    push: boolean;
    recipients: string[];
    skipWhenQuiet: boolean;
  }
): AppSettings {
  return {
    ...base,
    alerts: {
      emailDigest: draft.emailDigest,
      inApp: draft.inApp,
      push: draft.push,
    },
    digest: {
      recipients: draft.recipients,
      skipWhenQuiet: draft.skipWhenQuiet,
    },
    schedule: { dailyTime: draft.dailyTime },
  };
}

/** Channels, digest recipients, the daily schedule, and the manual "run now" button (admin). */
export function AlertsTab({
  onDirtyChange,
  settings,
}: AlertsTabProps): ReactElement {
  const { timezone } = useFacility();
  const [inApp, setInApp] = useState(settings.alerts.inApp);
  const [push, setPush] = useState(settings.alerts.push);
  const [emailDigest, setEmailDigest] = useState(settings.alerts.emailDigest);
  const [recipients, setRecipients] = useState(settings.digest.recipients);
  const [skipWhenQuiet, setSkipWhenQuiet] = useState(
    settings.digest.skipWhenQuiet
  );
  const [dailyTime, setDailyTime] = useState(settings.schedule.dailyTime);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const update = useUpdateSettings();

  const patch = buildSettingsPatch(
    settings,
    draftSettings(settings, {
      dailyTime,
      emailDigest,
      inApp,
      push,
      recipients,
      skipWhenQuiet,
    })
  );
  const dirty = !isEmptyPatch(patch);
  useReportDirty(dirty, onDirtyChange);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(undefined);
      const problems: Record<string, string> = {};
      if (!isTimeOfDay(dailyTime)) {
        problems["schedule.dailyTime"] = "Choose a time, like 06:00.";
      }
      if (emailDigest && recipients.length === 0) {
        problems["digest.recipients"] = NO_RECIPIENTS_MESSAGE;
      }
      setErrors(problems);
      if (Object.keys(problems).length > 0) {
        return;
      }
      try {
        await update.mutateAsync(patch);
        toast.success("Alert settings saved.");
      } catch (error) {
        const failed = serverFormErrors(error, "Couldn't save the settings.");
        setErrors(failed.fields);
        setFormError(failed.form);
      }
    },
    [dailyTime, emailDigest, patch, recipients.length, update]
  );

  return (
    <div className="grid gap-4">
      <form
        aria-busy={update.isPending}
        className="grid gap-4"
        noValidate
        onSubmit={handleSubmit}
      >
        {formError ? <FormAlert>{formError}</FormAlert> : null}
        <SectionCard
          description="Where people hear about expiring and low stock."
          title="Channels"
        >
          <ToggleRow
            checked={inApp}
            description="The notification bell, the Notifications page and the dashboard banner."
            label="In-app notifications"
            onCheckedChange={setInApp}
          />
          <ToggleRow
            checked={push}
            description="A browser notification on devices where someone turned it on under Notifications."
            label="Browser push"
            onCheckedChange={setPush}
          />
          <ToggleRow
            checked={emailDigest}
            description="One email a day to the recipients below."
            label="Email digest"
            onCheckedChange={setEmailDigest}
          />
          {errors["alerts.emailDigest"] ? (
            <p className="text-destructive text-xs" role="alert">
              {errors["alerts.emailDigest"]}
            </p>
          ) : null}
        </SectionCard>
        <SectionCard
          description="Who receives the daily email digest."
          title="Digest recipients"
        >
          <RecipientsEditor
            error={errors["digest.recipients"] ?? recipientsMessage(errors)}
            onChange={setRecipients}
            recipients={recipients}
          />
          <ToggleRow
            checked={skipWhenQuiet}
            description="Don't send the digest on days when nothing new expired, became urgent or ran low."
            label="Skip the digest when nothing is new"
            onCheckedChange={setSkipWhenQuiet}
          />
        </SectionCard>
        <SectionCard
          footer={
            <Button disabled={!dirty || update.isPending} type="submit">
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          }
          title="Schedule"
        >
          <TextField
            error={errors["schedule.dailyTime"]}
            hint={`Facility time (${timezone}). The alert job, push and the digest run once a day at this time.`}
            label="Daily run time"
            onValueChange={setDailyTime}
            step={60}
            type="time"
            value={dailyTime}
          />
        </SectionCard>
      </form>
      <AlertJobPanel hasUnsavedChanges={dirty} />
    </div>
  );
}
