import type { PushSubscribeInput } from "@shared/schemas/alerts";

/**
 * Pure helpers for browser Web Push: feature detection, the VAPID key conversion and
 * subscription serialisation. Nothing here touches the network or mutates a page, so it
 * is all unit-testable with plain objects.
 */

export type PushDeviceState =
  /** HTTPS (or localhost) is required for service workers. */
  | "insecure"
  /** iPhone / iPad only deliver push to an installed Home Screen app. */
  | "needs-install"
  | "unsupported"
  | NotificationPermission;

export interface PushEnvironment {
  hasNotification: boolean;
  hasPushManager: boolean;
  hasServiceWorker: boolean;
  isIos: boolean;
  isSecureContext: boolean;
  isStandalone: boolean;
  permission: NotificationPermission | null;
}

const BASE64_PADDING_BLOCK = 4;
const IOS_DEVICE = /iPad|iPhone|iPod/;
const BASE64URL_DASH = /-/g;
const BASE64URL_UNDERSCORE = /_/g;
const BASE64_PLUS = /\+/g;
const BASE64_SLASH = /\//g;
const TRAILING_PADDING = /[=]+$/;
const HOME_SCREEN_MEDIA = "(display-mode: standalone)";
const MIN_IPAD_TOUCH_POINTS = 1;

/** The browser's `Uint8Array` for an `applicationServerKey`, from the base64url VAPID public key. */
export function urlBase64ToUint8Array(
  base64Url: string
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat(
    (BASE64_PADDING_BLOCK - (base64Url.length % BASE64_PADDING_BLOCK)) %
      BASE64_PADDING_BLOCK
  );
  const base64 = `${base64Url}${padding}`
    .replace(BASE64URL_DASH, "+")
    .replace(BASE64URL_UNDERSCORE, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** Unpadded base64url of `buffer`, or null when there is none. */
export function bufferToBase64Url(buffer: ArrayBuffer | null): string | null {
  if (buffer === null) {
    return null;
  }
  let binary = "";
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(BASE64_PLUS, "-")
    .replace(BASE64_SLASH, "_")
    .replace(TRAILING_PADDING, "");
}

export interface SubscriptionLike {
  getKey?: (name: PushEncryptionKeyName) => ArrayBuffer | null;
  toJSON: () => {
    endpoint?: string;
    keys?: Record<string, string>;
  };
}

/**
 * The body of `POST /api/push/subscribe`, or null when the browser's subscription is missing
 * something the server needs (endpoint, p256dh or auth). Prefers `toJSON()`, falls back to
 * `getKey()` for engines whose JSON form omits the keys.
 */
export function serializeSubscription(
  subscription: SubscriptionLike,
  userAgent?: string
): PushSubscribeInput | null {
  const json = subscription.toJSON();
  const p256dh =
    json.keys?.p256dh ??
    bufferToBase64Url(subscription.getKey?.("p256dh") ?? null);
  const auth =
    json.keys?.auth ?? bufferToBase64Url(subscription.getKey?.("auth") ?? null);
  if (!(json.endpoint && p256dh && auth)) {
    return null;
  }
  const body: PushSubscribeInput = {
    endpoint: json.endpoint,
    keys: { auth, p256dh },
  };
  return userAgent ? { ...body, userAgent } : body;
}

export function isIosDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number
): boolean {
  if (IOS_DEVICE.test(userAgent)) {
    return true;
  }
  // iPadOS 13+ reports itself as a Mac.
  return platform === "MacIntel" && maxTouchPoints > MIN_IPAD_TOUCH_POINTS;
}

/** Reads the current browser's capabilities. Safe to call where the APIs are missing. */
export function readPushEnvironment(): PushEnvironment {
  const hasNotification = "Notification" in window;
  const standaloneFlag = (navigator as { standalone?: boolean }).standalone;
  return {
    hasNotification,
    hasPushManager: "PushManager" in window,
    hasServiceWorker: "serviceWorker" in navigator,
    isIos: isIosDevice(
      navigator.userAgent,
      navigator.platform,
      navigator.maxTouchPoints
    ),
    isSecureContext: window.isSecureContext,
    isStandalone:
      standaloneFlag === true || window.matchMedia(HOME_SCREEN_MEDIA).matches,
    permission: hasNotification ? Notification.permission : null,
  };
}

/** What this device can do about push right now, in the order the user has to fix things. */
export function detectPushState(env: PushEnvironment): PushDeviceState {
  if (!env.isSecureContext) {
    return "insecure";
  }
  if (env.isIos && !env.isStandalone) {
    return "needs-install";
  }
  const supported =
    env.hasServiceWorker && env.hasPushManager && env.hasNotification;
  if (!(supported && env.permission)) {
    return "unsupported";
  }
  return env.permission;
}

export const PUSH_SERVICE_WORKER_URL = "/sw.js";

const UNKNOWN_DEVICE = "Unknown device";
const BROWSERS = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
] as const;
const SYSTEMS = [
  ["Windows", "Windows"],
  ["Android", "Android"],
  ["iPhone", "iPhone"],
  ["iPad", "iPad"],
  ["Mac OS X", "macOS"],
  ["Linux", "Linux"],
] as const;

/** "Chrome on Windows" from a user-agent string; "Unknown device" when there is none. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) {
    return UNKNOWN_DEVICE;
  }
  const browser = BROWSERS.find(([token]) => userAgent.includes(token))?.[1];
  const system = SYSTEMS.find(([token]) => userAgent.includes(token))?.[1];
  if (browser && system) {
    return `${browser} on ${system}`;
  }
  return browser ?? system ?? UNKNOWN_DEVICE;
}
