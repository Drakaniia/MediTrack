/**
 * Per-user read / dismissed state. A missing `notification_state` row means "unread, not
 * dismissed", so state is created lazily by an upsert and every operation is idempotent:
 * the first timestamp wins (`COALESCE`), repeating a call changes nothing.
 */

import type { NotificationDto } from "../../../shared/schemas/alerts";
import type { D1DatabaseLike } from "../../env";
import { HttpError } from "../../http";
import { countUnread, findNotification } from "./notification-queries";

const NOT_FOUND_MESSAGE = "That notification does not exist.";

async function assertExists(db: D1DatabaseLike, id: string): Promise<void> {
  const row = await db
    .prepare("SELECT 1 AS present FROM notifications WHERE id = ?")
    .bind(id)
    .first<{ present: number }>();
  if (!row) {
    throw new HttpError("not_found", NOT_FOUND_MESSAGE);
  }
}

async function loadAfterWrite(
  db: D1DatabaseLike,
  userId: string,
  id: string
): Promise<NotificationDto> {
  const dto = await findNotification(db, userId, id);
  if (!dto) {
    throw new HttpError("not_found", NOT_FOUND_MESSAGE);
  }
  return dto;
}

export async function markRead(
  db: D1DatabaseLike,
  userId: string,
  id: string,
  now: Date
): Promise<NotificationDto> {
  await assertExists(db, id);
  await db
    .prepare(
      `INSERT INTO notification_state (notification_id, user_id, read_at, dismissed_at)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT (notification_id, user_id) DO UPDATE
       SET read_at = COALESCE(notification_state.read_at, excluded.read_at)`
    )
    .bind(id, userId, now.toISOString())
    .run();
  return await loadAfterWrite(db, userId, id);
}

/** Dismissing also reads: a hidden notification must not keep counting as unread. */
export async function dismiss(
  db: D1DatabaseLike,
  userId: string,
  id: string,
  now: Date
): Promise<NotificationDto> {
  await assertExists(db, id);
  const at = now.toISOString();
  await db
    .prepare(
      `INSERT INTO notification_state (notification_id, user_id, read_at, dismissed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (notification_id, user_id) DO UPDATE
       SET read_at = COALESCE(notification_state.read_at, excluded.read_at),
           dismissed_at = COALESCE(notification_state.dismissed_at, excluded.dismissed_at)`
    )
    .bind(id, userId, at, at)
    .run();
  return await loadAfterWrite(db, userId, id);
}

/** Marks every notification read for this user. Returns how many were unread before. */
export async function markAllRead(
  db: D1DatabaseLike,
  userId: string,
  now: Date
): Promise<number> {
  const unread = await countUnread(db, userId);
  await db
    .prepare(
      `INSERT INTO notification_state (notification_id, user_id, read_at, dismissed_at)
       SELECT n.id, ?, ?, NULL FROM notifications n WHERE 1
       ON CONFLICT (notification_id, user_id) DO UPDATE
       SET read_at = COALESCE(notification_state.read_at, excluded.read_at)`
    )
    .bind(userId, now.toISOString())
    .run();
  return unread;
}
