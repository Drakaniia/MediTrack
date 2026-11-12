/**
 * Demo plan, part 3: what the daily alert run would have produced by the base date.
 *
 * Notifications follow `server/services/alerts/{generate,messages}.ts` (same titles, bodies,
 * severities, `data` payload and `dedupe_key` shapes). `alert_state` and `low_stock_state` are
 * seeded to match, so the first real cron run after seeding does not re-announce what the demo
 * already shows. Everything is derived from the batches, never listed by hand.
 */

import { addDays, daysBetween } from "./dates.mjs";
import { DAILY_RUN_TIME } from "./demo-context.mjs";

const EXPIRY_LABELS = {
  expired: "Expired",
  near_expiry: "Near Expiry",
  urgent: "Urgent",
};
const SEVERITY = { expired: "critical", near_expiry: "info", urgent: "warning" };
const URLS = {
  expired: "/inventory/quarantine",
  low_stock: "/inventory/low-stock",
  near_expiry: "/inventory/expiry",
  urgent: "/inventory/expiry",
};
const READ_SHARE = 0.45;
const DISMISSED_SHARE = 0.1;
const MINUTES_AFTER_MIN = 40;
const MINUTES_AFTER_SPREAD = 300;

/** @param {number} count @param {string} noun */
function plural(count, noun) {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

/** @param {number} daysUntil */
function describeWhen(daysUntil) {
  if (daysUntil < 0) {
    return `expired ${plural(-daysUntil, "day")} ago`;
  }
  if (daysUntil === 0) {
    return "expires today";
  }
  if (daysUntil === 1) {
    return "expires tomorrow";
  }
  return `expires in ${plural(daysUntil, "day")}`;
}

/** @param {"expired" | "near_expiry" | "urgent"} kind @param {{ qty: number, unit: string, expiry: string }} batch */
function bodyFor(kind, batch) {
  if (kind === "expired") {
    return `${batch.qty} ${batch.unit} still in stock are past their expiry date. Take them out of use and record a disposal.`;
  }
  if (kind === "urgent") {
    return `${batch.qty} ${batch.unit} in stock. Use this batch first, before ${batch.expiry}.`;
  }
  return `${batch.qty} ${batch.unit} in stock. Plan to use this batch before ${batch.expiry}.`;
}

/**
 * The day the batch entered `kind`, never before it arrived and never after today.
 * @param {"expired" | "near_expiry" | "urgent"} kind
 * @param {{ expiry: string, received_on: string }} batch
 * @param {import("./demo-context.mjs").DemoContext} ctx
 */
function transitionDate(kind, batch, ctx) {
  const starts = {
    expired: addDays(batch.expiry, 1),
    near_expiry: addDays(batch.expiry, -ctx.thresholds.nearDays),
    urgent: addDays(batch.expiry, -ctx.thresholds.urgentDays),
  };
  const candidates = [starts[kind], batch.received_on].sort();
  const later = candidates[1];
  return later > ctx.today ? ctx.today : later;
}

/**
 * Per item: usable ("available") and on-hand quantities, from the batch rows.
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {any[]} batchInfos
 */
export function availabilityByItem(ctx, batchInfos) {
  /** @type {Map<string, { available: number, onHand: number }>} */
  const totals = new Map();
  for (const { row } of batchInfos) {
    const entry = totals.get(row.item_id) ?? { available: 0, onHand: 0 };
    if (row.status === "active" && row.deleted_at === null) {
      entry.onHand += row.qty;
      if (row.qty > 0 && (row.expiry === null || row.expiry >= ctx.today)) {
        entry.available += row.qty;
      }
    }
    totals.set(row.item_id, entry);
  }
  return totals;
}

/**
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {any[]} batchInfos
 * @param {any[]} disposals
 * @param {any[]} userRows
 */
export function buildAlerts(ctx, batchInfos, disposals, userRows) {
  const notifications = [];
  const alertState = [];
  const runAt = ctx.at(0, DAILY_RUN_TIME);
  const today = ctx.today;

  for (const { expiryClass, row, state } of batchInfos) {
    const live = row.status === "active" && row.qty > 0;
    const disposal = disposals.find(
      /** @param {any} d */ (d) => d.batch_id === row.id
    );
    const expiredAndWrittenOff = disposal?.reason === "expired";
    if (!(live || expiredAndWrittenOff)) {
      continue;
    }
    const kind = live ? expiryClass : "expired";
    if (kind === "safe") {
      if (live) {
        alertState.push({
          batch_id: row.id,
          last_class: "safe",
          notified_at: row.created_at,
        });
      }
      continue;
    }
    const date = transitionDate(kind, row, ctx);
    const createdAt = ctx.at(daysBetween(today, date), DAILY_RUN_TIME);
    const daysUntil = daysBetween(date, row.expiry);
    const itemName = state.item.label;
    notifications.push({
      id: ctx.id("notification", `batch:${row.id}:${kind}`),
      kind,
      severity: SEVERITY[kind],
      item_id: row.item_id,
      batch_id: row.id,
      title: `${itemName} · ${row.batch_number} is ${EXPIRY_LABELS[kind]} — ${describeWhen(daysUntil)} (${row.expiry})`,
      body: bodyFor(kind, { expiry: row.expiry, qty: live ? row.qty : disposal.qty, unit: state.item.unit }),
      data: JSON.stringify({
        batchNumber: row.batch_number,
        daysUntil,
        expiry: row.expiry,
        itemName,
        onHand: live ? row.qty : disposal.qty,
        unit: state.item.unit,
        url: URLS[kind],
      }),
      dedupe_key: `batch:${row.id}:${kind}`,
      created_at: createdAt,
      resolved_at: live ? null : disposal.disposed_at,
    });
    if (live) {
      alertState.push({ batch_id: row.id, last_class: kind, notified_at: createdAt });
    }
  }

  const totals = availabilityByItem(ctx, batchInfos);
  const lowStockState = [];
  const lowItems = [];
  for (const item of ctx.items.values()) {
    if (item.threshold <= 0) {
      continue;
    }
    const available = totals.get(item.id)?.available ?? 0;
    const isLow = available < item.threshold;
    lowStockState.push({ item_id: item.id, is_low: isLow ? 1 : 0, notified_at: runAt });
    if (!isLow) {
      continue;
    }
    lowItems.push({ available, item, threshold: item.threshold });
    const out = available === 0;
    notifications.push({
      id: ctx.id("notification", `lowstock:${item.id}:${today}`),
      kind: "low_stock",
      severity: out ? "critical" : "warning",
      item_id: item.id,
      batch_id: null,
      title: out
        ? `${item.label} is out of stock (minimum ${item.threshold} ${item.unit})`
        : `${item.label} is low on stock — ${available} ${item.unit} left (minimum ${item.threshold})`,
      body: out
        ? "Nothing usable is left. Reorder as soon as you can."
        : `Only ${available} ${item.unit} can still be used. Reorder soon.`,
      data: JSON.stringify({
        itemName: item.label,
        onHand: available,
        threshold: item.threshold,
        unit: item.unit,
        url: URLS.low_stock,
      }),
      dedupe_key: `lowstock:${item.id}:${today}`,
      created_at: runAt,
      resolved_at: null,
    });
  }

  notifications.sort((a, b) =>
    a.created_at === b.created_at
      ? a.dedupe_key.localeCompare(b.dedupe_key)
      : a.created_at.localeCompare(b.created_at)
  );
  const notificationState = buildReadState(ctx, notifications, userRows);
  return { alertState, lowItems, lowStockState, notificationState, notifications };
}

/**
 * Mixed read state per demo user. Notifications from today stay unread for everybody (that is
 * what a fresh daily run looks like); older ones are read, dismissed or untouched at random,
 * from a seeded generator so reruns agree.
 * @param {import("./demo-context.mjs").DemoContext} ctx
 * @param {any[]} notifications
 * @param {any[]} userRows
 */
function buildReadState(ctx, notifications, userRows) {
  const startOfToday = ctx.at(0, "00:00");
  const rows = [];
  for (const notification of notifications) {
    if (notification.created_at >= startOfToday) {
      continue;
    }
    for (const user of userRows) {
      const roll = ctx.random();
      if (roll >= READ_SHARE + DISMISSED_SHARE) {
        continue;
      }
      const readAt = new Date(
        Date.parse(notification.created_at) +
          (MINUTES_AFTER_MIN + Math.floor(ctx.random() * MINUTES_AFTER_SPREAD)) * 60_000
      ).toISOString();
      rows.push({
        notification_id: notification.id,
        user_id: user.id,
        read_at: readAt,
        dismissed_at: roll < READ_SHARE ? null : readAt,
      });
    }
  }
  return rows;
}
