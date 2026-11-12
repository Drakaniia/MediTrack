/** Fixtures for the ALERTS API tests: notification rows are normally written by the generator. */

import type { DatabaseSync } from "node:sqlite";

import type {
  NotificationKind,
  NotificationSeverity,
} from "../shared/schemas/alerts";
import { FIXTURE_NOW } from "./fixtures";

let sequence = 0;

export interface NotificationFixture {
  batchId?: string | null;
  body?: string;
  createdAt?: string;
  data?: unknown;
  id?: string;
  itemId?: string | null;
  kind?: NotificationKind;
  resolvedAt?: string | null;
  severity?: NotificationSeverity;
  title?: string;
}

export function insertNotification(
  sqlite: DatabaseSync,
  fields: NotificationFixture = {}
): string {
  sequence += 1;
  const id = fields.id ?? `notif-${String(sequence).padStart(4, "0")}`;
  const data =
    typeof fields.data === "string"
      ? fields.data
      : JSON.stringify(fields.data ?? {});
  sqlite
    .prepare(
      `INSERT INTO notifications (id, kind, severity, item_id, batch_id, title, body, data, dedupe_key, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      fields.kind ?? "urgent",
      fields.severity ?? "warning",
      fields.itemId ?? null,
      fields.batchId ?? null,
      fields.title ?? `Alert ${id}`,
      fields.body ?? "Something needs attention.",
      data,
      `dedupe:${id}`,
      fields.createdAt ?? FIXTURE_NOW,
      fields.resolvedAt ?? null
    );
  return id;
}

/** Created-at values that sort in the order given (index 0 = oldest). */
export function minutesAfterFixtureNow(minutes: number): string {
  return new Date(Date.parse(FIXTURE_NOW) + minutes * 60_000).toISOString();
}
