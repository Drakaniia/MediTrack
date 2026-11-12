import { encryptPayload } from "./encrypt";
import { createVapidHeaders, pushServiceAudience } from "./vapid";

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_SERVER_ERROR_MAX = 599;
const MS_PER_SECOND = 1000;
/** Status reported when the failure happened before any HTTP response existed. */
const NO_HTTP_STATUS = 0;
const MAX_DETAIL_LENGTH = 200;
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const DIGITS_ONLY = /^\d+$/;

const textEncoder = new TextEncoder();

/** What the service worker receives; keep it small, push bodies are capped near 4 KB. */
export interface PushNotificationPayload {
  body: string;
  count?: number;
  severity?: "info" | "warning" | "critical";
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string;
  title: string;
  /** Where a click should navigate, same-origin path or absolute URL. */
  url: string;
}

export interface PushSubscriptionRecord {
  auth: string;
  endpoint: string;
  p256dh: string;
}

export type PushUrgency = "very-low" | "low" | "normal" | "high";

export interface SendWebPushOptions {
  /** Injected so tests need no network; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Already-serialised message (see {@link serializePushPayload}); `null` sends a body-less ping. */
  payload: string | null;
  subscription: PushSubscriptionRecord;
  /** Coalescing key (RFC 8030 §5.4): a newer message with the same topic replaces a queued one. */
  topic?: string;
  /** Seconds the push service may hold the message for an offline device. */
  ttl: number;
  urgency?: PushUrgency;
  vapid: { publicKey: string; privateKey: string; subject: string };
}

/**
 * Result of one delivery attempt, designed so the caller never needs a try/catch:
 * - `sent`: accepted by the push service.
 * - `gone`: 404/410, the subscription is dead and should be deleted.
 * - `retry`: 429/5xx/network error; try again later (`status` is 0 for network errors).
 * - `failed`: anything else (bad request, auth, oversize, invalid stored keys).
 */
export type PushOutcome =
  | { kind: "sent"; status: number }
  | { kind: "gone"; status: number }
  | { kind: "retry"; status: number; retryAfterSeconds?: number }
  | { kind: "failed"; status: number; detail: string };

/** JSON-encodes a notification for {@link sendWebPush}. */
export function serializePushPayload(payload: PushNotificationPayload): string {
  return JSON.stringify(payload);
}

function parseRetryAfter(
  value: string | null,
  nowMs: number
): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (DIGITS_ONLY.test(trimmed)) {
    return Number(trimmed);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((dateMs - nowMs) / MS_PER_SECOND));
}

async function readDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    const detail = text || response.statusText;
    return detail.slice(0, MAX_DETAIL_LENGTH);
  } catch {
    return response.statusText;
  }
}

async function classifyResponse(
  response: Response,
  nowMs: number
): Promise<PushOutcome> {
  const { status } = response;
  if (status >= HTTP_OK_MIN && status <= HTTP_OK_MAX) {
    return { kind: "sent", status };
  }
  if (status === HTTP_NOT_FOUND || status === HTTP_GONE) {
    return { kind: "gone", status };
  }
  const isServerError =
    status >= HTTP_SERVER_ERROR_MIN && status <= HTTP_SERVER_ERROR_MAX;
  if (status === HTTP_TOO_MANY_REQUESTS || isServerError) {
    const retryAfterSeconds = parseRetryAfter(
      response.headers.get("retry-after"),
      nowMs
    );
    return retryAfterSeconds === undefined
      ? { kind: "retry", status }
      : { kind: "retry", retryAfterSeconds, status };
  }
  return { detail: await readDetail(response), kind: "failed", status };
}

function failed(detail: string): PushOutcome {
  return { detail, kind: "failed", status: NO_HTTP_STATUS };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function buildRequest(
  options: SendWebPushOptions,
  nowMs: number
): Promise<RequestInit> {
  const { subscription, payload, vapid, ttl, urgency, topic } = options;
  const { authorization } = await createVapidHeaders({
    audience: pushServiceAudience(subscription.endpoint),
    now: nowMs,
    privateKey: vapid.privateKey,
    publicKey: vapid.publicKey,
    subject: vapid.subject,
  });
  const headers: Record<string, string> = {
    Authorization: authorization,
    TTL: String(Math.max(0, Math.floor(ttl))),
  };
  if (urgency) {
    headers.Urgency = urgency;
  }
  if (topic) {
    headers.Topic = topic;
  }
  if (payload === null) {
    return { body: null, headers, method: "POST" };
  }
  const body = await encryptPayload({
    payload: textEncoder.encode(payload),
    subscription,
  });
  headers["Content-Encoding"] = "aes128gcm";
  headers["Content-Type"] = "application/octet-stream";
  return { body, headers, method: "POST" };
}

/**
 * Sends one Web Push message (RFC 8030) and reports what the caller should do.
 *
 * It never throws: a cron loop over hundreds of subscriptions must not be
 * aborted by one dead endpoint, a network blip or one corrupt stored key, so
 * every failure is folded into {@link PushOutcome}. Problems found before any
 * request is made (bad keys, oversize payload, invalid endpoint/topic) are
 * `failed` with status 0.
 */
export async function sendWebPush(
  options: SendWebPushOptions
): Promise<PushOutcome> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const nowMs = (options.now ?? Date.now)();
  if (options.topic !== undefined && !TOPIC_PATTERN.test(options.topic)) {
    return failed("Topic must be 1-32 URL-safe base64 characters");
  }

  let request: RequestInit;
  try {
    request = await buildRequest(options, nowMs);
  } catch (error) {
    return failed(describeError(error));
  }

  let response: Response;
  try {
    response = await doFetch(options.subscription.endpoint, request);
  } catch {
    return { kind: "retry", status: NO_HTTP_STATUS };
  }
  return await classifyResponse(response, nowMs);
}
