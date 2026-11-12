/**
 * Audit log read model (spec §7.9): `GET /api/audit`. The log is append-only and written
 * by `server/audit.ts`; this is only the shape the API returns and the filters it accepts.
 */

import { z } from "zod";

import { isIsoDate } from "../dates";
import type { Role } from "../roles";

export const MAX_AUDIT_FILTER_LENGTH = 100;

export interface AuditEntryDto {
  /** Dotted verb, e.g. `user.create`, `auth.login_failed`, `settings.update`. */
  action: string;
  actorId: string | null;
  actorName: string;
  actorRole: Role | null;
  /** Parsed snapshot after the change, or null. */
  after: unknown;
  /** ISO UTC timestamp. */
  at: string;
  /** Parsed snapshot before the change, or null. */
  before: unknown;
  entityId: string | null;
  entityType: string;
  id: number;
  ip: string | null;
  summary: string;
}

function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const optionalText = z.preprocess(
  blankToUndefined,
  z.string().trim().max(MAX_AUDIT_FILTER_LENGTH).optional()
);

/** A facility-local calendar date, `YYYY-MM-DD`. */
const optionalDate = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isIsoDate, { message: "Use a date like 2026-11-12." })
    .optional()
);

/**
 * Filters of `GET /api/audit`. `from` / `to` are facility-local dates (inclusive);
 * `action` is a prefix (`auth.` matches every sign-in event); `q` searches the summary
 * and the actor's name. `limit` / `offset` are read separately by `readPaging`.
 */
export const auditQuerySchema = z
  .object({
    action: optionalText,
    actorId: optionalText,
    entityType: optionalText,
    from: optionalDate,
    q: optionalText,
    to: optionalDate,
  })
  .refine((value) => !(value.from && value.to) || value.from <= value.to, {
    message: "The start date must not be after the end date.",
    path: ["from"],
  });

export type AuditQuery = z.output<typeof auditQuerySchema>;
