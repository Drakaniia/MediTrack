import { Button } from "@cmis/ui/components/button";
import type { PushSubscriptionDto } from "@shared/schemas/alerts";
import { Smartphone, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/api/errors";
import { useFacility } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";

import { useRemovePushDevice } from "../hooks/alert-mutations";
import { describeUserAgent } from "../lib/push-client";

export interface PushDeviceListProps {
  devices: readonly PushSubscriptionDto[];
  /** Tail of this browser's own endpoint, to mark "This device". */
  thisDeviceTail: string | null;
}

/** The signed-in user's registered devices, each removable. */
export function PushDeviceList({
  devices,
  thisDeviceTail,
}: PushDeviceListProps): ReactElement | null {
  const { timezone } = useFacility();
  const remove = useRemovePushDevice();
  if (devices.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2">
      <h3 className="font-medium text-sm">Your devices</h3>
      <ul className="divide-y rounded-lg border">
        {devices.map((device) => {
          const label = describeUserAgent(device.userAgent);
          return (
            <li
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
              key={device.id}
            >
              <Smartphone
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {label}
                  {device.endpointTail === thisDeviceTail ? (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 font-normal text-xs">
                      This device
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-muted-foreground text-xs">
                  {device.endpointHost} · added{" "}
                  {formatDateTime(device.createdAt, timezone)}
                </p>
              </div>
              <Button
                aria-label={`Remove ${label}`}
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(device.id, {
                    onError: (failure) =>
                      toast.error(
                        errorMessage(failure, "Could not remove that device.")
                      ),
                  })
                }
                size="sm"
                variant="outline"
              >
                <Trash2 aria-hidden />
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
