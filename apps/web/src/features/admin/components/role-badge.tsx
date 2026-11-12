import { ROLE_LABELS, type Role } from "@shared/roles";
import type { ReactElement } from "react";

/** The role's full label in a pill. The text is the signal; there is no colour coding to decode. */
export function RoleBadge({ role }: { role: Role }): ReactElement {
  return (
    <span className="inline-flex w-fit items-center whitespace-nowrap rounded-full border bg-muted/50 px-2 py-0.5 font-medium text-xs">
      {ROLE_LABELS[role]}
    </span>
  );
}
