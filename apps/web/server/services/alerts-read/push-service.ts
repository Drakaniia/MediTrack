/**
 * Web Push device subscriptions of the signed-in user. Browsers hand out one endpoint per
 * profile/device; the cron Worker later reads `p256dh` / `auth` to encrypt the payload, so
 * those two never leave the database (the DTO has neither, nor the full endpoint).
 */

import {
  endpointTail,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  type PushConfigDto,
  type PushSubscribeInput,
  type PushSubscriptionDto,
} from "../../../shared/schemas/alerts";
import type { D1DatabaseLike, Env } from "../../env";
import { HttpError } from "../../http";
import { newId } from "../../ids";
import { loadSettings } from "../../settings-store";

interface SubscriptionRow {
  created_at: string;
  endpoint: string;
  id: string;
  last_success_at: string | null;
  user_agent: string | null;
}

const SUBSCRIPTION_COLUMNS =
  "id, endpoint, user_agent, created_at, last_success_at";

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}

function toDto(row: SubscriptionRow): PushSubscriptionDto {
  return {
    createdAt: row.created_at,
    endpointHost: hostOf(row.endpoint),
    endpointTail: endpointTail(row.endpoint),
    id: row.id,
    lastSuccessAt: row.last_success_at,
    userAgent: row.user_agent,
  };
}

export async function getPushConfig(
  db: D1DatabaseLike,
  env: Pick<Env, "VAPID_PUBLIC_KEY">
): Promise<PushConfigDto> {
  const settings = await loadSettings(db);
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || null;
  return { enabled: settings.alerts.push && publicKey !== null, publicKey };
}

export async function listSubscriptions(
  db: D1DatabaseLike,
  userId: string
): Promise<PushSubscriptionDto[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`
    )
    .bind(userId)
    .all<SubscriptionRow>();
  return results.map(toDto);
}

/**
 * Registers (or re-registers) a device. The endpoint is globally unique: subscribing the same
 * browser from another account re-assigns it, so a shared workstation never keeps pushing the
 * previous user's alerts. Beyond `MAX_PUSH_SUBSCRIPTIONS_PER_USER` the oldest are dropped.
 */
export async function subscribe(
  db: D1DatabaseLike,
  userId: string,
  input: PushSubscribeInput,
  now: Date
): Promise<PushSubscriptionDto> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_success_at, failure_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)
         ON CONFLICT (endpoint) DO UPDATE
         SET user_id = excluded.user_id,
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             user_agent = excluded.user_agent,
             created_at = excluded.created_at,
             failure_count = 0`
      )
      .bind(
        newId(),
        userId,
        input.endpoint,
        input.keys.p256dh,
        input.keys.auth,
        input.userAgent ?? null,
        now.toISOString()
      ),
    db
      .prepare(
        `DELETE FROM push_subscriptions
         WHERE user_id = ?
           AND id NOT IN (
             SELECT id FROM push_subscriptions WHERE user_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?
           )`
      )
      .bind(userId, userId, MAX_PUSH_SUBSCRIPTIONS_PER_USER),
  ]);
  const row = await db
    .prepare(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`
    )
    .bind(input.endpoint, userId)
    .first<SubscriptionRow>();
  if (!row) {
    throw new HttpError("internal_error", "The subscription was not saved.");
  }
  return toDto(row);
}

/** Removes the caller's own subscription for `endpoint`. Someone else's endpoint is left alone. */
export async function unsubscribe(
  db: D1DatabaseLike,
  userId: string,
  endpoint: string
): Promise<boolean> {
  const result = await db
    .prepare(
      "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?"
    )
    .bind(endpoint, userId)
    .run();
  return result.meta.changes > 0;
}

/** Removes one of the caller's own devices by id (the list never exposes full endpoints). */
export async function removeSubscription(
  db: D1DatabaseLike,
  userId: string,
  id: string
): Promise<void> {
  const result = await db
    .prepare("DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  if (result.meta.changes === 0) {
    throw new HttpError("not_found", "That device is not subscribed.");
  }
}
