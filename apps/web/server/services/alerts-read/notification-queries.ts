/** Reading the notification centre for ONE user (shared rows + that user's state rows). */

import type {
  AlertsQuery,
  NotificationDto,
  NotificationListMeta,
} from "../../../shared/schemas/alerts";
import type { D1DatabaseLike } from "../../env";
import { placeholders } from "../../http";
import {
  NOTIFICATION_COLUMNS,
  type NotificationRow,
  toNotificationDto,
} from "./notification-mapper";

const STATE_JOIN =
  "LEFT JOIN notification_state s ON s.notification_id = n.id AND s.user_id = ?";

/** Condition for notifications that count towards the unread badge. */
const UNREAD_CONDITION =
  "n.resolved_at IS NULL AND s.dismissed_at IS NULL AND s.read_at IS NULL";

export interface NotificationPage {
  rows: NotificationDto[];
  total: number;
}

interface Filter {
  params: string[];
  where: string;
}

function buildFilter(query: AlertsQuery): Filter {
  const clauses: string[] = [];
  const params: string[] = [];
  if (!query.includeDismissed) {
    clauses.push("s.dismissed_at IS NULL");
  }
  if (!query.includeResolved) {
    clauses.push("n.resolved_at IS NULL");
  }
  if (query.unread) {
    clauses.push("s.read_at IS NULL");
  }
  if (query.kind) {
    clauses.push(`n.kind IN (${placeholders(query.kind.length)})`);
    params.push(...query.kind);
  }
  if (query.severity) {
    clauses.push(`n.severity IN (${placeholders(query.severity.length)})`);
    params.push(...query.severity);
  }
  return {
    params,
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}

/** Unread, not dismissed, not resolved — what the bell badge and the nav badge show. */
export async function countUnread(
  db: D1DatabaseLike,
  userId: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM notifications n ${STATE_JOIN} WHERE ${UNREAD_CONDITION}`
    )
    .bind(userId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function listNotifications(
  db: D1DatabaseLike,
  userId: string,
  query: AlertsQuery,
  paging: { limit: number; offset: number }
): Promise<NotificationPage> {
  const filter = buildFilter(query);
  const { results } = await db
    .prepare(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications n ${STATE_JOIN} ${filter.where} ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`
    )
    .bind(userId, ...filter.params, paging.limit, paging.offset)
    .all<NotificationRow>();
  const count = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM notifications n ${STATE_JOIN} ${filter.where}`
    )
    .bind(userId, ...filter.params)
    .first<{ total: number }>();
  return { rows: results.map(toNotificationDto), total: count?.total ?? 0 };
}

/** One notification as the user sees it, or null when the id is unknown. */
export async function findNotification(
  db: D1DatabaseLike,
  userId: string,
  id: string
): Promise<NotificationDto | null> {
  const row = await db
    .prepare(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications n ${STATE_JOIN} WHERE n.id = ?`
    )
    .bind(userId, id)
    .first<NotificationRow>();
  return row ? toNotificationDto(row) : null;
}

export async function listMeta(
  db: D1DatabaseLike,
  userId: string,
  page: NotificationPage,
  paging: { limit: number; offset: number }
): Promise<NotificationListMeta> {
  return {
    limit: paging.limit,
    offset: paging.offset,
    total: page.total,
    unread: await countUnread(db, userId),
  };
}
