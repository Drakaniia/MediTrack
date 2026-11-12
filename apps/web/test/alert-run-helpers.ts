/**
 * Fixtures for the alert generator / daily job tests (apps/web server tests AND the cron
 * Worker's tests import this file by relative path, so it only needs `node:*`).
 */

import { base64UrlEncode } from "../../../workers/cron/src/push/base64url";
import { generateVapidKeyPair } from "../../../workers/cron/src/push/vapid";
import type { D1DatabaseLike } from "../server/env";
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
  type SettingsPatch,
} from "../shared/settings";
import { insertBatch, insertItem } from "./fixtures";
import { createMigratedD1, type FakeD1 } from "./harness";

/** 10:00 in Asia/Manila (the default facility zone), facility day 2026-11-12. */
export const NOW = new Date("2026-11-12T02:00:00.000Z");
export const TODAY = "2026-11-12";

export function settingsWith(patch: SettingsPatch = {}): AppSettings {
  return mergeSettings(DEFAULT_SETTINGS, patch);
}

export function freshDb(): FakeD1 {
  return createMigratedD1();
}

export interface StockInput {
  batchNumber?: string;
  expiry?: string | null;
  hasExpiry?: boolean;
  name?: string;
  qty?: number;
  strength?: string;
  threshold?: number;
}

/** One item with one batch. */
export function addStock(
  db: FakeD1,
  input: StockInput = {}
): { batchId: string; itemId: string } {
  const itemId = insertItem(db.sqlite, {
    hasExpiry: input.hasExpiry ?? input.expiry !== null,
    lowStockThreshold: input.threshold ?? 0,
    name: input.name ?? "Paracetamol",
    strength: input.strength ?? "500 mg",
  });
  const batchId = insertBatch(db.sqlite, {
    batchNumber: input.batchNumber ?? "LOT-1",
    expiry: input.expiry === undefined ? "2027-06-01" : input.expiry,
    itemId,
    qty: input.qty ?? 10,
  });
  return { batchId, itemId };
}

export interface NotificationRow {
  batch_id: string | null;
  body: string;
  created_at: string;
  data: string;
  dedupe_key: string;
  id: string;
  item_id: string | null;
  kind: string;
  resolved_at: string | null;
  severity: string;
  title: string;
}

export function notificationRows(db: FakeD1): NotificationRow[] {
  return db.sqlite
    .prepare("SELECT * FROM notifications ORDER BY created_at, dedupe_key")
    .all() as unknown as NotificationRow[];
}

export function notificationsOf(
  db: FakeD1,
  batchOrItemId: string
): NotificationRow[] {
  return notificationRows(db).filter(
    (row) => row.batch_id === batchOrItemId || row.item_id === batchOrItemId
  );
}

export function alertClassOf(db: FakeD1, batchId: string): string | null {
  const row = db.sqlite
    .prepare("SELECT last_class FROM alert_state WHERE batch_id = ?")
    .get(batchId) as { last_class: string } | undefined;
  return row?.last_class ?? null;
}

export function setExpiry(db: FakeD1, batchId: string, expiry: string): void {
  db.sqlite
    .prepare("UPDATE batches SET expiry = ? WHERE id = ?")
    .run(expiry, batchId);
}

export function count(db: FakeD1, table: string): number {
  const row = db.sqlite
    .prepare(`SELECT COUNT(*) AS total FROM ${table}`)
    .get() as { total: number };
  return row.total;
}

export interface DbSpy {
  /** Statement count of every `db.batch` call. */
  batchSizes: number[];
  db: D1DatabaseLike;
  /** SQL text of every prepared statement. */
  sql: string[];
}

/** Wraps a database to record prepared SQL and batch sizes (for N+1 / chunking assertions). */
export function spyOn(db: FakeD1): DbSpy {
  const spy: DbSpy = {
    batchSizes: [],
    db: {
      batch: (statements) => {
        spy.batchSizes.push(statements.length);
        return db.batch(statements);
      },
      exec: db.exec,
      prepare: (sql) => {
        spy.sql.push(sql);
        return db.prepare(sql);
      },
    },
    sql: [],
  };
  return spy;
}

const SELECT_START = /^\s*select\b/i;

export function selectCount(spy: DbSpy): number {
  return spy.sql.filter((sql) => SELECT_START.test(sql)).length;
}

// ─── Push & email fakes ──────────────────────────────────────────────────────────────────────────────────────────

export function addUser(
  db: FakeD1,
  id: string,
  options: { disabled?: boolean } = {}
): string {
  db.sqlite
    .prepare(
      "INSERT INTO users (id, username, username_lower, display_name, role, password_hash, disabled_at) VALUES (?, ?, ?, ?, 'admin', 'x', ?)"
    )
    .run(id, id, id, id, options.disabled ? NOW.toISOString() : null);
  return id;
}

/** A subscription with real P-256 / auth key material, so the encryption step succeeds. */
export async function addSubscription(
  db: FakeD1,
  options: {
    endpoint: string;
    failureCount?: number;
    id: string;
    userId: string;
  }
): Promise<void> {
  const receiver = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const p256dh = base64UrlEncode(
    new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey))
  );
  const auth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  db.sqlite
    .prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      options.id,
      options.userId,
      options.endpoint,
      p256dh,
      auth,
      NOW.toISOString(),
      options.failureCount ?? 0
    );
}

export interface VapidEnv {
  APP_URL: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
}

export async function vapidEnv(): Promise<VapidEnv> {
  const keys = await generateVapidKeyPair();
  return {
    APP_URL: "https://meditract.test",
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_SUBJECT: "mailto:ops@meditract.test",
  };
}

export interface FakePush {
  /** Endpoints in call order. */
  calls: { endpoint: string; headers: Record<string, string> }[];
  fetch: typeof fetch;
}

/** A push service: `statuses[endpoint]` (default 201) is the HTTP status it answers with. */
export function fakePushFetch(statuses: Record<string, number> = {}): FakePush {
  const calls: FakePush["calls"] = [];
  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const endpoint = String(input);
    calls.push({
      endpoint,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(
      new Response(null, { status: statuses[endpoint] ?? 201 })
    );
  }) as typeof fetch;
  return { calls, fetch: fakeFetch };
}

export interface SentEmail {
  html?: string;
  subject: string;
  text?: string;
  to: string;
}

export interface FakeEmail {
  binding: {
    send: (message: SentEmail) => Promise<{ messageId: string }>;
  };
  sent: SentEmail[];
}

/** An `env.EMAIL` binding. Addresses in `rejected` throw `E_RECIPIENT_NOT_ALLOWED`. */
export function fakeEmail(rejected: string[] = []): FakeEmail {
  const sent: SentEmail[] = [];
  return {
    binding: {
      send: (message) => {
        if (rejected.includes(message.to)) {
          return Promise.reject(
            Object.assign(new Error("Recipient is not allowed"), {
              code: "E_RECIPIENT_NOT_ALLOWED",
            })
          );
        }
        sent.push(message);
        return Promise.resolve({ messageId: `msg-${sent.length}` });
      },
    },
    sent,
  };
}
