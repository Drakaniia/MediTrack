import { buttonVariants } from "@cmis/ui/components/button";
import { monthOf } from "@shared/dates";
import { Link } from "@tanstack/react-router";
import { PackageOpen } from "lucide-react";
import { type ReactElement, useState } from "react";

import { Can } from "@/components/can";
import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { useFacility } from "@/lib/auth/guards";
import { formatDate } from "@/lib/format";

import { useDashboard } from "../hooks/dashboard-queries";
import { DashboardBody } from "./dashboard-body";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { RequestActions } from "./request-actions";

/**
 * The home page (spec §7.1): totals by expiry class, low stock, the FEFO "use first" shortlist,
 * what expires in a chosen month, requests, recent dispensing and activity — each card only for
 * the roles that may see it. Refreshes on window focus and every 5 minutes while visible; any
 * stock change invalidates it (`invalidateStockQueries`).
 */
export function DashboardPage(): ReactElement {
  const { name, today } = useFacility();
  const currentMonth = monthOf(today);
  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const month = chosenMonth ?? currentMonth;
  const query = useDashboard(month);
  const { data } = query;

  return (
    <div>
      <PageHeader
        actions={<RequestActions />}
        description={`${name} · ${formatDate(today)}`}
        title="Dashboard"
      />
      <DataState
        empty={{
          action: (
            <Can permission="inventory.write">
              <Link className={buttonVariants()} to="/inventory/add">
                Add stock
              </Link>
            </Can>
          ),
          description:
            "Once an inventory officer registers items and batches, their expiry status and the FEFO shortlist appear here.",
          icon: PackageOpen,
          title: "No stock registered yet",
        }}
        error={data ? undefined : query.error}
        isEmpty={data?.totals.itemCount === 0}
        isLoading={query.isPending}
        onRetry={() => query.refetch()}
        skeleton={<DashboardSkeleton />}
      >
        {data ? (
          <DashboardBody
            currentMonth={currentMonth}
            data={data}
            isRefreshingMonth={query.isPlaceholderData}
            month={month}
            onMonthChange={setChosenMonth}
          />
        ) : null}
      </DataState>
    </div>
  );
}
