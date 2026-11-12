/** Housekeeping the daily job does after the alerts: expired sessions, old login attempts, old notifications. */

import type { PurgeReport } from "../../../shared/schemas/alert-run";
import type { D1DatabaseLike } from "../../env";

export const LOGIN_ATTEMPT_RETENTION_DAYS = 1;
export const NOTIFICATION_RETENTION_DAYS = 90;
const MS_PER_DAY = 86_400_000;

function before(now: Date, days: number): string {
  return new Date(now.getTime() - days * MS_PER_DAY).toISOString();
}

/** One `db.batch`: sessions past either expiry, login attempts > 1 day, notifications > 90 days. */
export async function purgeOldRows(
  db: D1DatabaseLike,
  now: Date
): Promise<PurgeReport> {
  const nowIso = now.toISOString();
  const [sessions, attempts, notifications] = await db.batch([
    db
      .prepare(
        "DELETE FROM sessions WHERE expires_at < ? OR absolute_expires_at < ?"
      )
      .bind(nowIso, nowIso),
    db
      .prepare("DELETE FROM login_attempts WHERE attempted_at < ?")
      .bind(before(now, LOGIN_ATTEMPT_RETENTION_DAYS)),
    db
      .prepare("DELETE FROM notifications WHERE created_at < ?")
      .bind(before(now, NOTIFICATION_RETENTION_DAYS)),
  ]);
  return {
    loginAttempts: attempts?.meta.changes ?? 0,
    notifications: notifications?.meta.changes ?? 0,
    sessions: sessions?.meta.changes ?? 0,
  };
}
