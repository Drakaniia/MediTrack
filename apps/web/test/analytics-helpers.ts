/** Arrangement helpers for the ANALYTICS / REPORTS API tests: ledger and request rows written straight to SQLite. */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { Role } from "../shared/roles";
import type { TestApp, TestClient } from "./app";
import { FIXTURE_NOW } from "./fixtures";

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-a${String(sequence).padStart(5, "0")}`;
}

function run(sqlite: DatabaseSync, sql: string, values: SQLInputValue[]): void {
  sqlite.prepare(sql).run(...values);
}

export type MovementKind =
  | "adjust"
  | "dispense"
  | "dispose"
  | "receive"
  | "undo_dispense";

export interface MovementFixture {
  at: string;
  batchId?: string | null;
  batchNumber?: string;
  /** Signed quantity change. */
  delta: number;
  itemId?: string | null;
  itemName?: string;
  kind: MovementKind;
  qtyAfter?: number;
}

export function insertMovement(
  sqlite: DatabaseSync,
  fields: MovementFixture
): void {
  run(
    sqlite,
    "INSERT INTO stock_movements (id, at, item_id, batch_id, item_name, batch_number, kind, qty_delta, qty_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      nextId("mov"),
      fields.at,
      fields.itemId ?? null,
      fields.batchId ?? null,
      fields.itemName ?? "Item",
      fields.batchNumber ?? "LOT",
      fields.kind,
      fields.delta,
      fields.qtyAfter ?? Math.max(0, fields.delta),
    ]
  );
}

export interface QueueRequestFixture {
  itemId?: string | null;
  qty: number;
  source?: "queue" | "quick_deduct";
  status?: "approved" | "cancelled" | "claimed" | "denied" | "pending" | "ready";
  submittedAt: string;
}

export function insertQueueRequest(
  sqlite: DatabaseSync,
  fields: QueueRequestFixture
): void {
  const id = nextId("req");
  run(
    sqlite,
    "INSERT INTO requests (id, code, item_id, item_name, unit, qty, status, source, submitted_at, updated_at) VALUES (?, ?, ?, 'Item', 'tab', ?, ?, ?, ?, ?)",
    [
      id,
      `REQ-${id}`,
      fields.itemId ?? null,
      fields.qty,
      fields.status ?? "pending",
      fields.source ?? "queue",
      fields.submittedAt,
      FIXTURE_NOW,
    ]
  );
}

export interface DispensingRecordFixture {
  at: string;
  by: string;
  itemId?: string | null;
  qty: number;
  source?: "queue" | "quick_deduct";
  undone?: boolean;
}

export function insertDispensingRecord(
  sqlite: DatabaseSync,
  fields: DispensingRecordFixture
): void {
  run(
    sqlite,
    "INSERT INTO dispensing_records (id, item_id, item_name, unit, qty, source, dispensed_by, dispensed_by_name, dispensed_at, undone_at) VALUES (?, ?, 'Item', 'tab', ?, ?, ?, 'Dana', ?, ?)",
    [
      nextId("disp"),
      fields.itemId ?? null,
      fields.qty,
      fields.source ?? "queue",
      fields.by,
      fields.at,
      fields.undone ? fields.at : null,
    ]
  );
}

export interface Actor {
  client: TestClient;
  userId: string;
}

export async function actorWithRole(
  app: TestApp,
  role: Role
): Promise<Actor> {
  const user = await app.createUser({ role });
  return { client: await app.login(user), userId: user.id };
}
