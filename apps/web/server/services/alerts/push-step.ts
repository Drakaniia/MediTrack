/**
 * Daily Web Push: ONE summarised message per subscribed device for what is NEW in this run
 * (worsened batches and newly low items), never one per batch.
 *
 * Outcomes are folded back into `push_subscriptions`: 404/410 deletes the row, a
 * retry/failed outcome bumps `failure_count` (the row is deleted at
 * {@link MAX_CONSECUTIVE_FAILURES}), a success stamps `last_success_at` and resets the count.
 * Nothing here throws into the job: a dead endpoint must not stop the others.
 */

import {
  type PushNotificationPayload,
  sendWebPush,
} from "../../../../../workers/cron/src/push/send";
import { EXPIRY_CLASS_LABELS } from "../../../shared/expiry";
import type { PushRunReport } from "../../../shared/schemas/alert-run";
import type { AppSettings } from "../../../shared/settings";
import type { D1DatabaseLike } from "../../env";
import { chunk, placeholders } from "../../http";
import { NOTIFICATION_URLS } from "./messages";
import type { GenerationResult } from "./types";

export interface PushEnv {
  APP_URL?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface PushDeps {
  fetch?: typeof fetch;
  now: Date;
}

export const MAX_CONSECUTIVE_FAILURES = 5;
export const PUSH_TAG = "mt-daily";
export const MAX_PUSH_ITEMS = 3;

const PUSH_TTL_SECONDS = 43_200;
const PUSH_CONCURRENCY = 8;
/** Same shape `createVapidHeaders` insists on, checked up front so bad config is "skipped", not N failures. */
const VAPID_SUBJECT_PATTERN = /^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/;
const IN_LIST_SIZE = 86;

interface SubscriptionRow {
  auth: string;
  endpoint: string;
  id: string;
  p256dh: string;
}

function summaryTitle(generation: GenerationResult): string {
  const byClass = (to: string): number =>
    generation.transitions.filter((entry) => entry.to === to).length;
  const parts: [number, string][] = [
    [byClass("urgent"), "urgent"],
    [byClass("expired"), "expired"],
    [byClass("near_expiry"), "near expiry"],
    [generation.lowStock.length, "low stock"],
  ];
  return `MediTract: ${parts
    .filter(([total]) => total > 0)
    .map(([total, label]) => `${total} ${label}`)
    .join(", ")}`;
}

/** Most severe first: expired, urgent, near expiry, then low stock. */
function summaryLines(generation: GenerationResult): string[] {
  const rank = { expired: 0, near_expiry: 2, urgent: 1 } as const;
  const batches = [...generation.transitions]
    .sort((a, b) => rank[a.to] - rank[b.to])
    .map(
      (entry) =>
        `${entry.itemName} · ${entry.batchNumber}: ${EXPIRY_CLASS_LABELS[entry.to]} (${entry.expiry})`
    );
  const items = generation.lowStock.map(
    (entry) =>
      `${entry.itemName}: low stock (${entry.available} ${entry.unit} left)`
  );
  return [...batches, ...items];
}

function summaryUrl(generation: GenerationResult): string {
  if (generation.transitions.some((entry) => entry.to === "expired")) {
    return NOTIFICATION_URLS.expired;
  }
  return generation.transitions.length > 0
    ? NOTIFICATION_URLS.urgent
    : NOTIFICATION_URLS.low_stock;
}

function summarySeverity(
  generation: GenerationResult
): NonNullable<PushNotificationPayload["severity"]> {
  const critical =
    generation.transitions.some((entry) => entry.to === "expired") ||
    generation.lowStock.some((entry) => entry.available === 0);
  if (critical) {
    return "critical";
  }
  const onlyNearExpiry =
    generation.lowStock.length === 0 &&
    generation.transitions.every((entry) => entry.to === "near_expiry");
  return onlyNearExpiry ? "info" : "warning";
}

/** The one message per device, or null when this run found nothing new. */
export function buildPushPayload(
  generation: GenerationResult
): PushNotificationPayload | null {
  const total = generation.transitions.length + generation.lowStock.length;
  if (total === 0) {
    return null;
  }
  const lines = summaryLines(generation);
  const shown = lines.slice(0, MAX_PUSH_ITEMS);
  if (lines.length > shown.length) {
    shown.push(`+${lines.length - shown.length} more`);
  }
  return {
    body: shown.join("\n"),
    count: total,
    severity: summarySeverity(generation),
    tag: PUSH_TAG,
    title: summaryTitle(generation),
    url: summaryUrl(generation),
  };
}

interface VapidConfig {
  privateKey: string;
  publicKey: string;
  subject: string;
}

function readVapid(env: PushEnv): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const configured = env.VAPID_SUBJECT?.trim() ?? "";
  const appUrl = env.APP_URL?.trim() ?? "";
  const subject = configured === "" ? appUrl : configured;
  if (
    publicKey === "" ||
    privateKey === "" ||
    !VAPID_SUBJECT_PATTERN.test(subject)
  ) {
    return null;
  }
  return { privateKey, publicKey, subject };
}

