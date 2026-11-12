import { isApiError } from "@/lib/api/errors";

import { PUSH_SERVICE_WORKER_URL, urlBase64ToUint8Array } from "./push-client";

/**
 * The browser side of Web Push (service worker registration and the push subscription).
 * Everything is a plain function over `navigator` / `Notification`, so tests can stub
 * those globals instead of a whole React tree.
 */

/** A failure whose message is already written for the user. */
export class PushSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushSetupError";
  }
}

const DENIED_MESSAGE =
  "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.";
const DISMISSED_MESSAGE =
  "Permission was not granted, so browser notifications stay off.";
const GENERIC_MESSAGE = "Could not change browser notifications. Try again.";

/** The subscription this browser already holds for the app, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Asks permission, registers `/sw.js` and returns the push subscription (reusing an existing
 * one). Throws `PushSetupError` when the user says no.
 */
export async function subscribeThisDevice(
  publicKey: string
): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    throw new PushSetupError(DENIED_MESSAGE);
  }
  if (permission !== "granted") {
    throw new PushSetupError(DISMISSED_MESSAGE);
  }
  await navigator.serviceWorker.register(PUSH_SERVICE_WORKER_URL);
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return (
    existing ??
    (await registration.pushManager.subscribe({
      applicationServerKey: urlBase64ToUint8Array(publicKey),
      userVisibleOnly: true,
    }))
  );
}

export function pushErrorMessage(error: unknown): string {
  if (error instanceof PushSetupError || isApiError(error)) {
    return error.message;
  }
  return GENERIC_MESSAGE;
}
