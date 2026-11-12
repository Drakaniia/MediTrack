import { useSyncExternalStore } from "react";

/**
 * Online status (spec §2: online-only, show an offline banner).
 *
 * "Online" means BOTH: the browser says it is connected (`navigator.onLine`
 * plus the `online`/`offline` events) AND the API client has not seen a fetch
 * fail since the last success. The second half catches the cases the browser
 * cannot: a captive portal, a dead Wi-Fi uplink, the server being unreachable.
 *
 * The API client reports into this store (`reportNetworkFailure` when `fetch`
 * rejects, `reportNetworkSuccess` when any response arrives).
 */

const listeners = new Set<() => void>();
let networkFailed = false;
let windowListening = false;

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function handleBrowserOnline(): void {
  // The browser reconnected: forget the failure that was recorded while it was down.
  networkFailed = false;
  emit();
}

function handleBrowserOffline(): void {
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!windowListening && typeof window !== "undefined") {
    window.addEventListener("online", handleBrowserOnline);
    window.addEventListener("offline", handleBrowserOffline);
    windowListening = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && windowListening) {
      window.removeEventListener("online", handleBrowserOnline);
      window.removeEventListener("offline", handleBrowserOffline);
      windowListening = false;
    }
  };
}

/** True when the browser is connected and the last API call did not fail at the network level. */
export function getOnline(): boolean {
  return browserOnline() && !networkFailed;
}

/** True when the last API call failed at the network level (whatever `navigator.onLine` says). */
export function isNetworkFailed(): boolean {
  return networkFailed;
}

export function reportNetworkFailure(): void {
  if (!networkFailed) {
    networkFailed = true;
    emit();
  }
}

export function reportNetworkSuccess(): void {
  if (networkFailed) {
    networkFailed = false;
    emit();
  }
}

/** Test helper: back to "no failure recorded". */
export function resetOnlineState(): void {
  networkFailed = false;
  emit();
}

function getServerSnapshot(): boolean {
  return true;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getOnline, getServerSnapshot);
}
