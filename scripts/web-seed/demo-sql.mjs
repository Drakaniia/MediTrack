/**
 * The SQL of one demo seed, from a plan (`demo-plan.mjs`).
 *
 * Shape: wipe the demo-managed tables (children before parents, so foreign keys hold at every
 * step with no PRAGMA tricks), upsert the demo users, insert everything (parents before
 * children), append the audit rows. Idempotent: running it twice leaves the same data.
 *
 * What it does NOT touch: `users` other than the five demo accounts, `sessions`, `settings`,
 * `push_subscriptions`, `login_attempts`, `job_runs`, and `audit_log`, which is append-only
 * (database triggers abort UPDATE and DELETE). Audit rows are appended behind a `NOT EXISTS`
 * guard on (action, entity, time), so a rerun for the same base date adds nothing.
 *
 * One statement per line, no comments, no BEGIN/COMMIT (D1 rejects explicit transactions); a run
 * that dies halfway is fixed by running it again.
 */

import { insertStatements, sqlValue } from "./sql.mjs";

/** Children first. `counters` keeps non-request counters. */
export const WIPE_STATEMENTS = [
  "DELETE FROM notification_state;",
  "DELETE FROM notifications;",
  "DELETE FROM alert_state;",
  "DELETE FROM low_stock_state;",
  "DELETE FROM dispensing_lines;",
  "DELETE FROM dispensing_records;",
  "DELETE FROM disposals;",
  "DELETE FROM request_events;",
  "DELETE FROM requests;",
  "DELETE FROM stock_movements;",
  "DELETE FROM batches;",
  "DELETE FROM items;",
  "DELETE FROM categories;",
  "DELETE FROM counters WHERE name LIKE 'request:%';",
];

/** Parents first. */
const INSERT_ORDER = [
  "categories",
  "items",
  "batches",
  "stock_movements",
  "requests",
  "request_events",
  "dispensing_records",
  "dispensing_lines",
  "disposals",
  "notifications",
  "notification_state",
  "alert_state",
  "low_stock_state",
  "counters",
];

const UPSERT_COLUMNS = [
  "username",
  "username_lower",
  "email",
  "email_lower",
  "display_name",
  "role",
  "password_hash",
  "must_change_password",
  "disabled_at",
  "password_changed_at",
  "updated_at",
];

/** @param {Record<string, unknown>} user */
function upsertUser(user) {
  const columns = Object.keys(user);
  const values = columns.map((column) => sqlValue(user[column])).join(", ");
  const updates = UPSERT_COLUMNS.map(
    (column) => `${column} = excluded.${column}`
  ).join(", ");
  return `INSERT INTO users (${columns.join(", ")}) VALUES (${values}) ON CONFLICT (id) DO UPDATE SET ${updates};`;
}

/** @param {Record<string, unknown>} row */
function appendAudit(row) {
  const columns = Object.keys(row);
  const values = columns.map((column) => sqlValue(row[column])).join(", ");
  const guard = `NOT EXISTS (SELECT 1 FROM audit_log WHERE action = ${sqlValue(row.action)} AND entity_id = ${sqlValue(row.entity_id)} AND at = ${sqlValue(row.at)})`;
  return `INSERT INTO audit_log (${columns.join(", ")}) SELECT ${values} WHERE ${guard};`;
}

/**
 * @param {{ tables: Record<string, Record<string, unknown>[]> }} plan
 * @returns {string}
 */
export function buildDemoSql(plan) {
  const { tables } = plan;
  const statements = [...WIPE_STATEMENTS];
  statements.push(...tables.users.map(upsertUser));
  for (const table of INSERT_ORDER) {
    statements.push(...insertStatements(table, tables[table]));
  }
  statements.push(...tables.audit_log.map(appendAudit));
  return `${statements.join("\n")}\n`;
}
