/**
 * Wire types and input schemas of the ALERTS slice: the notification centre, the live
 * banner and the Web Push subscription endpoints (spec §7.6).
 *
 * Relative imports only (this file is bundled by wrangler as well as Vite).
 */

import { z } from "zod";

export const NOTIFICATION_KINDS = [
  "near_expiry",
  "urgent",
  "expired",
  "low_stock",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/** Default page size of `GET /api/alerts`. */
export const NOTIFICATIONS_DEFAULT_LIMIT = 30;

/** The most subscriptions (devices) one user keeps; the oldest are dropped. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

export const MAX_PUSH_ENDPOINT_LENGTH = 2048;
export const MAX_PUSH_USER_AGENT_LENGTH = 512;

/** `p256dh` is an uncompressed P-256 point, `auth` a 16-byte secret (RFC 8291). */
export const PUSH_P256DH_BYTES = 65;
export const PUSH_AUTH_BYTES = 16;

/** The `data` JSON the alert generator stores with a notification. Every field is optional. */
export interface NotificationData {
  batchNumber?: string;
  daysUntil?: number;
  expiry?: string;
  itemName?: string;
  onHand?: number;
  threshold?: number;
  unit?: string;
  /** A same-origin path (starts with `/`), where the notification should lead. */
  url?: string;
}

export interface NotificationDto {
  batchId: string | null;
  body: string;
  createdAt: string;
  data: NotificationData;
  dismissed: boolean;
  id: string;
  itemId: string | null;
  kind: NotificationKind;
  /** Read by the CURRENT user. */
  read: boolean;
  /** Set when the condition no longer holds (disposed, restocked, …). */
  resolvedAt: string | null;
  severity: NotificationSeverity;
  title: string;
}

/** `meta` of `GET /api/alerts` on top of the paging fields. */
export interface NotificationListMeta {
  limit: number;
  offset: number;
  total: number;
  /** Unread, not dismissed, not resolved: the number the bell badge shows. */
  unread: number;
}

export type BannerTopItemKind = "expired" | "low_stock" | "urgent";

/** One of the (up to three) most severe things the banner can point at. */
export interface AlertBannerTopItem {
  /** Low stock: units available (FEFO-eligible). Otherwise null. */
  available: number | null;
  batchId: string | null;
  batchNumber: string | null;
  /** Whole days from facility "today" to expiry (negative = already expired). Null for low stock. */
  daysUntil: number | null;
  expiry: string | null;
  itemId: string;
  /** "Amoxicillin 500 mg". */
  itemName: string;
  kind: BannerTopItemKind;
  /** Low stock: the item's threshold. Otherwise null. */
  threshold: number | null;
  unit: string;
}

export interface AlertBannerCounts {
  /** Batches that expired and still hold stock. */
  expired: number;
  /** Items with a threshold whose FEFO-eligible stock is below it. */
  lowStock: number;
  /** Batches with stock expiring within `urgentDays` (today included). */
  urgent: number;
}

export interface AlertBannerDto {
  counts: AlertBannerCounts;
  /** False when the `alerts.inApp` setting is off: counts are zero and `topItems` is empty. */
  enabled: boolean;
  thresholds: { nearDays: number; urgentDays: number };
  /** Facility-local `YYYY-MM-DD` the counts were computed for. */
  today: string;
  /** Most severe first: expired, then urgent, then low stock. */
  topItems: AlertBannerTopItem[];
  unreadCount: number;
}

export interface PushConfigDto {
  /** The `alerts.push` setting is on AND the server has a VAPID public key. */
  enabled: boolean;
  publicKey: string | null;
}

export interface PushSubscriptionDto {
  createdAt: string;
  /** Host of the push service only (e.g. `fcm.googleapis.com`). */
  endpointHost: string;
  /** Last characters of the endpoint, so a device can recognise its own subscription. */
  endpointTail: string;
  id: string;
  lastSuccessAt: string | null;
  userAgent: string | null;
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

const ENDPOINT_TAIL_LENGTH = 8;

/** The last characters of a push endpoint (shared by the API and the SPA). */
export function endpointTail(endpoint: string): string {
  return endpoint.slice(-ENDPOINT_TAIL_LENGTH);
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BITS_PER_BASE64_CHAR = 6;
const BITS_PER_BYTE = 8;
const BASE64_PADDING = /[=]+$/;
const FLAG_TRUE = new Set(["1", "true"]);

/** Decoded size of an (optionally padded) base64url string, or null when it is not base64url. */
export function base64UrlByteLength(value: string): number | null {
  const unpadded = value.replace(BASE64_PADDING, "");
  if (
    unpadded === "" ||
    !BASE64URL.test(unpadded) ||
    unpadded.length % 4 === 1
  ) {
    return null;
  }
  return Math.floor((unpadded.length * BITS_PER_BASE64_CHAR) / BITS_PER_BYTE);
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

function base64UrlOfSize(bytes: number, label: string) {
  return z
    .string()
    .max(MAX_PUSH_ENDPOINT_LENGTH)
    .refine((value) => base64UrlByteLength(value) === bytes, {
      message: `${label} must be base64url encoding of ${bytes} bytes.`,
    });
}

export const pushSubscribeSchema = z.strictObject({
  endpoint: z
    .string()
    .max(MAX_PUSH_ENDPOINT_LENGTH, "The endpoint is too long.")
    .refine(isHttpsUrl, { message: "The endpoint must be an https URL." }),
  keys: z.strictObject({
    auth: base64UrlOfSize(PUSH_AUTH_BYTES, "auth"),
    p256dh: base64UrlOfSize(PUSH_P256DH_BYTES, "p256dh"),
  }),
  userAgent: z.string().trim().max(MAX_PUSH_USER_AGENT_LENGTH).optional(),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.strictObject({
  endpoint: z.string().min(1).max(MAX_PUSH_ENDPOINT_LENGTH),
});
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

const flag = z
  .enum(["0", "1", "false", "true"])
  .transform((value) => FLAG_TRUE.has(value));

function csvOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((text) =>
      text
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "")
    )
    .pipe(z.array(z.enum(values)).min(1));
}

/** Filters of `GET /api/alerts` (paging is read separately with `readPaging`). */
export const alertsQuerySchema = z.object({
  includeDismissed: flag.optional(),
  includeResolved: flag.optional(),
  kind: csvOf(NOTIFICATION_KINDS).optional(),
  severity: csvOf(NOTIFICATION_SEVERITIES).optional(),
  unread: flag.optional(),
});
export type AlertsQuery = z.infer<typeof alertsQuerySchema>;
