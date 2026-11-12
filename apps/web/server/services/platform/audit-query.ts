/**
 * `GET /api/audit`: filtered, newest-first reads of the audit log.
 *
 * `from` / `to` are facility-LOCAL calendar dates (inclusive on both ends), converted to
 * UTC instants with the facility timezone from settings — "12 November" means the clinic's
 * 12 November, not UTC's. Timestamps are ISO-8601 UTC strings of fixed width, so plain
 * string comparison orders them correctly.
 */

import { addDays, startOfDayUtc } from "../../../shared/dates";
import type { Role } from "../../../shared/roles";
import type { AuditEntryDto, AuditQuery } from "../../../shared/schemas/audit";
import type { D1DatabaseLike } from "../../env";
import { escapeLike, type Paging } from "../../http";

interface AuditRow {
  action: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: Role | null;
  after: string | null;
  at: string;
  before: string | null;
  entity_id: string | null;
  entity_type: string;
  id: number;
  ip: string | null;
  summary: string;
}

export interface AuditPage {
  items: AuditEntryDto[];
  total: number;
}

const AUDIT_COLUMNS =
  "id, at, actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, before, after, ip";

function parseSnapshot(text: string | null): unknown {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function toAuditEntryDto(row: AuditRow): AuditEntryDto {
  return {
    action: row.action,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    after: parseSnapshot(row.after),
    at: row.at,
    before: parseSnapshot(row.before),
    entityId: row.entity_id,
    entityType: row.entity_type,
    id: row.id,
    ip: row.ip,
    summary: row.summary,
  };
}

function whereClause(
  query: AuditQuery,
  timeZone: string
): { values: string[]; where: string } {
  const clauses: string[] = [];
  const values: string[] = [];
  if (query.from) {
    clauses.push("at >= ?");
    values.push(startOfDayUtc(query.from, timeZone).toISOString());
  }
  if (query.to) {
    clauses.push("at < ?");
    values.push(startOfDayUtc(addDays(query.to, 1), timeZone).toISOString());
  }
  if (query.actorId) {
    clauses.push("actor_id = ?");
    values.push(query.actorId);
  }
  if (query.action) {
    clauses.push("action LIKE ? ESCAPE '\\'");
    values.push(`${escapeLike(query.action)}%`);
  }
  if (query.entityType) {
    clauses.push("entity_type = ?");
    values.push(query.entityType);
  }
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    clauses.push(
      "(summary LIKE ? ESCAPE '\\' OR actor_name LIKE ? ESCAPE '\\')"
    );
    values.push(pattern, pattern);
  }
  return {
    values,
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
  };
}

export async function queryAuditLog(
  db: D1DatabaseLike,
  query: AuditQuery,
  paging: Paging,
  timeZone: string
): Promise<AuditPage> {
  const { values, where } = whereClause(query, timeZone);
  const [counted, page] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total FROM audit_log ${where}`)
      .bind(...values)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT ${AUDIT_COLUMNS} FROM audit_log ${where} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`
      )
      .bind(...values, paging.limit, paging.offset)
      .all<AuditRow>(),
  ]);
  return {
    items: page.results.map(toAuditEntryDto),
    total: counted?.total ?? 0,
  };
}
