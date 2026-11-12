import { Button } from "@cmis/ui/components/button";
import type { DailyJobReport, JobRunDto } from "@shared/schemas/alert-run";
import { Play } from "lucide-react";
import { type ReactElement, useCallback, useId, useState } from "react";
import { toast } from "sonner";

import { DataState } from "@/components/data-state";
import { errorMessage } from "@/lib/api/errors";
import { useFacility } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";

import { useAlertRunStatus, useRunAlertJob } from "../hooks/settings-queries";
import {
  describeJobRun,
  EMAIL_SKIP_TEXT,
  PUSH_SKIP_TEXT,
  SKIP_REASON_TEXT,
} from "../lib/alert-run-view";
import { FormAlert, SectionCard } from "./form-controls";

const MAX_LISTED_FAILURES = 5;

const RUN_STATUS_TEXT: Record<JobRunDto["status"], string> = {
  error: "Failed",
  ok: "Finished",
  running: "Running",
};

/** What a manual run did, in words: notifications, then push, then email. */
export function AlertRunResult({
  report,
}: {
  report: DailyJobReport;
}): ReactElement {
  if (report.status === "error") {
    return <FormAlert>The alert job failed: {report.message}</FormAlert>;
  }
  if (report.status === "skipped") {
    return (
      <p className="rounded-md border p-3 text-sm" role="status">
        The alert job did not run.{" "}
        {SKIP_REASON_TEXT[report.reason] ?? report.reason}
      </p>
    );
  }
  const { email, push } = report;
  return (
    <div className="grid gap-1 rounded-md border p-3 text-sm" role="status">
      <p className="font-medium">Alert job finished for {report.localDate}.</p>
      <p>
        {report.notificationsCreated} notifications created ·{" "}
        {report.transitions} expiry changes · {report.lowStockAlerts} low-stock
        alerts
      </p>
      <p>
        Push: sent {push.sent}, gone {push.gone}, failed {push.failed}
        {push.skipped ? ` — ${PUSH_SKIP_TEXT[push.skipped]}` : ""}
      </p>
      <p>
        Email: sent {email.sent}, failed {email.failed}, skipped {email.skipped}
        {email.skippedReason
          ? ` — ${EMAIL_SKIP_TEXT[email.skippedReason]}`
          : ""}
      </p>
      {email.failures.slice(0, MAX_LISTED_FAILURES).map((failure) => (
        <p className="text-destructive text-xs" key={failure.to}>
          {failure.to}: {failure.code}
        </p>
      ))}
    </div>
  );
}

function RunsTable({
  runs,
  timezone,
}: {
  runs: readonly JobRunDto[];
  timezone: string;
}): ReactElement {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[30rem] border-collapse text-left text-xs">
        <caption className="sr-only">Last runs of the daily alert job</caption>
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium" scope="col">
              Started
            </th>
            <th className="px-2 py-1.5 font-medium" scope="col">
              Facility date
            </th>
            <th className="px-2 py-1.5 font-medium" scope="col">
              Status
            </th>
            <th className="px-2 py-1.5 font-medium" scope="col">
              Result
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr className="border-t align-top" key={run.id}>
              <td className="whitespace-nowrap px-2 py-1.5">
                {formatDateTime(run.startedAt, timezone)}
              </td>
              <td className="px-2 py-1.5">{run.runDate}</td>
              <td className="px-2 py-1.5">{RUN_STATUS_TEXT[run.status]}</td>
              <td className="px-2 py-1.5">{describeJobRun(run)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "Run alert job now" (admin): the same job the daily schedule runs, started on
 * demand, followed by the last few runs. The job uses the SAVED settings.
 */
export function AlertJobPanel({
  hasUnsavedChanges,
}: {
  hasUnsavedChanges: boolean;
}): ReactElement {
  const { timezone } = useFacility();
  const run = useRunAlertJob();
  const status = useAlertRunStatus(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [report, setReport] = useState<DailyJobReport | null>(null);
  const emailId = useId();

  const handleRun = useCallback(async () => {
    setReport(null);
    try {
      setReport(await run.mutateAsync({ force: true, sendEmail }));
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't run the alert job."));
    }
  }, [run, sendEmail]);

  return (
    <SectionCard
      description="Runs the daily job right now: new expiry and low-stock notifications, browser push and, if you ask for it, the email digest. It uses the saved settings."
      footer={
        <Button disabled={run.isPending} onClick={handleRun} type="button">
          <Play aria-hidden />
          {run.isPending ? "Running…" : "Run alert job now"}
        </Button>
      }
      title="Run the alert job"
    >
      <div className="flex items-center gap-2">
        <input
          checked={sendEmail}
          className="size-4 accent-primary"
          id={emailId}
          onChange={(event) => setSendEmail(event.target.checked)}
          type="checkbox"
        />
        <label className="text-sm" htmlFor={emailId}>
          Also send the email digest
        </label>
      </div>
      {hasUnsavedChanges ? (
        <p className="text-muted-foreground text-xs">
          You have unsaved changes above. Save them first if the job should use
          them.
        </p>
      ) : null}
      {report ? <AlertRunResult report={report} /> : null}
      <div className="grid gap-2">
        <h3 className="font-medium text-sm">Last runs</h3>
        <DataState
          empty={{ title: "The job has not run yet" }}
          error={status.error}
          isEmpty={status.data?.length === 0}
          isLoading={status.isPending}
          onRetry={() => status.refetch()}
          skeletonRows={2}
        >
          <RunsTable runs={status.data ?? []} timezone={timezone} />
        </DataState>
      </div>
    </SectionCard>
  );
}
