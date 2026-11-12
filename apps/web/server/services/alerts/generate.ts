/**
 * The alert generator (spec §6.2, §7.6): compares each live batch's CURRENT expiry class
 * (facility-local today + thresholds) with the class last notified (`alert_state`) and
 * turns changes into notifications exactly once.
 *
 *  - WORSENING (safe → near_expiry → urgent → expired): one notification, the state moves.
 *    Older open notifications of the same batch are resolved (they are superseded).
 *  - IMPROVEMENT (expiry extended, threshold raised, …): the state moves silently and the
 *    batch's open notifications are resolved.
 *  - Batches that left the live set (disposed, emptied, trashed): notifications resolved,
 *    state deleted.
 *  - Low stock compares FEFO-eligible stock with the item's threshold against
 *    `low_stock_state`: newly low notifies, recovered resolves.
 *
 * `settings.alerts.inApp = false` still ADVANCES both state tables, so switching the
 * in-app centre on later does not flood it with the backlog, but it writes no
 * notification rows. The returned transitions are unaffected, so push and the digest keep
 * working. Runtime-agnostic: no clock, no Node APIs; imported by the cron Worker and the
 * admin "run now" route.
 */

import { todayInZone } from "../../../shared/dates";
import {
  assessExpiry,
  classBoundaries,
  EXPIRY_CLASS_RANK,
  type ExpiryClass,
  type ExpiryThresholds,
} from "../../../shared/expiry";
import type { D1DatabaseLike } from "../../env";
import { newId } from "../../ids";
import {
  batchNotificationText,
  itemDisplayName,
  lowStockNotificationText,
  SEVERITY_BY_CLASS,
} from "./messages";
import {
  type BatchRow,
  countLiveBatches,
  type LowStockRow,
  loadCandidateBatches,
  loadThresholdItems,
} from "./queries";
import {
  alertStateSteps,
  cleanupSteps,
  executeSteps,
  type LowStateWrite,
  lowStockStateSteps,
  type NotificationInsert,
  notificationSteps,
  reopenedStateStep,
  resolveBatchSteps,
  resolveLowStockSteps,
  type StateWrite,
  type Step,
} from "./statements";
import type {
  AlertClass,
  BatchTransition,
  GenerationOptions,
  GenerationResult,
  LowStockEntry,
} from "./types";

export type { GenerationOptions, GenerationResult } from "./types";

function isAlertClass(value: ExpiryClass): value is AlertClass {
  return value !== "safe";
}

interface BatchPlan {
  improvedIds: string[];
  inserts: NotificationInsert[];
  stateWrites: StateWrite[];
  /** Batches that worsened, by the class they moved to (older notifications are superseded). */
  supersede: Map<AlertClass, string[]>;
  transitions: BatchTransition[];
}

function recordWorsening(
  plan: BatchPlan,
  row: BatchRow,
  from: ExpiryClass,
  to: AlertClass,
  daysUntil: number
): void {
  const itemName = itemDisplayName(row.name, row.strength);
  const text = batchNotificationText({
    batchNumber: row.batch_number,
    daysUntil,
    expiry: row.expiry,
    itemName,
    kind: to,
    qty: row.qty,
    unit: row.unit,
  });
  plan.transitions.push({
    batchId: row.batch_id,
    batchNumber: row.batch_number,
    daysUntil,
    expiry: row.expiry,
    from,
    itemId: row.item_id,
    itemName,
    to,
  });
  plan.inserts.push({
    batchId: row.batch_id,
    body: text.body,
    data: text.data,
    dedupeKey: `batch:${row.batch_id}:${to}`,
    id: newId(),
    itemId: row.item_id,
    kind: to,
    severity: SEVERITY_BY_CLASS[to],
    title: text.title,
  });
  const ids = plan.supersede.get(to) ?? [];
  ids.push(row.batch_id);
  plan.supersede.set(to, ids);
}

function planBatches(
  rows: readonly BatchRow[],
  today: string,
  thresholds: ExpiryThresholds
): BatchPlan {
  const plan: BatchPlan = {
    improvedIds: [],
    inserts: [],
    stateWrites: [],
    supersede: new Map(),
    transitions: [],
  };
  for (const row of rows) {
    const { daysUntil, expiryClass } = assessExpiry(
      row.expiry,
      today,
      thresholds
    );
    const previous = row.last_class ?? "safe";
    if (expiryClass === previous) {
      continue;
    }
    plan.stateWrites.push({ id: row.batch_id, value: expiryClass });
    const worsened =
      EXPIRY_CLASS_RANK[expiryClass] < EXPIRY_CLASS_RANK[previous];
    if (worsened && isAlertClass(expiryClass)) {
      recordWorsening(plan, row, previous, expiryClass, daysUntil ?? 0);
    } else {
      plan.improvedIds.push(row.batch_id);
    }
  }
  return plan;
}

