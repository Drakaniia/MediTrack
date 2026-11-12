/** Shared arrangement helpers for the EXP API tests (`test/expiry-*.test.ts`). */

import type { D1DatabaseLike } from "../server/env";
import { addDays } from "../shared/dates";
import type { TestApp } from "./app";
import { FIXTURE_TODAY } from "./fixtures";

/** The facility date of the default test clock. */
export const TODAY = FIXTURE_TODAY;

/** `TODAY` shifted by `days` (negative = past). */
export function day(days: number): string {
  return addDays(TODAY, days);
}

export interface MovementRow {
  actor_id: string | null;
  batch_id: string | null;
  kind: string;
  note: string;
  qty_after: number;
  qty_delta: number;
  reason: string;
  ref_id: string | null;
  ref_type: string | null;
}

export function movementsOf(app: TestApp, batchId: string): MovementRow[] {
  return app.sqlite
    .prepare(
      "SELECT actor_id, batch_id, kind, note, qty_after, qty_delta, reason, ref_id, ref_type FROM stock_movements WHERE batch_id = ? ORDER BY rowid"
    )
    .all(batchId) as unknown as MovementRow[];
}

export interface AuditRow {
  action: string;
  after: string | null;
  before: string | null;
  entity_id: string | null;
  entity_type: string;
  summary: string;
}

export function auditOf(app: TestApp, action: string): AuditRow[] {
  return app.sqlite
    .prepare(
      "SELECT action, after, before, entity_id, entity_type, summary FROM audit_log WHERE action = ? ORDER BY id"
    )
    .all(action) as unknown as AuditRow[];
}

export function countRows(app: TestApp, table: string): number {
  const row = app.sqlite
    .prepare(`SELECT COUNT(*) AS total FROM ${table}`)
    .get() as { total: number };
  return row.total;
}

export interface BatchState {
  disposed_at: string | null;
  qty: number;
  status: string;
}

export function batchState(app: TestApp, batchId: string): BatchState {
  return app.sqlite
    .prepare("SELECT qty, status, disposed_at FROM batches WHERE id = ?")
    .get(batchId) as unknown as BatchState;
}

/**
 * Simulates a concurrent writer: `onPrepare` runs the moment the service PREPARES a statement
 * matching `pattern` — after it has read the batch (the plan) and before the atomic batch executes
 * (the write). Fires once, then the app talks to the real database again.
 */
export function interceptPrepare(
  app: TestApp,
  pattern: RegExp,
  onPrepare: () => void
): void {
  const original = app.env.DB;
  let armed = true;
  const wrapped: D1DatabaseLike = {
    batch: (statements) => original.batch(statements),
    exec: (query) => original.exec(query),
    prepare: (sql) => {
      if (armed && pattern.test(sql)) {
        armed = false;
        app.env.DB = original;
        onPrepare();
      }
      return original.prepare(sql);
    },
  };
  app.env.DB = wrapped;
}
