import { Button } from "@cmis/ui/components/button";
import { ROLE_LABELS } from "@shared/roles";
import type { AuditEntryDto } from "@shared/schemas/audit";
import type { ReactElement } from "react";

import { formatDateTime } from "@/lib/format";

export interface AuditTableProps {
  entries: readonly AuditEntryDto[];
  onSelect: (entry: AuditEntryDto) => void;
  timezone: string;
}

/** One page of the audit log. "Details" opens the before / after drawer. */
export function AuditTable({
  entries,
  onSelect,
  timezone,
}: AuditTableProps): ReactElement {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">Audit log, newest first</caption>
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="px-3 py-2 font-medium" scope="col">
              Time ({timezone})
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Actor
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Action
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              Summary
            </th>
            <th className="px-3 py-2 text-right font-medium" scope="col">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const time = formatDateTime(entry.at, timezone);
            return (
              <tr className="border-t align-top" key={entry.id}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {time}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{entry.actorName}</div>
                  {entry.actorRole ? (
                    <div className="text-muted-foreground text-xs">
                      {ROLE_LABELS[entry.actorRole]}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {entry.action}
                  </code>
                </td>
                <td className="px-3 py-2">{entry.summary}</td>
                <td className="px-3 py-2 text-right">
                  <Button
                    aria-label={`Details of ${entry.action} at ${time}`}
                    onClick={() => onSelect(entry)}
                    size="sm"
                    variant="outline"
                  >
                    Details
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
