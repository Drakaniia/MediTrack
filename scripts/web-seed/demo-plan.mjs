/**
 * Turns `apps/web/demo/demo-data.json` (relative dates) into concrete table rows for one base
 * date. Pure: the same dataset, base date, timezone, thresholds and password always give the same
 * rows, ids and batch codes.
 *
 *     const plan = buildDemoPlan(dataset, { today: "2026-11-12", timeZone: "Asia/Manila" });
 *     plan.tables.batches        // rows, snake_case columns exactly as in migrations/0001_init.sql
 *     plan.summary               // counts for the summary table
 *
 * The parts live in `demo-stock.mjs` (people, catalogue, batches, ledger, dispensing),
 * `demo-requests.mjs` (requests + events) and `demo-alerts.mjs` (notifications and alert state).
 */

import { HASH_ITERATIONS } from "./admin.mjs";
import { buildAlerts } from "./demo-alerts.mjs";
import { createContext } from "./demo-context.mjs";
import { buildRequests, REQUEST_STATUSES } from "./demo-requests.mjs";
import {
  buildCategories,
  buildItems,
  buildStock,
  buildUsers,
  resolveDemoPassword,
} from "./demo-stock.mjs";
import { DEFAULT_DEMO_PASSWORD } from "./demo-context.mjs";
import { DEFAULT_THRESHOLDS } from "./expiry.mjs";

export const SEED_ACTOR_NAME = "System (seed-demo)";

/**
 * @param {any} entry
 * @returns {Record<string, unknown>}
 */
function auditRow(entry) {
  const { actor = null } = entry;
  return {
    at: entry.at,
    actor_id: actor?.id ?? null,
    actor_name: actor?.displayName ?? SEED_ACTOR_NAME,
    actor_role: actor?.role ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    summary: entry.summary,
    before: entry.before === undefined ? null : JSON.stringify(entry.before),
    after: entry.after === undefined ? null : JSON.stringify(entry.after),
    ip: null,
  };
}

/** @param {import("./demo-context.mjs").DemoContext} ctx */
function usersById(ctx) {
  return new Map([...ctx.users.values()].map((user) => [user.id, user]));
}

/**
 * A handful of audit rows that match the seeded history. audit_log is append-only, so these are
 * APPENDED and guarded by `NOT EXISTS` (same action, entity and time) when the SQL runs.
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {any} stock
 * @param {any} requests
 * @param {Record<string, number>} counts
 */
