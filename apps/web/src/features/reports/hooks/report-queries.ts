import type {
  ExpiryReportDto,
  ReportExportFormat,
  StockReportDto,
} from "@shared/schemas/reports";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/client";

export function useStockReport(month: string, enabled = true) {
  return useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiGet<StockReportDto>("/reports/stock", { month }, { signal }),
    queryKey: ["reports", "stock", month] as const,
  });
}

export function useExpiryReport(month: string, enabled = true) {
  return useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiGet<ExpiryReportDto>("/reports/expiry", { month }, { signal }),
    queryKey: ["reports", "expiry", month] as const,
  });
}

/**
 * Fresh, uncached export payloads. The server checks `reports.export` and audits each call,
 * so an export is never built from the on-screen (`reports.view`) data.
 */
export function fetchStockReportExport(
  month: string,
  format: ReportExportFormat
): Promise<StockReportDto> {
  return apiGet<StockReportDto>("/reports/stock/export", { format, month });
}

export function fetchExpiryReportExport(
  month: string,
  format: ReportExportFormat
): Promise<ExpiryReportDto> {
  return apiGet<ExpiryReportDto>("/reports/expiry/export", { format, month });
}
