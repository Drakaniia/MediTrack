/** Facility "today" and expiry thresholds for one request, read once from settings. */

import { todayInZone } from "../../../shared/dates";
import {
  type ClassBoundaries,
  classBoundaries,
  type ExpiryThresholds,
} from "../../../shared/expiry";
import type { D1DatabaseLike } from "../../env";
import { loadSettings } from "../../settings-store";

export interface ExpiryContext {
  boundaries: ClassBoundaries;
  thresholds: ExpiryThresholds;
  timezone: string;
  /** Facility-local `YYYY-MM-DD`. */
  today: string;
}

export async function loadExpiryContext(
  db: D1DatabaseLike,
  now: Date
): Promise<ExpiryContext> {
  const { expiry, facility } = await loadSettings(db);
  const { timezone } = facility;
  const today = todayInZone(now, timezone);
  const thresholds = {
    nearDays: expiry.nearDays,
    urgentDays: expiry.urgentDays,
  };
  return {
    boundaries: classBoundaries(today, thresholds),
    thresholds,
    timezone,
    today,
  };
}
