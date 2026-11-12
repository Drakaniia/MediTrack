import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { apiPost } from "@/lib/api/client";

import {
  currentSubscription,
  pushErrorMessage,
  subscribeThisDevice,
} from "../lib/push-browser";
import {
  detectPushState,
  type PushDeviceState,
  readPushEnvironment,
  serializeSubscription,
} from "../lib/push-client";
import { alertKeys } from "./alert-queries";

export interface PushSubscriptionController {
  busy: boolean;
  /** Turns browser notifications off on this device (API first, then the browser). */
  disable: () => Promise<void>;
  /** Asks permission, subscribes this device and registers it with the API. */
  enable: (publicKey: string) => Promise<void>;
  /** The push endpoint this browser holds, or null. */
  endpoint: string | null;
  /** The reason the last action failed, written for the user. */
  error: string | null;
  state: PushDeviceState;
}

const INCOMPLETE_MESSAGE =
  "This browser returned an incomplete push subscription.";

/** This device's push state and the two actions the opt-in card offers. */
export function usePushSubscription(): PushSubscriptionController {
  const queryClient = useQueryClient();
  const [environment, setEnvironment] = useState(readPushEnvironment);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = detectPushState(environment);

  useEffect(() => {
    if (state !== "granted") {
      return;
    }
    let cancelled = false;
    currentSubscription()
      .then((subscription) => {
        if (!cancelled) {
          setEndpoint(subscription?.endpoint ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state]);

  const refreshDevices = useCallback(
    () => queryClient.invalidateQueries({ queryKey: alertKeys.pushDevices }),
    [queryClient]
  );

  const enable = useCallback(
    async (publicKey: string) => {
      setBusy(true);
      setError(null);
      try {
        const subscription = await subscribeThisDevice(publicKey);
        const body = serializeSubscription(subscription, navigator.userAgent);
        if (!body) {
          throw new Error(INCOMPLETE_MESSAGE);
        }
        await apiPost("/push/subscribe", body);
        setEndpoint(subscription.endpoint);
        await refreshDevices();
      } catch (failure) {
        setError(pushErrorMessage(failure));
      } finally {
        setEnvironment(readPushEnvironment());
        setBusy(false);
      }
    },
    [refreshDevices]
  );

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await apiPost("/push/unsubscribe", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setEndpoint(null);
      await refreshDevices();
    } catch (failure) {
      setError(pushErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }, [refreshDevices]);

  return { busy, disable, enable, endpoint, error, state };
}
