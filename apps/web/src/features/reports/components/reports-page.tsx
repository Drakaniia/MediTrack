import { Button } from "@cmis/ui/components/button";
import { monthOf } from "@shared/dates";
import { EXPIRY_CLASS_LABELS, EXPIRY_CLASSES } from "@shared/expiry";
import type {
  ExpiryReportDto,
  ReportExportFormat,
  ReportHeaderDto,
  StockReportDto,
} from "@shared/schemas/reports";
import { FileSpreadsheet, FileText } from "lucide-react";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/components/can";
import { DataState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { MonthPicker } from "@/features/dashboard/components/month-picker";
import { formatMonthLabel } from "@/features/dashboard/lib/months";
import { errorMessage } from "@/lib/api/errors";
import { useFacility } from "@/lib/auth/guards";
import { formatDate, formatDateTime } from "@/lib/format";

import {
  fetchExpiryReportExport,
  fetchStockReportExport,
  useExpiryReport,
  useStockReport,
} from "../hooks/report-queries";
import { exportPdf, exportXlsx, type ReportDocument } from "../lib/report-export";
import {
  expiryTable,
  type ReportTable,
  reportFileName,
  stockBatchesTable,
  stockItemsTable,
} from "../lib/report-tables";

type ReportKind = "expiry" | "stock";

const KIND_LABELS: Record<ReportKind, string> = {
  expiry: "Expiry report",
  stock: "Stock report",
};

function subtitle(header: ReportHeaderDto): string[] {
  return [
    `${header.facilityName} · ${formatMonthLabel(header.month)} · as of ${formatDate(header.asOf)}`,
    `Thresholds: Urgent ≤ ${header.thresholds.urgentDays} days, Near Expiry ≤ ${header.thresholds.nearDays} days · Generated ${formatDateTime(header.generatedAt, header.timezone)}`,
  ];
}

function TableView({ table }: { table: ReportTable }): ReactElement {
  return (
    <section className="grid gap-2">
      <h2 className="font-semibold text-sm">{table.name}</h2>
      {table.body.length === 0 ? (
        <p className="rounded-md bg-muted/40 px-3 py-4 text-center text-muted-foreground text-sm">
          No rows for this month.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground text-xs">
              <tr>
                {table.head.map((column) => (
                  <th className="whitespace-nowrap px-3 py-2 font-medium" key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.body.map((row) => (
                <tr className="border-t" key={row.join("|")}>
                  {row.map((cell, index) => (
                    <td
                      className={`whitespace-nowrap px-3 py-1.5 ${typeof cell === "number" ? "text-right tabular-nums" : ""}`}
                      key={table.head[index]}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Tiles({ tiles }: { tiles: [string, number][] }): ReactElement {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(([label, value]) => (
        <div className="rounded-lg border p-3" key={label}>
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className="font-semibold text-lg tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function stockTiles(report: StockReportDto): [string, number][] {
  const { summary } = report;
  return [
    ["Items", summary.medicines],
    ["Units on hand", summary.units],
    ["Received", summary.received],
    ["Dispensed", summary.dispensed],
    ["Disposed", summary.disposed],
    ["Low stock", summary.lowStockItems],
    ["Out of stock", summary.lowStockOut],
    ["Categories", summary.categories],
  ];
}

function expiryTiles(report: ExpiryReportDto): [string, number][] {
  return [
    ["Expiring this month (units)", report.summary.expiring.units],
    ["Expired earlier (units)", report.summary.expired.units],
    ...EXPIRY_CLASSES.map(
      (expiryClass): [string, number] => [
        `${EXPIRY_CLASS_LABELS[expiryClass]} now (batches)`,
        report.summary.classesNow[expiryClass].batches,
      ]
    ),
  ];
}

const EXPORTERS: Record<ReportExportFormat, (report: ReportDocument) => Promise<void>> = {
  pdf: exportPdf,
  xlsx: exportXlsx,
};

function toDocument(
  kind: ReportKind,
  header: ReportHeaderDto,
  tables: ReportTable[],
  format: ReportExportFormat
): ReportDocument {
  return {
    fileName: reportFileName(kind, header.month, format),
    subtitle: subtitle(header),
    tables,
    title: KIND_LABELS[kind],
  };
}

/**
 * Loads the export payload from the `reports.export`-guarded endpoint (which also audits it)
 * and builds the document from that response, never from the on-screen query data.
 */
async function loadExportDocument(
  kind: ReportKind,
  month: string,
  format: ReportExportFormat
): Promise<ReportDocument> {
  if (kind === "stock") {
    const report = await fetchStockReportExport(month, format);
    return toDocument(kind, report, [stockItemsTable(report), stockBatchesTable(report)], format);
  }
  const report = await fetchExpiryReportExport(month, format);
  return toDocument(kind, report, [expiryTable(report)], format);
}

function ExportButtons({
  disabled,
  kind,
  month,
}: {
  disabled: boolean;
  kind: ReportKind;
  month: string;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const run = async (format: ReportExportFormat): Promise<void> => {
    setBusy(true);
    try {
      const report = await loadExportDocument(kind, month, format);
      await EXPORTERS[format](report);
    } catch (error) {
      toast.error(errorMessage(error, "The export failed. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Can permission="reports.export">
      <Button
        className="tap-target gap-1.5"
        disabled={disabled || busy}
        onClick={() => run("pdf")}
        variant="outline"
      >
        <FileText aria-hidden />
        Export PDF
      </Button>
      <Button
        className="tap-target gap-1.5"
        disabled={disabled || busy}
        onClick={() => run("xlsx")}
        variant="outline"
      >
        <FileSpreadsheet aria-hidden />
        Export XLSX
      </Button>
    </Can>
  );
}

/**
 * Reports (spec §7.8): stock and expiry reports for one month (month + year only), shown on
 * screen and exported to PDF / XLSX in the browser. Exports use the same tables, built from
 * the `reports.export`-guarded endpoint.
 */
export function ReportsPage(): ReactElement {
  const { today } = useFacility();
  const currentMonth = monthOf(today);
  const [month, setMonth] = useState(currentMonth);
  const [kind, setKind] = useState<ReportKind>("stock");
  const stock = useStockReport(month, kind === "stock");
  const expiry = useExpiryReport(month, kind === "expiry");
  const query = kind === "stock" ? stock : expiry;

  const tables: ReportTable[] = [];
  let header: ReportHeaderDto | undefined;
  let tiles: [string, number][] = [];
  if (kind === "stock" && stock.data) {
    header = stock.data;
    tables.push(stockItemsTable(stock.data), stockBatchesTable(stock.data));
    tiles = stockTiles(stock.data);
  }
  if (kind === "expiry" && expiry.data) {
    header = expiry.data;
    tables.push(expiryTable(expiry.data));
    tiles = expiryTiles(expiry.data);
  }

  return (
    <div className="grid gap-4">
      <PageHeader
        actions={<ExportButtons disabled={!header} kind={kind} month={month} />}
        description={header ? subtitle(header)[0] : undefined}
        title="Reports"
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div aria-label="Report" className="inline-flex rounded-md border p-0.5" role="group">
          {(Object.keys(KIND_LABELS) as ReportKind[]).map((option) => (
            <Button
              aria-pressed={kind === option}
              key={option}
              onClick={() => setKind(option)}
              size="sm"
              variant={kind === option ? "secondary" : "ghost"}
            >
              {KIND_LABELS[option]}
            </Button>
          ))}
        </div>
        <MonthPicker currentMonth={currentMonth} onChange={setMonth} value={month} />
      </div>
      <DataState
        error={query.data ? undefined : query.error}
        isLoading={query.isPending}
        onRetry={() => query.refetch()}
      >
        <div aria-busy={query.isPlaceholderData} className="grid gap-4">
          <Tiles tiles={tiles} />
          {tables.map((table) => (
            <TableView key={table.name} table={table} />
          ))}
        </div>
      </DataState>
    </div>
  );
}
