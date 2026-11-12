import {
  type ExpiryReportDto,
  reportExportQuerySchema,
  reportQuerySchema,
  type StockReportDto,
} from "../../shared/schemas/reports";
import { actorOf, auditStatement } from "../audit";
import type { D1DatabaseLike } from "../env";
import { ok, parseQuery } from "../http";
import type { ProtectedRouteContext, RouteDef } from "../route-types";
import { loadExpiryReport } from "../services/reports/expiry-report";
import { loadStockReport } from "../services/reports/stock-report";

type ReportKind = "expiry" | "stock";

type ReportLoader = (
  db: D1DatabaseLike,
  input: { month: string | undefined; now: Date }
) => Promise<ExpiryReportDto | StockReportDto>;

const LOADERS: Record<ReportKind, ReportLoader> = {
  expiry: loadExpiryReport,
  stock: loadStockReport,
};

const KIND_LABELS: Record<ReportKind, string> = {
  expiry: "expiry report",
  stock: "stock report",
};

/** On-screen report for one facility month (`?month=YYYY-MM`, default the current month). */
function viewHandler(kind: ReportKind) {
  return async (ctx: ProtectedRouteContext): Promise<Response> => {
    const query = parseQuery(ctx, reportQuerySchema);
    return ok(await LOADERS[kind](ctx.db, { month: query.month, now: ctx.now }));
  };
}

/**
 * Export payload (spec §4: only `reports.export` roles may export). Same data as the view
 * route, plus an audit row so every exported copy is traceable to a person and a month.
 */
function exportHandler(kind: ReportKind) {
  return async (ctx: ProtectedRouteContext): Promise<Response> => {
    const query = parseQuery(ctx, reportExportQuerySchema);
    const report = await LOADERS[kind](ctx.db, {
      month: query.month,
      now: ctx.now,
    });
    const format = query.format.toUpperCase();
    await ctx.db.batch([
      auditStatement(ctx.db, {
        action: "report.export",
        actor: actorOf(ctx.user),
        after: { format: query.format, kind, month: report.month },
        at: ctx.now.toISOString(),
        entityId: report.month,
        entityType: "report",
        ip: ctx.ip,
        summary: `Exported the ${KIND_LABELS[kind]} for ${report.month} (${format})`,
      }),
    ]);
    return ok(report);
  };
}

/**
 * View routes need `reports.view`; export routes need `reports.export`. PDF / XLSX files are
 * produced in the browser, but only from the export responses, so the server is the gate.
 */
export const reportRoutes: RouteDef[] = [
  {
    access: "reports.view",
    handler: viewHandler("stock"),
    method: "GET",
    path: "/api/reports/stock",
  },
  {
    access: "reports.view",
    handler: viewHandler("expiry"),
    method: "GET",
    path: "/api/reports/expiry",
  },
  {
    access: "reports.export",
    handler: exportHandler("stock"),
    method: "GET",
    path: "/api/reports/stock/export",
  },
  {
    access: "reports.export",
    handler: exportHandler("expiry"),
    method: "GET",
    path: "/api/reports/expiry/export",
  },
];
