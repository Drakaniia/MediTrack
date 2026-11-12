import { cn } from "@cmis/ui/lib/utils";
import type { DashboardDto } from "@shared/schemas/dashboard";
import type { ReactElement } from "react";

import { useCan } from "@/lib/auth/guards";

import { formatMonthLabel } from "../lib/months";
import { ActivityCard } from "./activity-card";
import { ExpiringCard } from "./expiring-card";
import { MonthPicker } from "./month-picker";
import { PendingRequestsCard } from "./pending-requests-card";
import { RecentDispensingCard } from "./recent-dispensing-card";
import { StatCards } from "./stat-cards";
import { UseFirstCard } from "./use-first-card";

export interface DashboardBodyProps {
  currentMonth: string;
  data: DashboardDto;
  /** The data on screen belongs to the previous month while the new one loads. */
  isRefreshingMonth: boolean;
  month: string;
  onMonthChange: (month: string) => void;
}

const GRID_CLASS = "grid gap-4 lg:grid-cols-2";

/**
 * Everything under the header. A card the server left out of the payload (the role may not see
 * it) is not rendered at all — hidden, never disabled — and the permission is re-checked here.
 */
export function DashboardBody({
  currentMonth,
  data,
  isRefreshingMonth,
  month,
  onMonthChange,
}: DashboardBodyProps): ReactElement {
  const canSeeRequests = useCan("requests.view");
  const canSeeDispensing = useCan("dispensing.view");
  const canSeeActivity = useCan("analytics.view");
  const { activity, pendingRequests, recentDispensing } = data;

  return (
    <div className="grid gap-4">
      <StatCards totals={data.totals} />
      <div className={GRID_CLASS}>
        <UseFirstCard entries={data.useFirst} />
        {canSeeRequests && pendingRequests ? (
          <PendingRequestsCard data={pendingRequests} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-4">
        <div>
          <h2 className="font-semibold text-sm">
            {formatMonthLabel(month)}
          </h2>
          <p className="text-muted-foreground text-xs">
            Choose a month and year for expiring batches and activity.
          </p>
        </div>
        <MonthPicker
          currentMonth={currentMonth}
          onChange={onMonthChange}
          value={month}
        />
      </div>
      <div
        aria-busy={isRefreshingMonth}
        className={cn(GRID_CLASS, isRefreshingMonth && "opacity-60")}
      >
        <ExpiringCard data={data.expiringThisMonth} />
        {canSeeActivity && activity ? <ActivityCard data={activity} /> : null}
      </div>
      {canSeeDispensing && recentDispensing ? (
        <RecentDispensingCard records={recentDispensing} />
      ) : null}
    </div>
  );
}
