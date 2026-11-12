/**
 * The append-only audit trail (spec §7.9).
 *
 * `auditStatement()` returns an unexecuted `INSERT`; every slice puts it INSIDE the same
 * `db.batch([...])` as the mutation it describes, so an audit row can never be missing
 * (the write failed after the change) or orphaned (the change rolled back but the audit
 * row stayed). The table itself refuses UPDATE and DELETE (triggers in `0001_init.sql`).
 *
 * `before` / `after` are JSON snapshots, redacted by KEY (password, hash, token, secret,
 * p256dh, auth, pepper — see `services/platform/redact.ts`) and capped at ~4 KB each.
 * Snapshot what a human needs to understand the change, not whole rows.
 */

import type { Role } from "../shared/roles";
import type { D1DatabaseLike, D1PreparedStatement } from "./env";
import type { AuthUser } from "./route-types";
import { toRedactedJson } from "./services/platform/redact";

/** Size cap for each of `before` / `after`, in characters of JSON text. */
export const MAX_AUDIT_JSON_CHARS = 4096;

const MAX_SUMMARY_CHARS = 500;
const MAX_ACTOR_NAME_CHARS = 80;
const SYSTEM_ACTOR_NAME = "System";
const PREVIEW_SHRINK_FACTOR = 0.8;

export interface AuditActor {
  /** Null for people who are not (yet) signed in, e.g. a failed login. */
  id: string | null;
  name: string;
  role: Role | null;
}

export interface AuditEntry {
  /** Dotted verb, e.g. `user.create`, `settings.update`, `auth.login_failed`. */
  action: string;
  /** Null = the system itself (cron jobs). */
  actor: AuditActor | null;
  after?: unknown;
  /** ISO UTC timestamp. */
  at: string;
  before?: unknown;
  entityId?: string | null;
  entityType: string;
  ip?: string | null;
  /** One human-readable line, e.g. `Disabled user "maria"`. */
  summary: string;
}

/** The audit actor for a signed-in user. */
export function actorOf(user: AuthUser): AuditActor {
  return { id: user.id, name: user.displayName, role: user.role };
}

function truncatedMarker(json: string): string {
  let previewLength = Math.min(json.length, MAX_AUDIT_JSON_CHARS);
  while (previewLength > 0) {
    const candidate = JSON.stringify({
      originalLength: json.length,
      preview: json.slice(0, previewLength),
      truncated: true,
    });
    if (candidate.length <= MAX_AUDIT_JSON_CHARS) {
      return candidate;
    }
    previewLength = Math.floor(previewLength * PREVIEW_SHRINK_FACTOR);
  }
  return JSON.stringify({ originalLength: json.length, truncated: true });
}

/**
 * Redacted JSON text for a snapshot, or `null` when there is nothing to store. Snapshots
 * over the cap are replaced by a VALID JSON marker `{ originalLength, preview, truncated }`
 * so readers can always parse the column.
 */
export function auditJson(value: unknown): string | null {
  const json = toRedactedJson(value);
  if (json === null || json === "null") {
    return null;
  }
  return json.length <= MAX_AUDIT_JSON_CHARS ? json : truncatedMarker(json);
}

export function auditStatement(
  db: D1DatabaseLike,
  entry: AuditEntry
): D1PreparedStatement {
  const { actor } = entry;
  return db
    .prepare(
      "INSERT INTO audit_log (at, actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, before, after, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      entry.at,
      actor?.id ?? null,
      (actor?.name ?? SYSTEM_ACTOR_NAME).slice(0, MAX_ACTOR_NAME_CHARS),
      actor?.role ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.summary.slice(0, MAX_SUMMARY_CHARS),
      auditJson(entry.before),
      auditJson(entry.after),
      entry.ip ?? null
    );
}
