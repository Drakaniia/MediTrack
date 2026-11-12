import { Button } from "@cmis/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@cmis/ui/components/dialog";
import { Input } from "@cmis/ui/components/input";
import { Label } from "@cmis/ui/components/label";
import {
  type DispensingRecordDto,
  QUICK_DEDUCT_LABEL,
} from "@shared/schemas/requests";
import { type ReactElement, useId, useState } from "react";

import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { useFacility } from "@/lib/auth/guards";
import { formatDate, formatDateTime, formatQuantity } from "@/lib/format";

import {
  DEFAULT_DISPENSING_FILTERS,
  DISPENSING_PAGE_SIZE,
  type DispensingFilters,
  useDispensingLog,
} from "../hooks/request-queries";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { DispensingMonthly } from "./dispensing-monthly";
import { NATIVE_SELECT_CLASS } from "./form-parts";

type View = "log" | "month";

function sourceLabel(record: Pick<DispensingRecordDto, "source">): string {
  return record.source === "quick_deduct" ? QUICK_DEDUCT_LABEL : "Request";
}

function FilterBar({
  filters,
  onChange,
  onSearch,
  searchText,
}: {
  filters: DispensingFilters;
  onChange: (patch: Partial<DispensingFilters>) => void;
  onSearch: (text: string) => void;
  searchText: string;
}): ReactElement {
  const searchId = useId();
  const sourceId = useId();
  const fromId = useId();
  const toId = useId();
  const undoneId = useId();
  return (
    <search className="flex flex-wrap items-end gap-3">
      <div className="grid min-w-52 flex-1 gap-1">
        <Label htmlFor={searchId}>Search dispensing</Label>
        <Input
          autoComplete="off"
          id={searchId}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Item, recipient, staff, request code or batch"
          type="search"
          value={searchText}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={sourceId}>Source</Label>
        <select
          className={NATIVE_SELECT_CLASS}
          id={sourceId}
          onChange={(event) =>
            onChange({
              source: event.target.value as DispensingFilters["source"],
            })
          }
          value={filters.source}
        >
          <option value="">All sources</option>
          <option value="queue">Requests</option>
          <option value="quick_deduct">{QUICK_DEDUCT_LABEL}</option>
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={fromId}>From</Label>
        <Input
          id={fromId}
          onChange={(event) => onChange({ from: event.target.value })}
          type="date"
          value={filters.from}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={toId}>To</Label>
        <Input
          id={toId}
          onChange={(event) => onChange({ to: event.target.value })}
          type="date"
          value={filters.to}
        />
      </div>
      <div className="flex h-8 items-center gap-2">
        <input
          checked={filters.includeUndone}
          className="size-4"
          id={undoneId}
          onChange={(event) =>
            onChange({ includeUndone: event.target.checked })
          }
          type="checkbox"
        />
        <Label htmlFor={undoneId}>Show undone</Label>
      </div>
    </search>
  );
}

