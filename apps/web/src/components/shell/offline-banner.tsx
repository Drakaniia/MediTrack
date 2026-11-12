import { WifiOff } from "lucide-react";
import type { ReactElement } from "react";

import { useOnline } from "@/lib/online";

export const OFFLINE_MESSAGE =
  "You're offline — changes can't be saved until you reconnect.";

/**
 * MediTract is online-only (spec §2): when the browser is offline, or the last
 * API call could not reach the server, say so and why saving is blocked. The
 * live region is always mounted so assistive tech announces the change.
 */
export function OfflineBanner(): ReactElement {
  const online = useOnline();
  return (
    <div role="status">
      {online ? null : (
        <div className="flex items-center justify-center gap-2 bg-warning px-4 py-2 text-center font-medium text-sm text-warning-foreground print:hidden">
          <WifiOff aria-hidden className="size-4 shrink-0" />
          <p>{OFFLINE_MESSAGE}</p>
        </div>
      )}
    </div>
  );
}