function buildAudit(ctx, stock, requests, counts) {
  const people = usersById(ctx);
  const rows = [];
  for (const disposal of stock.disposals) {
    rows.push(
      auditRow({
        action: "stock.dispose",
        actor: people.get(disposal.disposed_by),
        after: { qty: 0, reason: disposal.reason, status: "disposed" },
        at: disposal.disposed_at,
        entityId: disposal.batch_id,
        entityType: "batch",
        summary: `Disposed ${disposal.qty} of "${disposal.item_name}" batch ${disposal.batch_number} (${disposal.reason})`,
      })
    );
  }
  for (const { state } of stock.batchInfos) {
    for (const event of state.events.filter(
      /** @param {any} e */ (e) => e.kind === "adjust"
    )) {
      const sign = event.delta > 0 ? "+" : "";
      rows.push(
        auditRow({
          action: "stock.adjust",
          actor: event.actor,
          after: { delta: event.delta, reason: event.reason },
          at: event.at,
          entityId: state.id,
          entityType: "batch",
          summary: `Adjusted "${state.item.label}" batch ${state.number} by ${sign}${event.delta} (${event.reason})`,
        })
      );
    }
  }
  for (const record of stock.dispensingMeta) {
    const request = requests.requests.find(
      /** @param {any} r */ (r) => r.id === ctx.id("request", record.requestRef ?? "")
    );
    if (record.undoneAt !== null) {
      rows.push(
        auditRow({
          action: "quick_deduct.undo",
          actor: record.by,
          after: { undone: true },
          at: record.undoneAt,
          entityId: record.id,
          entityType: "dispensing_record",
          summary: `Undid Quick Deduct of ${record.qty} "${ctx.items.get(record.itemRef)?.label}"`,
        })
      );
    } else if (request && record.source === "queue") {
      rows.push(
        auditRow({
          action: "request.dispense",
          actor: record.by,
          after: { recordId: record.id },
          at: record.at,
          entityId: request.id,
          entityType: "request",
          summary: `${request.code}: handed over ${record.qty} of "${request.item_name}"`,
        })
      );
    }
  }
  for (const request of requests.requests.filter(
    /** @param {any} r */ (r) => r.status === "denied"
  )) {
    const event = requests.events.find(
      /** @param {any} e */ (e) => e.request_id === request.id && e.to_status === "denied"
    );
    rows.push(
      auditRow({
        action: "request.transition",
        actor: people.get(event.actor_id),
        after: { deniedReason: request.denied_reason, status: "denied" },
        at: event.at,
        before: { status: "pending" },
        entityId: request.id,
        entityType: "request",
        summary: `${request.code}: denied (${request.denied_reason})`,
      })
    );
  }
  rows.push(
    auditRow({
      action: "demo.seed",
      after: counts,
      at: ctx.at(0, "00:00"),
      entityId: "demo-data",
      entityType: "system",
      summary: `Loaded demo data for ${ctx.today}: ${counts.items} items, ${counts.batches} batches, ${counts.requests} requests`,
    })
  );
  return rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {any} stock
 * @param {any} requests
 * @param {any} alerts
 * @param {Record<string, number>} counts
 */
function summarize(ctx, stock, requests, alerts, counts) {
  const batchClasses = {
    disposed: 0,
    expired: 0,
    near_expiry: 0,
    noExpiry: 0,
    safe: 0,
    urgent: 0,
    zeroQty: 0,
  };
  for (const { expiryClass, row } of stock.batchInfos) {
    if (row.expiry === null) {
      batchClasses.noExpiry += 1;
    }
    if (row.status === "disposed") {
      batchClasses.disposed += 1;
    } else if (row.qty === 0) {
      batchClasses.zeroQty += 1;
    } else {
      batchClasses[expiryClass] += 1;
    }
  }
  /** @type {Record<string, number>} */
  const requestStatuses = Object.fromEntries(
    REQUEST_STATUSES.map((status) => [status, 0])
  );
  for (const request of requests.requests) {
    requestStatuses[request.status] += 1;
  }
  return {
    batchClasses,
    counts,
    lowStock: alerts.lowItems.map(
      /** @param {any} entry */ (entry) => ({
        available: entry.available,
        name: entry.item.label,
        status: entry.available === 0 ? "out" : "low",
        threshold: entry.threshold,
      })
    ),
    quarantine: batchClasses.expired,
    requestStatuses,
    thresholds: ctx.thresholds,
    timeZone: ctx.timeZone,
    today: ctx.today,
  };
}

/**
 * @param {any} dataset parsed demo-data.json
 * @param {{
 *   iterations?: number,
 *   password?: string,
 *   thresholds?: { nearDays: number, urgentDays: number },
 *   timeZone: string,
 *   today: string,
 * }} options
 */
export function buildDemoPlan(dataset, options) {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const ctx = createContext(dataset, {
    thresholds,
    timeZone: options.timeZone,
    today: options.today,
  });
  const password = resolveDemoPassword(options.password);
  const users = buildUsers(ctx, {
    iterations: options.iterations ?? HASH_ITERATIONS,
    password,
  });
  const { idByName, rows: categories } = buildCategories(ctx);
  const items = buildItems(ctx, idByName);
  const stock = buildStock(ctx);
  const requests = buildRequests(ctx, stock.dispensingMeta);
  const alerts = buildAlerts(ctx, stock.batchInfos, stock.disposals, users);

  /** @type {Record<string, number>} */
  const counts = {
    batches: stock.batches.length,
    categories: categories.length,
    dispensingLines: stock.dispensingLines.length,
    dispensingRecords: stock.dispensingRecords.length,
    disposals: stock.disposals.length,
    items: items.length,
    movements: stock.movements.length,
    notifications: alerts.notifications.length,
    requestEvents: requests.events.length,
    requests: requests.requests.length,
    users: users.length,
  };
  const audit = buildAudit(ctx, stock, requests, counts);
  counts.audit = audit.length;

  return {
    passwordIsDefault: password === DEFAULT_DEMO_PASSWORD,
    summary: summarize(ctx, stock, requests, alerts, counts),
    tables: {
      alert_state: alerts.alertState,
      audit_log: audit,
      batches: stock.batches,
      categories,
      counters: requests.counters,
      dispensing_lines: stock.dispensingLines,
      dispensing_records: stock.dispensingRecords,
      disposals: stock.disposals,
      items,
      low_stock_state: alerts.lowStockState,
      notification_state: alerts.notificationState,
      notifications: alerts.notifications,
      request_events: requests.events,
      requests: requests.requests,
      stock_movements: stock.movements,
      users,
    },
    thresholds,
    timeZone: options.timeZone,
    today: options.today,
  };
}
