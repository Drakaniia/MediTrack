import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { cn } from "@cmis/ui/lib/utils";
import { ROLE_LABELS } from "@shared/roles";
import type { AuditEntryDto } from "@shared/schemas/audit";
import type { ReactElement } from "react";

import { formatDateTime } from "@/lib/format";

import {
  DIFF_STATUS_LABELS,
  type DiffStatus,
  diffSnapshots,
  hasSnapshot,
} from "../lib/audit-diff";

export interface AuditDetailSheetProps {
  entry: AuditEntryDto;
  onClose: () => void;
  timezone: string;
}

const STATUS_TONE: Record<DiffStatus, string> = {
  added: "text-expiry-safe",
  changed: "text-expiry-near",
  removed: "text-expiry-expired",
  unchanged: "text-muted-foreground",
};

function Fact({
  children,
  label,
}: {
  children: ReactElement | string;
  label: string;
}): ReactElement {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

function SnapshotDiff({ entry }: { entry: AuditEntryDto }): ReactElement {
  if (!hasSnapshot(entry.before, entry.after)) {
    return (
      <p className="text-muted-foreground text-sm">
        No before / after snapshot was recorded for this entry.
      </p>
    );
  }
  const rows = diffSnapshots(entry.before, entry.after);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">Before and after</caption>
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium" scope="col">
              Field
            </th>
            <th className="px-2 py-1.5 font-medium" scope="col">
              Before
            </th>
            <th className="px-2 py-1.5 font-medium" scope="col">
              After
            </th>
            <th className="px-2 py-1.5 font-medium" scope="col">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-t align-top" key={row.path}>
              <th className="px-2 py-1.5 font-medium font-mono" scope="row">
                {row.path}
              </th>
              <td className="break-all px-2 py-1.5 font-mono">
                {row.status === "added" ? "—" : row.before}
              </td>
              <td className="break-all px-2 py-1.5 font-mono">
                {row.status === "removed" ? "—" : row.after}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-2 py-1.5 font-medium",
                  STATUS_TONE[row.status]
                )}
              >
                {DIFF_STATUS_LABELS[row.status]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A right-hand drawer with everything recorded about one audit entry. */
export function AuditDetailSheet({
  entry,
  onClose,
  timezone,
}: AuditDetailSheetProps): ReactElement {
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent className="top-0 right-0 left-auto h-full max-h-svh w-full translate-x-0 translate-y-0 content-start overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Audit entry</DialogTitle>
          <DialogDescription>{entry.summary}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Time (facility)">
            {formatDateTime(entry.at, timezone)}
          </Fact>
          <Fact label="Time (UTC)">{entry.at}</Fact>
          <Fact label="Actor">{entry.actorName}</Fact>
          <Fact label="Role">
            {entry.actorRole ? ROLE_LABELS[entry.actorRole] : "—"}
          </Fact>
          <Fact label="Action">{entry.action}</Fact>
          <Fact label="Record">
            {entry.entityId
              ? `${entry.entityType} · ${entry.entityId}`
              : entry.entityType}
          </Fact>
          <Fact label="IP address">{entry.ip ?? "—"}</Fact>
        </dl>
        <section aria-labelledby="audit-diff-heading" className="grid gap-2">
          <h3 className="font-medium text-sm" id="audit-diff-heading">
            Before and after
          </h3>
          <SnapshotDiff entry={entry} />
        </section>
      </DialogContent>
    </Dialog>
  );
}
