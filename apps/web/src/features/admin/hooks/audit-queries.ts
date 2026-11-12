import { MAX_PAGE_SIZE } from "@shared/api";
import type { AuditEntryDto } from "@shared/schemas/audit";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiGetPage, type QueryParams } from "@/lib/api/client";

export const AUDIT_PAGE_SIZE = 50;
/** The CSV export stops here; the admin is told when the log was longer. */
export const AUDIT_EXPORT_LIMIT = 5000;

export interface AuditFilters {
  actorId: string;
  entityType: string;
  /** Facility-local `YYYY-MM-DD`, or "". */
  from: string;
  /** Action prefix without the dot (`auth`), or "". */
  prefix: string;
  q: string;
  to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  actorId: "",
  entityType: "",
  from: "",
  prefix: "",
  q: "",
  to: "",
};

export const auditKeys = {
  all: ["audit"] as const,
  list: (filters: AuditFilters, offset: number) =>
    ["audit", "list", filters, offset] as const,
};

/** The query string of `GET /api/audit` for `filters` (blank filters are dropped by the client). */
export function auditParams(filters: AuditFilters): QueryParams {
  return {
    action: filters.prefix === "" ? "" : `${filters.prefix}.`,
    actorId: filters.actorId,
    entityType: filters.entityType,
    from: filters.from,
    q: filters.q.trim(),
    to: filters.to,
  };
}

/** True when `from` is after `to` (the server would answer 400). */
export function isRangeInverted(filters: AuditFilters): boolean {
  return filters.from !== "" && filters.to !== "" && filters.from > filters.to;
}

export interface AuditPage {
  entries: AuditEntryDto[];
  total: number;
}

export function useAuditPage(filters: AuditFilters, page: number) {
  const offset = page * AUDIT_PAGE_SIZE;
  return useQuery({
    enabled: !isRangeInverted(filters),
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<AuditPage> => {
      const { data, meta } = await apiGetPage<AuditEntryDto[]>(
        "/audit",
        { ...auditParams(filters), limit: AUDIT_PAGE_SIZE, offset },
        { signal }
      );
      return { entries: data, total: meta.total ?? data.length };
    },
    queryKey: auditKeys.list(filters, offset),
  });
}

export interface AuditExport {
  entries: AuditEntryDto[];
  /** True when more entries matched than `AUDIT_EXPORT_LIMIT`. */
  truncated: boolean;
}

function fetchAuditChunk(filters: AuditFilters, offset: number) {
  return apiGetPage<AuditEntryDto[]>("/audit", {
    ...auditParams(filters),
    limit: MAX_PAGE_SIZE,
    offset,
  });
}

/**
 * Every entry matching `filters`, newest first, `MAX_PAGE_SIZE` per request: the first
 * request learns the total, the rest are fetched together.
 */
export async function fetchAuditForExport(
  filters: AuditFilters
): Promise<AuditExport> {
  const first = await fetchAuditChunk(filters, 0);
  const total = first.meta.total ?? first.data.length;
  const last = Math.min(total, AUDIT_EXPORT_LIMIT);
  const offsets: number[] = [];
  for (let offset = MAX_PAGE_SIZE; offset < last; offset += MAX_PAGE_SIZE) {
    offsets.push(offset);
  }
  const rest = await Promise.all(
    offsets.map((offset) => fetchAuditChunk(filters, offset))
  );
  const entries = [first, ...rest].flatMap((chunk) => chunk.data);
  return {
    entries: entries.slice(0, AUDIT_EXPORT_LIMIT),
    truncated: total > AUDIT_EXPORT_LIMIT,
  };
}