function RecordDetail({
  onClose,
  record,
}: {
  onClose: () => void;
  record: DispensingRecordDto;
}): ReactElement {
  const { timezone } = useFacility();
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{record.itemName}</DialogTitle>
          <DialogDescription>
            {formatQuantity(record.qty, record.unit)} ·{" "}
            {formatDateTime(record.dispensedAt, timezone)} ·{" "}
            {record.dispensedByName}
            {record.undoneAt ? " · undone" : ""}
          </DialogDescription>
        </DialogHeader>
        <h3 className="font-medium text-sm">Batches taken</h3>
        <ul className="grid gap-1 text-sm">
          {record.lines.map((line) => (
            <li
              className="flex justify-between gap-2 rounded-md border p-2"
              key={line.id}
            >
              <span>Batch {line.batchNumber}</span>
              <span className="text-muted-foreground">
                {line.expiry
                  ? `expires ${formatDate(line.expiry)}`
                  : "no expiry"}
              </span>
              <span className="tabular-nums">{line.qty}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          {sourceLabel(record)}
          {record.requestCode ? ` ${record.requestCode}` : ""}
          {record.recipientName ? ` · for ${record.recipientName}` : ""}
          {record.note ? ` · ${record.note}` : ""}
        </p>
      </DialogContent>
    </Dialog>
  );
}

function LogTable({
  onOpen,
  records,
}: {
  onOpen: (record: DispensingRecordDto) => void;
  records: DispensingRecordDto[];
}): ReactElement {
  const { timezone } = useFacility();
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Dispensing log, newest first</caption>
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="p-2 font-medium" scope="col">
              When
            </th>
            <th className="p-2 font-medium" scope="col">
              Item
            </th>
            <th className="p-2 text-right font-medium" scope="col">
              Qty
            </th>
            <th className="p-2 font-medium" scope="col">
              Batches
            </th>
            <th className="p-2 font-medium" scope="col">
              Source
            </th>
            <th className="p-2 font-medium" scope="col">
              By
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr className="border-t" key={record.id}>
              <td className="whitespace-nowrap p-2">
                {formatDateTime(record.dispensedAt, timezone)}
              </td>
              <td className="p-2">
                <button
                  className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpen(record)}
                  type="button"
                >
                  {record.itemName}
                </button>
                {record.undoneAt ? (
                  <span className="ml-2 rounded-full border px-1.5 text-muted-foreground text-xs">
                    Undone
                  </span>
                ) : null}
              </td>
              <td className="p-2 text-right tabular-nums">{record.qty}</td>
              <td className="p-2">
                {record.lines.map((line) => line.batchNumber).join(", ")}
              </td>
              <td className="p-2">
                {sourceLabel(record)}
                {record.requestCode ? ` · ${record.requestCode}` : ""}
              </td>
              <td className="p-2">{record.dispensedByName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogView(): ReactElement {
  const [filters, setFilters] = useState<DispensingFilters>(
    DEFAULT_DISPENSING_FILTERS
  );
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<DispensingRecordDto | null>(null);
  const search = useDebouncedValue(searchText);
  const effective = { ...filters, search };
  const log = useDispensingLog(effective, page);
  const records = log.data?.records ?? [];
  const total = log.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / DISPENSING_PAGE_SIZE));

  const change = (patch: Partial<DispensingFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(0);
  };

  return (
    <div className="grid gap-3">
      <FilterBar
        filters={filters}
        onChange={change}
        onSearch={(text) => {
          setSearchText(text);
          setPage(0);
        }}
        searchText={searchText}
      />
      <DataState
        empty={{
          description: "Nothing matches these filters.",
          title: "No dispensing records",
        }}
        error={log.error}
        isEmpty={records.length === 0}
        isLoading={log.isPending}
        onRetry={() => log.refetch()}
      >
        <LogTable onOpen={setOpen} records={records} />
      </DataState>
      <nav
        aria-label="Pages"
        className="flex items-center justify-between text-sm"
      >
        <p aria-live="polite" className="text-muted-foreground">
          {total} record{total === 1 ? "" : "s"} · page {page + 1} of{" "}
          {pageCount}
        </p>
        <div className="flex gap-2">
          <Button
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
            size="sm"
            type="button"
            variant="outline"
          >
            Previous
          </Button>
          <Button
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((value) => value + 1)}
            size="sm"
            type="button"
            variant="outline"
          >
            Next
          </Button>
        </div>
      </nav>
      {open ? (
        <RecordDetail onClose={() => setOpen(null)} record={open} />
      ) : null}
    </div>
  );
}

/** The dispensing log (per batch, paged) and the monthly per-batch totals. */
export function DispensingPage(): ReactElement {
  const [view, setView] = useState<View>("log");
  return (
    <div>
      <PageHeader
        actions={
          <div aria-label="View" className="flex gap-1" role="group">
            <Button
              aria-pressed={view === "log"}
              onClick={() => setView("log")}
              size="sm"
              type="button"
              variant={view === "log" ? "default" : "outline"}
            >
              Log
            </Button>
            <Button
              aria-pressed={view === "month"}
              onClick={() => setView("month")}
              size="sm"
              type="button"
              variant={view === "month" ? "default" : "outline"}
            >
              By month
            </Button>
          </div>
        }
        description="Every hand-over, with the exact batches it drew from."
        title="Dispensing log"
      />
      {view === "log" ? <LogView /> : <DispensingMonthly />}
    </div>
  );
}
