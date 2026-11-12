/**
 * The dashboard banner, computed LIVE from batches and items (never from the
 * `notifications` rows, which lag until the next generator run).
 *
 *  - Urgent   batches with stock whose expiry is today … today + urgentDays
 *  - Expired  batches still holding stock whose expiry is before today
 *  - Low      items with a threshold whose AVAILABLE stock (FEFO-eligible: active, qty > 0,
 *             not expired) is below it — expired stock awaiting disposal does not count
 */

import { todayInZone } from "../../../shared/dates";
import {
  type ClassBoundaries,
  classBoundaries,
  daysUntilExpiry,
  type ExpiryClass,
  expiryClassWhere,
} from "../../../shared/expiry";
import type {
  AlertBannerDto,
  AlertBannerTopItem,
  BannerTopItemKind,
} from "../../../shared/schemas/alerts";
import type { D1DatabaseLike } from "../../env";
import { loadSettings } from "../../settings-store";
import { countUnread } from "./notification-queries";

export const BANNER_TOP_ITEMS = 3;

const KIND_RANK: Record<BannerTopItemKind, number> = {
  expired: 0,
  low_stock: 2,
  urgent: 1,
};

interface BatchAlertRow {
  batch_id: string;
  batch_number: string;
  expiry: string;
  item_id: string;
  name: string;
  strength: string;
  unit: string;
}

interface LowStockRow {
  available: number;
  item_id: string;
  name: string;
  strength: string;
  threshold: number;
  unit: string;
}

const LIVE_BATCH_WHERE =
  "b.deleted_at IS NULL AND i.deleted_at IS NULL AND b.status = 'active' AND b.qty > 0";

const AVAILABLE_SUM =
  "COALESCE(SUM(CASE WHEN b.deleted_at IS NULL AND b.status = 'active' AND b.qty > 0 AND (b.expiry IS NULL OR b.expiry >= ?) THEN b.qty ELSE 0 END), 0)";

const LOW_STOCK_GROUPS = `SELECT i.id AS item_id, i.name, i.strength, i.unit, i.low_stock_threshold AS threshold, ${AVAILABLE_SUM} AS available
   FROM items i LEFT JOIN batches b ON b.item_id = i.id
   WHERE i.deleted_at IS NULL AND i.low_stock_threshold > 0
   GROUP BY i.id
   HAVING available < i.low_stock_threshold`;

function displayName(name: string, strength: string): string {
  return strength.trim() === "" ? name : `${name} ${strength.trim()}`;
}

async function countBatches(
  db: D1DatabaseLike,
  expiryClass: ExpiryClass,
  boundaries: ClassBoundaries
): Promise<number> {
  const where = expiryClassWhere("b.expiry", expiryClass, boundaries);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM batches b JOIN items i ON i.id = b.item_id WHERE ${LIVE_BATCH_WHERE} AND ${where.sql}`
    )
    .bind(...where.params)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function topBatches(
  db: D1DatabaseLike,
  expiryClass: "expired" | "urgent",
  boundaries: ClassBoundaries
): Promise<AlertBannerTopItem[]> {
  const where = expiryClassWhere("b.expiry", expiryClass, boundaries);
  const { results } = await db
    .prepare(
      `SELECT b.id AS batch_id, b.batch_number, b.expiry, i.id AS item_id, i.name, i.strength, i.unit
       FROM batches b JOIN items i ON i.id = b.item_id
       WHERE ${LIVE_BATCH_WHERE} AND ${where.sql}
       ORDER BY b.expiry ASC, lower(i.name), b.id
       LIMIT ?`
    )
    .bind(...where.params, BANNER_TOP_ITEMS)
    .all<BatchAlertRow>();
  return results.map((row) => ({
    available: null,
    batchId: row.batch_id,
    batchNumber: row.batch_number,
    daysUntil: daysUntilExpiry(row.expiry, boundaries.today),
    expiry: row.expiry,
    itemId: row.item_id,
    itemName: displayName(row.name, row.strength),
    kind: expiryClass,
    threshold: null,
    unit: row.unit,
  }));
}

async function countLowStock(
  db: D1DatabaseLike,
  today: string
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS total FROM (${LOW_STOCK_GROUPS})`)
    .bind(today)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function topLowStock(
  db: D1DatabaseLike,
  today: string
): Promise<AlertBannerTopItem[]> {
  const { results } = await db
    .prepare(
      `${LOW_STOCK_GROUPS} ORDER BY (available * 1.0 / i.low_stock_threshold) ASC, lower(i.name), i.id LIMIT ?`
    )
    .bind(today, BANNER_TOP_ITEMS)
    .all<LowStockRow>();
  return results.map((row) => ({
    available: row.available,
    batchId: null,
    batchNumber: null,
    daysUntil: null,
    expiry: null,
    itemId: row.item_id,
    itemName: displayName(row.name, row.strength),
    kind: "low_stock",
    threshold: row.threshold,
    unit: row.unit,
  }));
}

/** Expired before urgent before low stock; the lists are already ordered within a kind. */
export function pickTopItems(
  candidates: readonly AlertBannerTopItem[]
): AlertBannerTopItem[] {
  return candidates
    .map((item, index) => ({ index, item }))
    .sort(
      (a, b) =>
        KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] || a.index - b.index
    )
    .slice(0, BANNER_TOP_ITEMS)
    .map(({ item }) => item);
}

export async function loadBanner(
  db: D1DatabaseLike,
  userId: string,
  now: Date
): Promise<AlertBannerDto> {
  const settings = await loadSettings(db);
  const today = todayInZone(now, settings.facility.timezone);
  const thresholds = {
    nearDays: settings.expiry.nearDays,
    urgentDays: settings.expiry.urgentDays,
  };
  if (!settings.alerts.inApp) {
    return {
      counts: { expired: 0, lowStock: 0, urgent: 0 },
      enabled: false,
      thresholds,
      today,
      topItems: [],
      unreadCount: 0,
    };
  }
  const boundaries = classBoundaries(today, thresholds);
  const [
    expired,
    urgent,
    lowStock,
    expiredTop,
    urgentTop,
    lowStockTop,
    unreadCount,
  ] = await Promise.all([
    countBatches(db, "expired", boundaries),
    countBatches(db, "urgent", boundaries),
    countLowStock(db, today),
    topBatches(db, "expired", boundaries),
    topBatches(db, "urgent", boundaries),
    topLowStock(db, today),
    countUnread(db, userId),
  ]);
  return {
    counts: { expired, lowStock, urgent },
    enabled: true,
    thresholds,
    today,
    topItems: pickTopItems([...expiredTop, ...urgentTop, ...lowStockTop]),
    unreadCount,
  };
}
