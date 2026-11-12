import { Button } from "@cmis/ui/components/button";
import type { PushConfigDto } from "@shared/schemas/alerts";
import { endpointTail } from "@shared/schemas/alerts";
import { BellOff, BellRing } from "lucide-react";
import type { ReactElement } from "react";

import { usePushConfig, usePushDevices } from "../hooks/alert-queries";
import {
  type PushSubscriptionController,
  usePushSubscription,
} from "../hooks/use-push-subscription";
import type { PushDeviceState } from "../lib/push-client";
import { PushDeviceList } from "./push-device-list";

interface StateCopy {
  description: string;
  status: string;
}

const STATE_COPY: Record<PushDeviceState, StateCopy> = {
  default: {
    description:
      "Get stock alerts on this device even when MediTract is closed. Your browser will ask for permission.",
    status: "Off",
  },
  denied: {
    description:
      "Notifications are blocked for this site. Allow them in your browser's site settings, then reload this page.",
    status: "Blocked",
  },
  granted: {
    description: "Permission is granted for this site.",
    status: "Allowed",
  },
  insecure: {
    description:
      "Browser notifications need a secure connection. Open MediTract over https:// to turn them on.",
    status: "Needs HTTPS",
  },
  "needs-install": {
    description:
      "On iPhone and iPad, add MediTract to your Home Screen first (Share, then Add to Home Screen), open it from there, and turn notifications on.",
    status: "Install first",
  },
  unsupported: {
    description: "This browser does not support push notifications.",
    status: "Not supported",
  },
};

const UNAVAILABLE_COPY =
  "Browser notifications are turned off for this facility, or the server has no push key. Ask an administrator.";

function canAsk(state: PushDeviceState): boolean {
  return state === "default" || state === "granted";
}

function Actions({
  config,
  controller,
  registered,
}: {
  config: PushConfigDto;
  controller: PushSubscriptionController;
  registered: boolean;
}): ReactElement | null {
  const { busy, disable, enable, state } = controller;
  if (!(config.enabled && config.publicKey && canAsk(state))) {
    return null;
  }
  const { publicKey } = config;
  if (registered) {
    return (
      <Button disabled={busy} onClick={() => disable()} variant="outline">
        <BellOff aria-hidden />
        Disable browser notifications
      </Button>
    );
  }
  return (
    <Button disabled={busy} onClick={() => enable(publicKey)}>
      <BellRing aria-hidden />
      Enable browser notifications
    </Button>
  );
}

function statusOf(
  state: PushDeviceState,
  registered: boolean,
  enabled: boolean
): StateCopy {
  if (!enabled) {
    return { description: UNAVAILABLE_COPY, status: "Unavailable" };
  }
  if (state === "granted" && registered) {
    return {
      description: "Browser notifications are on for this device.",
      status: "On",
    };
  }
  if (state === "granted") {
    return {
      description:
        "Permission is granted, but this device is not receiving alerts yet.",
      status: "Off",
    };
  }
  return STATE_COPY[state];
}

/**
 * Per-device opt-in to browser (Web Push) notifications on the notifications page.
 * Shows what the browser allows right now and the one action that makes sense.
 */
export function PushOptInCard(): ReactElement {
  const config = usePushConfig();
  const devices = usePushDevices();
  const controller = usePushSubscription();
  const tail = controller.endpoint ? endpointTail(controller.endpoint) : null;
  const registered =
    tail !== null &&
    (devices.data?.some((device) => device.endpointTail === tail) ?? false);
  const enabled = config.data?.enabled ?? false;
  const copy = statusOf(controller.state, registered, enabled);

  return (
    <section
      aria-labelledby="push-card-title"
      className="mb-4 space-y-3 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-semibold text-sm" id="push-card-title">
          Browser notifications on this device
        </h2>
        <p className="rounded-full border px-2 py-0.5 text-xs">
          <span className="sr-only">Status: </span>
          {config.isPending ? "Checking" : copy.status}
        </p>
      </div>
      <p className="text-sm" role="status">
        {config.isPending
          ? "Checking what this browser can do…"
          : copy.description}
      </p>
      {controller.error ? (
        <p className="text-destructive text-sm" role="alert">
          {controller.error}
        </p>
      ) : null}
      {config.data ? (
        <Actions
          config={config.data}
          controller={controller}
          registered={registered}
        />
      ) : null}
      <p className="text-muted-foreground text-xs">
        Browser notifications need HTTPS. On iPhone and iPad they only work
        after you install MediTract to the Home Screen.
      </p>
      <PushDeviceList devices={devices.data ?? []} thisDeviceTail={tail} />
    </section>
  );
}
