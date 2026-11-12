import { ROLE_LABELS } from "@shared/roles";
import type { AuditEntryDto } from "@shared/schemas/audit";

import { formatDateTime } from "@/lib/format";

const HEADERS = [
  "Time (facility)",
  "Time (UTC)",
  "Actor",
  "Role",
  "Action",
  "Entity type",
  "Entity ID",
  "Summary",
  "IP",
] as const;

/** Cells a spreadsheet would run as a formula get a leading apostrophe. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** The CSV text of `rows`: timestamps on the facility clock and in UTC, one entry per line. */
export function buildAuditCsv(
  rows: readonly AuditEntryDto[],
  timeZone: string
): string {
  const lines = [HEADERS.map(cell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        formatDateTime(row.at, timeZone),
        row.at,
        row.actorName,
        row.actorRole ? ROLE_LABELS[row.actorRole] : "",
        row.action,
        row.entityType,
        row.entityId ?? "",
        row.summary,
        row.ip ?? "",
      ]
        .map(cell)
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Hands `text` to the browser as a file download. */
export function downloadTextFile(
  fileName: string,
  text: string,
  type = "text/csv;charset=utf-8"
): void {
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