interface LowStockPlan {
  currentLow: number;
  inserts: NotificationInsert[];
  newlyLow: LowStockEntry[];
  recoveredIds: string[];
  stateWrites: LowStateWrite[];
}

function recordNewlyLow(
  plan: LowStockPlan,
  row: LowStockRow,
  localDate: string
): void {
  const itemName = itemDisplayName(row.name, row.strength);
  const entry: LowStockEntry = {
    available: row.available,
    itemId: row.item_id,
    itemName,
    threshold: row.threshold,
    unit: row.unit,
  };
  const text = lowStockNotificationText(entry);
  plan.newlyLow.push(entry);
  plan.inserts.push({
    batchId: null,
    body: text.body,
    data: text.data,
    dedupeKey: `lowstock:${row.item_id}:${localDate}`,
    id: newId(),
    itemId: row.item_id,
    kind: "low_stock",
    severity: row.available === 0 ? "critical" : "warning",
    title: text.title,
  });
}

function planLowStock(
  rows: readonly LowStockRow[],
  localDate: string
): LowStockPlan {
  const plan: LowStockPlan = {
    currentLow: 0,
    inserts: [],
    newlyLow: [],
    recoveredIds: [],
    stateWrites: [],
  };
  for (const row of rows) {
    const isLow = row.available < row.threshold;
    const wasLow = row.was_low === 1;
    plan.currentLow += isLow ? 1 : 0;
    if (isLow === wasLow) {
      continue;
    }
    plan.stateWrites.push({ isLow, itemId: row.item_id });
    if (isLow) {
      recordNewlyLow(plan, row, localDate);
    } else {
      plan.recoveredIds.push(row.item_id);
    }
  }
  return plan;
}

interface WritePlan {
  batches: BatchPlan;
  inApp: boolean;
  lowStock: LowStockPlan;
  nowIso: string;
}

function buildSteps(db: D1DatabaseLike, plan: WritePlan): Step[] {
  const { batches, lowStock, nowIso } = plan;
  const steps: Step[] = [];
  if (plan.inApp) {
    const inserts = [...batches.inserts, ...lowStock.inserts];
    steps.push(...notificationSteps(db, inserts, nowIso));
    if (inserts.length > 0) {
      steps.push(reopenedStateStep(db, nowIso));
    }
  }
  for (const [kind, ids] of batches.supersede) {
    steps.push(...resolveBatchSteps(db, ids, nowIso, kind));
  }
  steps.push(
    ...resolveBatchSteps(db, batches.improvedIds, nowIso),
    ...resolveLowStockSteps(db, lowStock.recoveredIds, nowIso),
    ...cleanupSteps(db, nowIso),
    ...alertStateSteps(db, batches.stateWrites, nowIso),
    ...lowStockStateSteps(db, lowStock.stateWrites, nowIso)
  );
  return steps;
}

export async function runAlertGeneration(
  db: D1DatabaseLike,
  options: GenerationOptions
): Promise<GenerationResult> {
  const { now, settings } = options;
  const nowIso = now.toISOString();
  const localDate = todayInZone(now, settings.facility.timezone);
  const boundaries = classBoundaries(localDate, settings.expiry);

  const [totals, candidates, items] = await Promise.all([
    countLiveBatches(db, boundaries),
    loadCandidateBatches(db, boundaries),
    loadThresholdItems(db, localDate),
  ]);

  const batches = planBatches(candidates, localDate, settings.expiry);
  const lowStock = planLowStock(items, localDate);
  const written = await executeSteps(
    db,
    buildSteps(db, {
      batches,
      inApp: settings.alerts.inApp,
      lowStock,
      nowIso,
    })
  );

  return {
    counts: { ...totals, lowStock: lowStock.currentLow },
    localDate,
    lowStock: lowStock.newlyLow,
    notificationsCreated: written.created,
    resolved: written.resolved,
    transitions: batches.transitions,
  };
}
