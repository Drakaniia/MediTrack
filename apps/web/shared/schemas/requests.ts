/**
 * REQ slice contract: request queue, dispensing log, Quick Deduct.
 *
 * Input schemas are used by the API (server) AND by the SPA forms; DTOs are the response
 * shapes. Derived values (`remaining`, `availableNow`) are computed at read time.
 */

import { z } from "zod";

import { isIsoDate, isIsoMonth } from "../dates";
import {
  DENY_REASONS,
  type DenyReason,
  REQUEST_STATUSES,
  type RequestStatus,
} from "../request-transitions";

// ─── Constants ──────────────────────────────────────────────────────────────

export const MAX_REQUEST_QTY = 1_000_000;
export const MAX_REQUEST_LINES = 20;
export const MAX_REORDER_IDS = 90;
export const MAX_TEXT_LENGTH = 500;
export const MAX_NAME_LENGTH = 120;
export const MAX_UNIT_LENGTH = 40;
export const MAX_LIST_LIMIT = 500;
export const DEFAULT_LIST_LIMIT = 300;

export const REQUEST_SOURCES = ["queue", "quick_deduct"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const QUICK_DEDUCT_LABEL = "Quick deduct";

export const REQUEST_DATE_PRESETS = [
  "all",
  "today",
  "7d",
  "30d",
  "custom",
] as const;
export type RequestDatePreset = (typeof REQUEST_DATE_PRESETS)[number];

export const QTY_MESSAGE = "Quantity must be a whole number greater than zero.";

// ─── Input schemas ──────────────────────────────────────────────────────────

const qtySchema = z
  .number({ error: QTY_MESSAGE })
  .int({ error: QTY_MESSAGE })
  .positive({ error: QTY_MESSAGE })
  .max(MAX_REQUEST_QTY, { error: "That quantity is too large." });

const textSchema = (max: number) => z.string().trim().max(max);

export const requestorInputSchema = z.object({
  email: textSchema(MAX_NAME_LENGTH).optional(),
  name: textSchema(MAX_NAME_LENGTH).optional(),
  ref: textSchema(MAX_NAME_LENGTH).optional(),
});
export type RequestorInput = z.infer<typeof requestorInputSchema>;

export const requestLineInputSchema = z.object({
  itemId: z.string().trim().min(1, { error: "Choose an item." }),
  qty: qtySchema,
  unit: textSchema(MAX_UNIT_LENGTH).optional(),
});
export type RequestLineInput = z.infer<typeof requestLineInputSchema>;

export const createRequestsInputSchema = z.object({
  lines: z.array(requestLineInputSchema).min(1).max(MAX_REQUEST_LINES),
  reason: textSchema(MAX_TEXT_LENGTH).default(""),
  requestor: requestorInputSchema.optional(),
});
export type CreateRequestsInput = z.infer<typeof createRequestsInputSchema>;

export const updateRequestInputSchema = z
  .object({
    reason: textSchema(MAX_TEXT_LENGTH).optional(),
    requestor: requestorInputSchema.optional(),
  })
  .refine(
    (value) => value.reason !== undefined || value.requestor !== undefined,
    { error: "Nothing to change." }
  );
export type UpdateRequestInput = z.infer<typeof updateRequestInputSchema>;

const denyReasonSchema = z.enum(DENY_REASONS, {
  error: "Choose a reason for denying.",
});

export const transitionInputSchema = z
  .object({
    deniedNote: textSchema(MAX_TEXT_LENGTH).optional(),
    deniedReason: denyReasonSchema.optional(),
    note: textSchema(MAX_TEXT_LENGTH).optional(),
    to: z.enum(REQUEST_STATUSES),
  })
  .superRefine((value, ctx) => {
    if (value.to === "denied" && value.deniedReason === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Choose a reason for denying.",
        path: ["deniedReason"],
      });
    }
  });
export type TransitionInput = z.infer<typeof transitionInputSchema>;

export const dispenseInputSchema = z.object({
  allowPartial: z.boolean().default(false),
  qty: qtySchema.optional(),
});
export type DispenseInput = z.infer<typeof dispenseInputSchema>;

export const cancelInputSchema = z.object({
  note: textSchema(MAX_TEXT_LENGTH).optional(),
});
export type CancelInput = z.infer<typeof cancelInputSchema>;

export const reorderInputSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).max(MAX_REORDER_IDS),
  status: z.enum(REQUEST_STATUSES),
});
export type ReorderInput = z.infer<typeof reorderInputSchema>;

