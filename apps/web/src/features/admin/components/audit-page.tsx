import { Button } from "@cmis/ui/components/button";
import type { AuditEntryDto } from "@shared/schemas/audit";
import { Download, ScrollText } from "lucide-react";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/components/can";
import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { errorMessage } from "@/lib/api/errors";
import { useCan, useFacility } from "@/lib/auth/guards";

import {
  AUDIT_PAGE_SIZE,
  type AuditFilters,
  EMPTY_AUDIT_FILTERS,
  fetchAuditForExport,
  isRangeInverted,
  useAuditPage,
} from "../hooks/audit-queries";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { useUserOptions } from "../hooks/user-queries";
import { buildAuditCsv, downloadTextFile } from "../lib/audit-csv";
import { AuditDetailSheet } from "./audit-detail-sheet";
import { AuditFiltersBar } from "./audit-filters";
import { AuditTable } from "./audit-table";

const RANGE_ERROR = "The start date must not be after the end date.";

/**
 * `/audit` (`audit.view`): read-only, newest first, filtered and paged on the server.
 * Dates are facility-local calendar days; the CSV export (`reports.export`) covers
 * every entry matching the current filters, not just the visible page.
 */
export function AuditPage(): ReactElement {
  const { timezone, today } = useFacility();
  const canPickActor = useCan("users.manage");
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [pageState, setPageState] = useState({ key: "", page: 0 });
  const [selected, setSelected] = useState<AuditEntryDto | null>(null);
  const [exporting, setExporting] = useState(false);

  const debouncedQ = useDebouncedValue(filters.q);
  const effective = useMemo<AuditFilters>(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ]
  );
  const filterKey = JSON.stringify(effective);
  // A new filter always starts on page 1, without an effect to reset it.
  const page = pageState.key === filterKey ? pageState.page : 0;
  const rangeInverted = isRangeInverted(effective);

  const query = useAuditPage(effective, page);
  const actors = useUserOptions(canPickActor);
  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;

  const handleChange = useCallback((patch: Partial<AuditFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  }, []);

  const goToPage = useCallback(
    (next: number) => setPageState({ key: filterKey, page: next }),
    [filterKey]
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await fetchAuditForExport(effective);
      downloadTextFile(
        `meditract-audit-${today}.csv`,
        buildAuditCsv(result.entries, timezone)
      );
      toast.success(`Exported ${result.entries.length} entries.`);
      if (result.truncated) {
        toast.warning(
          "More entries matched than the export holds. Narrow the dates to get the rest."
        );
      }
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't export the audit log."));
    } finally {
      setExporting(false);
    }
  }, [effective, timezone, today]);

  const firstShown = total === 0 ? 0 : page * AUDIT_PAGE_SIZE + 1;
  const lastShown = page * AUDIT_PAGE_SIZE + entries.length;

  return (
    <div>
      <PageHeader
        actions={
          <Can permission="reports.export">
            <Button
              disabled={exporting || rangeInverted}
              onClick={handleExport}
              variant="outline"
            >
              <Download aria-hidden />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </Can>
        }
        description={`Who did what, and when. Times are shown in ${timezone}. This log can't be edited.`}
        title="Audit log"
      />
      <AuditFiltersBar
        actors={canPickActor ? (actors.data ?? []) : undefined}
        filters={filters}
        onChange={handleChange}
        rangeError={rangeInverted ? RANGE_ERROR : undefined}
        today={today}
      />
      {rangeInverted ? null : (
        <DataState
          empty={{
            description: "Try a wider date range or fewer filters.",
            icon: ScrollText,
            title: "No audit entries match",
          }}
          error={query.error}
          isEmpty={entries.length === 0}
          isLoading={query.isPending}
          onRetry={() => query.refetch()}
        >
          <AuditTable
            entries={entries}
            onSelect={setSelected}
            timezone={timezone}
          />
          <nav
            aria-label="Audit log pages"
            className="flex flex-wrap items-center justify-between gap-2 pt-3"
          >
            <p aria-live="polite" className="text-muted-foreground text-xs">
              Showing {firstShown}–{lastShown} of {total}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={page === 0}
                onClick={() => goToPage(page - 1)}
                size="sm"
                variant="outline"
              >
                Previous
              </Button>
              <Button
                disabled={lastShown >= total}
                onClick={() => goToPage(page + 1)}
                size="sm"
                variant="outline"
              >
                Next
              </Button>
            </div>
          </nav>
        </DataState>
      )}
      {selected ? (
        <AuditDetailSheet
          entry={selected}
          onClose={() => setSelected(null)}
          timezone={timezone}
        />
      ) : null}
    </div>
  );
}
