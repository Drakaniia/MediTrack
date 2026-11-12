/**
 * Write side of the alert generator. Everything is multi-row and chunked so a run over
 * hundreds of batches is a handful of statements: at most 90 bound parameters each (D1
 * allows 100) and, in `executeSteps`, at most 90 statements per `db.batch`.
 */

import type { ExpiryClass } from "../../../shared/expiry";
import type {
  NotificationData,
  NotificationKind,
  NotificationSeverity,
} from "../../../shared/schemas/alerts";
import type { D1DatabaseLike, D1PreparedStatement } from "../../env";
import { chunk, placeholders } from "../../http";

export type StepRole = "created" | "other" | "resolved";

export interface Step {
  /** What `meta.changes` of this statement means for the run's counters. */
  role: StepRole;
  statement: D1PreparedStatement;
}

export interface NotificationInsert {
  batchId: string | null;
  body: string;
  data: NotificationData;
  dedupeKey: string;
  id: string;
  itemId: string | null;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
}

export interface StateWrite {
  id: string;
  value: ExpiryClass;
}

export interface LowStateWrite {
  isLow: boolean;
  itemId: string;
}

const STATEMENTS_PER_BATCH = 90;
const NOTIFICATION_ROW_PARAMS = 10;
const NOTIFICATIONS_PER_STATEMENT = 9;
const STATE_ROW_PARAMS = 3;
const STATE_ROWS_PER_STATEMENT = 30;
/** `IN (…)` list size when a statement also binds up to three scalar values. */
const IN_LIST_SIZE = 86;

const NOTIFICATION_ROW = `(${placeholders(NOTIFICATION_ROW_PARAMS)})`;
const STATE_ROW = `(${placeholders(STATE_ROW_PARAMS)})`;

/**
 * Inserts notifications. A row whose `dedupe_key` already exists is left alone while it is
 * still open (a re-run never duplicates), but is REOPENED (fresh text, timestamp, resolved
 * cleared) when an older episode of the same alert was resolved: a batch that improved and
 * later worsens again must alert again, which a plain `INSERT OR IGNORE` would swallow.
 */
export function notificationSteps(
  db: D1DatabaseLike,
  rows: readonly NotificationInsert[],
  createdAt: string
): Step[] {
  return chunk(rows, NOTIFICATIONS_PER_STATEMENT).map((group) => {
    const values = group.map(() => NOTIFICATION_ROW).join(", ");
    const params = group.flatMap((row) => [
      row.id,
      row.kind,
      row.severity,
      row.itemId,
      row.batchId,
      row.title,
      row.body,
      JSON.stringify(row.data),
      row.dedupeKey,
      createdAt,
    ]);
    return {
      role: "created",
      statement: db
        .prepare(
          `INSERT INTO notifications (id, kind, severity, item_id, batch_id, title, body, data, dedupe_key, created_at)
           VALUES ${values}
           ON CONFLICT (dedupe_key) DO UPDATE SET
             severity = excluded.severity, title = excluded.title, body = excluded.body,
             data = excluded.data, created_at = excluded.created_at, resolved_at = NULL
           WHERE notifications.resolved_at IS NOT NULL`
        )
        .bind(...params),
    };
  });
}

/**
 * A reopened alert is new for everyone again: forget who had read or dismissed the old one.
 * Reopened rows are exactly the ones stamped `createdAt` by this run (a freshly inserted row
 * has no per-user state yet), so one set-based statement covers them all.
 */
export function reopenedStateStep(db: D1DatabaseLike, createdAt: string): Step {
  return {
    role: "other",
    statement: db
      .prepare(
        "DELETE FROM notification_state WHERE notification_id IN (SELECT id FROM notifications WHERE created_at = ?)"
      )
      .bind(createdAt),
  };
}

/** Resolves the open notifications of `batchIds`, except those of `exceptKind`. */
export function resolveBatchSteps(
  db: D1DatabaseLike,
  batchIds: readonly string[],
  resolvedAt: string,
  exceptKind: NotificationKind | null = null
): Step[] {
  return chunk(batchIds, IN_LIST_SIZE).map((ids) => ({
    role: "resolved",
    statement: db
      .prepare(
        `UPDATE notifications SET resolved_at = ?
         WHERE resolved_at IS NULL AND (? IS NULL OR kind <> ?) AND batch_id IN (${placeholders(ids.length)})`
      )
      .bind(resolvedAt, exceptKind, exceptKind, ...ids),
  }));
}