async function loadSubscriptions(
  db: D1DatabaseLike
): Promise<SubscriptionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s JOIN users u ON u.id = s.user_id
       WHERE u.disabled_at IS NULL
       ORDER BY s.created_at, s.id`
    )
    .all<SubscriptionRow>();
  return results;
}

interface Delivery {
  id: string;
  kind: "failed" | "gone" | "retry" | "sent";
}

async function deliverAll(
  subscriptions: readonly SubscriptionRow[],
  message: { payload: string; vapid: VapidConfig },
  deps: PushDeps
): Promise<Delivery[]> {
  const deliveries: Delivery[] = [];
  for (const group of chunk(subscriptions, PUSH_CONCURRENCY)) {
    // A few devices at a time: bounded concurrency, stable order between groups.
    const outcomes = await Promise.all(
      group.map((row) =>
        sendWebPush({
          fetch: deps.fetch,
          now: () => deps.now.getTime(),
          payload: message.payload,
          subscription: {
            auth: row.auth,
            endpoint: row.endpoint,
            p256dh: row.p256dh,
          },
          topic: PUSH_TAG,
          ttl: PUSH_TTL_SECONDS,
          urgency: "normal",
          vapid: message.vapid,
        })
      )
    );
    for (const [index, outcome] of outcomes.entries()) {
      deliveries.push({ id: group[index]?.id ?? "", kind: outcome.kind });
    }
  }
  return deliveries;
}

function idsOf(deliveries: readonly Delivery[], kinds: string[]): string[] {
  return deliveries
    .filter((entry) => kinds.includes(entry.kind))
    .map((entry) => entry.id);
}

async function recordDeliveries(
  db: D1DatabaseLike,
  deliveries: readonly Delivery[],
  now: Date
): Promise<number> {
  const at = now.toISOString();
  const sent = idsOf(deliveries, ["sent"]);
  const gone = idsOf(deliveries, ["gone"]);
  const failed = idsOf(deliveries, ["failed", "retry"]);
  const statements = [
    ...chunk(sent, IN_LIST_SIZE).map((ids) =>
      db
        .prepare(
          `UPDATE push_subscriptions SET last_success_at = ?, failure_count = 0 WHERE id IN (${placeholders(ids.length)})`
        )
        .bind(at, ...ids)
    ),
    ...chunk(gone, IN_LIST_SIZE).map((ids) =>
      db
        .prepare(
          `DELETE FROM push_subscriptions WHERE id IN (${placeholders(ids.length)})`
        )
        .bind(...ids)
    ),
    ...chunk(failed, IN_LIST_SIZE).map((ids) =>
      db
        .prepare(
          `UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id IN (${placeholders(ids.length)})`
        )
        .bind(...ids)
    ),
  ];
  if (failed.length > 0) {
    statements.push(
      db
        .prepare("DELETE FROM push_subscriptions WHERE failure_count >= ?")
        .bind(MAX_CONSECUTIVE_FAILURES)
    );
  }
  if (statements.length === 0) {
    return 0;
  }
  const results = await db.batch(statements);
  return failed.length > 0 ? (results.at(-1)?.meta.changes ?? 0) : 0;
}

function skipped(reason: NonNullable<PushRunReport["skipped"]>): PushRunReport {
  return {
    devices: 0,
    failed: 0,
    gone: 0,
    removed: 0,
    sent: 0,
    skipped: reason,
  };
}

/** Sends the daily summary to every device. Never throws. */
export async function sendDailyPush(
  db: D1DatabaseLike,
  env: PushEnv,
  settings: AppSettings,
  generation: GenerationResult,
  deps: PushDeps
): Promise<PushRunReport> {
  if (!settings.alerts.push) {
    return skipped("disabled");
  }
  const payload = buildPushPayload(generation);
  if (payload === null) {
    return skipped("nothing_new");
  }
  const vapid = readVapid(env);
  if (vapid === null) {
    return skipped("no_vapid");
  }
  const subscriptions = await loadSubscriptions(db);
  if (subscriptions.length === 0) {
    return skipped("no_devices");
  }
  const deliveries = await deliverAll(
    subscriptions,
    { payload: JSON.stringify(payload), vapid },
    deps
  );
  const removed = await recordDeliveries(db, deliveries, deps.now);
  return {
    devices: subscriptions.length,
    failed: idsOf(deliveries, ["failed", "retry"]).length,
    gone: idsOf(deliveries, ["gone"]).length,
    removed,
    sent: idsOf(deliveries, ["sent"]).length,
    skipped: null,
  };
}