export const quickDeductInputSchema = z.object({
  itemId: z.string().trim().min(1, { error: "Choose an item." }),
  note: textSchema(MAX_TEXT_LENGTH).optional(),
  qty: qtySchema,
  recipient: textSchema(MAX_NAME_LENGTH).optional(),
});
export type QuickDeductInput = z.infer<typeof quickDeductInputSchema>;

// ─── Query schemas ──────────────────────────────────────────────────────────

const flag = z
  .enum(["1", "true", "0", "false"])
  .optional()
  .transform((value) => value === "1" || value === "true");

const isoDate = z.string().refine(isIsoDate, { error: "Use YYYY-MM-DD." });

function csvStatuses(raw: string | undefined): RequestStatus[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const wanted = raw.split(",").map((part) => part.trim());
  return REQUEST_STATUSES.filter((status) => wanted.includes(status));
}

export const requestListQuerySchema = z.object({
  datePreset: z.enum(REQUEST_DATE_PRESETS).default("all"),
  from: isoDate.optional(),
  includeArchived: flag,
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  mine: flag,
  search: z.string().trim().max(100).optional(),
  status: z.string().optional().transform(csvStatuses),
  to: isoDate.optional(),
});
export type RequestListQuery = z.output<typeof requestListQuerySchema>;

export const dispensingListQuerySchema = z.object({
  dispensedBy: z.string().min(1).optional(),
  from: isoDate.optional(),
  includeUndone: flag,
  itemId: z.string().min(1).optional(),
  search: z.string().trim().max(100).optional(),
  source: z.enum(REQUEST_SOURCES).optional(),
  to: isoDate.optional(),
});
export type DispensingListQuery = z.output<typeof dispensingListQuerySchema>;

export const monthlyQuerySchema = z.object({
  month: z.string().refine(isIsoMonth, { error: "Use YYYY-MM." }),
});

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface RequestEventDto {
  actorName: string;
  at: string;
  fromStatus: RequestStatus | null;
  id: string;
  note: string;
  toStatus: RequestStatus;
}

export interface DispensingLineDto {
  batchId: string | null;
  batchNumber: string;
  expiry: string | null;
  id: string;
  qty: number;
}

export interface DispensingRecordDto {
  dispensedAt: string;
  dispensedBy: string;
  dispensedByName: string;
  id: string;
  itemId: string | null;
  itemName: string;
  lines: DispensingLineDto[];
  note: string;
  qty: number;
  recipientName: string;
  requestCode: string | null;
  requestId: string | null;
  source: RequestSource;
  undoneAt: string | null;
  undoneBy: string | null;
  unit: string;
}

export interface RequestorDto {
  email: string;
  name: string;
  ref: string;
}

export interface RequestDto {
  archivedAt: string | null;
  /** Dispensable right now (FEFO-eligible stock of the item); 0 when the item is gone. */
  availableNow: number;
  boardPosition: number;
  claimedAt: string | null;
  code: string;
  deniedNote: string;
  deniedReason: DenyReason | null;
  dispensedQty: number;
  /** Hand-overs recorded for this request, oldest first. */
  dispensing: DispensingRecordDto[];
  events: RequestEventDto[];
  id: string;
  itemId: string | null;
  itemName: string;
  qty: number;
  reason: string;
  /** Quantity still to hand over (`qty - dispensedQty`). */
  remaining: number;
  requestedBy: string | null;
  requestedByName: string;
  requestor: RequestorDto;
  source: RequestSource;
  status: RequestStatus;
  submittedAt: string;
  unit: string;
  updatedAt: string;
}

export interface DispenseResultDto {
  /** True when less than the full outstanding quantity was handed over now. */
  partial: boolean;
  record: DispensingRecordDto;
  request: RequestDto;
}

export interface QuickDeductResultDto {
  record: DispensingRecordDto;
  /** ISO instant until which `POST /quick-deduct/:id/undo` is accepted. */
  undoUntil: string;
}

export interface ArchiveResultDto {
  archived: number;
}

export interface MonthlyBatchDto {
  batchId: string | null;
  batchNumber: string;
  expiry: string | null;
  qty: number;
  records: number;
}

export interface MonthlyItemDto {
  batches: MonthlyBatchDto[];
  itemId: string | null;
  itemName: string;
  totalQty: number;
  unit: string;
}

export interface MonthlyDispensingDto {
  items: MonthlyItemDto[];
  month: string;
  timezone: string;
  totalQty: number;
}