export function resolveLowStockSteps(
  db: D1DatabaseLike,
  itemIds: readonly string[],
  resolvedAt: string
): Step[] {
  return chunk(itemIds, IN_LIST_SIZE).map((ids) => ({
    role: "resolved",
    statement: db
      .prepare(
        `UPDATE notifications SET resolved_at = ?
         WHERE resolved_at IS NULL AND kind = 'low_stock' AND item_id IN (${placeholders(ids.length)})`
      )
      .bind(resolvedAt, ...ids),
  }));
}

export function alertStateSteps(
  db: D1DatabaseLike,
  writes: readonly StateWrite[],
  notifiedAt: string
): Step[] {
  return chunk(writes, STATE_ROWS_PER_STATEMENT).map((group) => ({
    role: "other",
    statement: db
      .prepare(
        `INSERT INTO alert_state (batch_id, last_class, notified_at) VALUES ${group.map(() => STATE_ROW).join(", ")}
         ON CONFLICT (batch_id) DO UPDATE SET last_class = excluded.last_class, notified_at = excluded.notified_at`
      )
      .bind(...group.flatMap((row) => [row.id, row.value, notifiedAt])),
  }));
}

export function lowStockStateSteps(
  db: D1DatabaseLike,
  writes: readonly LowStateWrite[],
  notifiedAt: string
): Step[] {
  return chunk(writes, STATE_ROWS_PER_STATEMENT).map((group) => ({
    role: "other",
    statement: db
      .prepare(
        `INSERT INTO low_stock_state (item_id, is_low, notified_at) VALUES ${group.map(() => STATE_ROW).join(", ")}
         ON CONFLICT (item_id) DO UPDATE SET is_low = excluded.is_low, notified_at = excluded.notified_at`
      )
      .bind(
        ...group.flatMap((row) => [row.itemId, row.isLow ? 1 : 0, notifiedAt])
      ),
  }));
}

const DEAD_BATCH_IDS = `SELECT b.id FROM batches b JOIN items i ON i.id = b.item_id
  WHERE b.deleted_at IS NOT NULL OR i.deleted_at IS NOT NULL OR b.status <> 'active' OR b.qty <= 0`;

const DEAD_LOW_STOCK_ITEM_IDS = `SELECT i.id FROM items i
  WHERE i.deleted_at IS NOT NULL OR i.low_stock_threshold <= 0`;

/**
 * Batches that left the live set (disposed, emptied, trashed) and items that stopped
 * being tracked for low stock: resolve their notifications and forget their state.
 * Purely set-based, so it costs no SELECT and no per-row statement.
 */
export function cleanupSteps(db: D1DatabaseLike, at: string): Step[] {
  return [
    {
      role: "resolved",
      statement: db
        .prepare(
          `UPDATE notifications SET resolved_at = ?
           WHERE resolved_at IS NULL AND batch_id IN (${DEAD_BATCH_IDS})`
        )
        .bind(at),
    },
    {
      role: "other",
      statement: db.prepare(
        `DELETE FROM alert_state WHERE batch_id IN (${DEAD_BATCH_IDS})`
      ),
    },
    {
      role: "resolved",
      statement: db
        .prepare(
          `UPDATE notifications SET resolved_at = ?
           WHERE resolved_at IS NULL AND kind = 'low_stock' AND item_id IN (${DEAD_LOW_STOCK_ITEM_IDS})`
        )
        .bind(at),
    },
    {
      role: "other",
      statement: db
        .prepare(
          `UPDATE low_stock_state SET is_low = 0, notified_at = ?
           WHERE is_low = 1 AND item_id IN (${DEAD_LOW_STOCK_ITEM_IDS})`
        )
        .bind(at),
    },
  ];
}

export interface StepTotals {
  created: number;
  resolved: number;
}

/** Runs the steps in order, ≤ 90 per `db.batch`, and sums what created / resolved rows. */
export async function executeSteps(
  db: D1DatabaseLike,
  steps: readonly Step[]
): Promise<StepTotals> {
  const totals: StepTotals = { created: 0, resolved: 0 };
  for (const group of chunk(steps, STATEMENTS_PER_BATCH)) {
    // Sequential on purpose: later groups depend on the earlier ones having committed.
    const results = await db.batch(group.map((step) => step.statement));
    for (const [index, step] of group.entries()) {
      const changes = results[index]?.meta.changes ?? 0;
      if (step.role === "created") {
        totals.created += changes;
      } else if (step.role === "resolved") {
        totals.resolved += changes;
      }
    }
  }
  return totals;
}
