/**
 * `GET /api/dashboard` (spec §7.1). Role-shaped: a card the role may not see is not queried and
 * its key is absent from the payload. The number of statements is constant (never per item).
 */

import { monthOf } from "../../../shared/dates";
import { can } from "../../../shared/permissions";
import type { Role } from "../../../shared/roles";
import {
  DASHBOARD_LIST_LIMIT,
  type DashboardDto,
} from "../../../shared/schemas/dashboard";
import type { D1DatabaseLike } from "../../env";
import { loadFefoList, readContextFor } from "../inventory/read-models";
import { loadActivity } from "./activity";
import { loadExpiringInMonth } from "./expiring-month";
import { loadPendingRequests, loadRecentDispensing } from "./request-cards";
import { loadTotals } from "./stock-totals";

export interface DashboardInput {
  /** `YYYY-MM`; defaults to the facility's current month. */
  month?: string;
  now: Date;
  role: Role;
}

export async function loadDashboard(
  db: D1DatabaseLike,
  input: DashboardInput
): Promise<DashboardDto> {
  const { now, role } = input;
  const rc = await readContextFor(db, now);
  const month = input.month ?? monthOf(rc.today);

  const [
    totals,
    expiringThisMonth,
    useFirst,
    pendingRequests,
    recent,
    activity,
  ] = await Promise.all([
    loadTotals(db, rc),
    loadExpiringInMonth(db, rc, month),
    loadFefoList(db, rc, { limit: DASHBOARD_LIST_LIMIT }),
    can(role, "requests.view") ? loadPendingRequests(db) : undefined,
    can(role, "dispensing.view") ? loadRecentDispensing(db) : undefined,
    can(role, "analytics.view")
      ? loadActivity(db, month, rc.timezone)
      : undefined,
  ]);

  return {
    ...(activity ? { activity } : {}),
    expiringThisMonth,
    generatedAt: now.toISOString(),
    month,
    ...(pendingRequests ? { pendingRequests } : {}),
    ...(recent ? { recentDispensing: recent } : {}),
    thresholds: rc.thresholds,
    timezone: rc.timezone,
    today: rc.today,
    totals,
    useFirst,
  };
}
