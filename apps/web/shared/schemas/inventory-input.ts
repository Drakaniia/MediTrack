/**
 * Input schemas for the INV endpoints (items, batches, categories, bulk import).
 *
 * `qty` is accepted ONLY when a batch is created or merged; no schema here lets a client
 * set a quantity afterwards (stock changes belong to the EXP / REQ slices).
 */

import { z } from "zod";

import { isIsoDate } from "../dates";
import { EXPIRY_CLASSES } from "../expiry";

export const MAX_QTY = 10_000_000;
export const MAX_BATCHES_PER_ITEM_REQUEST = 20;
export const MAX_BULK_ROWS = 500;
export const ITEM_SORT_KEYS = [
  "name",
  "nearestExpiry",
  "onHand",
  "category",
  "updated",
] as const;
export const STOCK_LEVELS = ["in_stock", "low", "out"] as const;

const NAME_MAX = 120;
const SHORT_MAX = 60;

const NOTES_MAX = 1000;
const CODE_MAX = 64;
const BULK_CELL_MAX = 400;

function blankToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const isoDate = z.string().refine(isIsoDate, "Use a real date (YYYY-MM-DD).");
const nullableDate = z.preprocess(blankToNull, isoDate.nullable());
const nullableCode = z.preprocess(
  blankToNull,
  z.string().trim().max(CODE_MAX).nullable()
);
const text = (max: number) => z.string().trim().max(max);

export const batchInputSchema = z.strictObject({
  barcode: nullableCode.optional(),
  batchNumber: text(SHORT_MAX).default(""),
  expiry: nullableDate.optional(),
  qty: z
    .number("Quantity must be a number.")
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    .max(MAX_QTY, "Quantity is too large."),
  receivedOn: isoDate.optional(),
  supplier: text(NAME_MAX).default(""),
});
export type BatchInput = z.output<typeof batchInputSchema>;

const itemFields = {
  barcode: nullableCode.optional(),
  categoryId: z.preprocess(blankToNull, z.string().nullable()).optional(),
  hasExpiry: z.boolean().optional(),
  lowStockThreshold: z.number().int().min(0).max(MAX_QTY).optional(),
  name: text(NAME_MAX).min(1, "Enter the product name."),
  notes: text(NOTES_MAX).optional(),
  packSize: z.number().int().min(1).max(MAX_QTY).nullable().optional(),
  packUnit: text(SHORT_MAX).optional(),
  sku: nullableCode.optional(),
  strength: text(SHORT_MAX).optional(),
  supplier: text(NAME_MAX).optional(),
  unit: text(SHORT_MAX).min(1, "Enter the unit.").optional(),
};

export const createItemInputSchema = z.strictObject({
  ...itemFields,
  batches: z
    .array(batchInputSchema)
    .max(MAX_BATCHES_PER_ITEM_REQUEST)
    .default([]),
});
export type CreateItemInput = z.output<typeof createItemInputSchema>;

export const updateItemInputSchema = z
  .strictObject({
    ...itemFields,
    name: itemFields.name.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");
export type UpdateItemInput = z.output<typeof updateItemInputSchema>;

export const createBatchInputSchema = batchInputSchema.extend({
  mergeIntoExisting: z.boolean().default(false),
});
export type CreateBatchInput = z.output<typeof createBatchInputSchema>;

export const updateBatchInputSchema = z
  .strictObject({
    barcode: nullableCode.optional(),
    batchNumber: text(SHORT_MAX).min(1, "Enter the batch number.").optional(),
    expiry: nullableDate.optional(),
    receivedOn: isoDate.optional(),
    supplier: text(NAME_MAX).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");
export type UpdateBatchInput = z.output<typeof updateBatchInputSchema>;

export const categoryInputSchema = z.strictObject({
  name: text(SHORT_MAX).min(1, "Enter a category name."),
  sortOrder: z.number().int().min(0).max(MAX_QTY).optional(),
});
export const updateCategoryInputSchema = categoryInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");
export type CategoryInput = z.output<typeof categoryInputSchema>;
export type UpdateCategoryInput = z.output<typeof updateCategoryInputSchema>;

function csv<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "")
    )
    .pipe(z.array(z.enum(values)));
}

export const listItemsQuerySchema = z.object({
  categoryId: z.string().trim().min(1).optional(),
  dir: z.enum(["asc", "desc"]).default("asc"),
  search: z.string().trim().max(NAME_MAX).optional(),
  sort: z.enum(ITEM_SORT_KEYS).default("name"),
  status: csv(EXPIRY_CLASSES).optional(),
  stock: csv(STOCK_LEVELS).optional(),
});
export type ListItemsQuery = z.output<typeof listItemsQuerySchema>;

export const fefoQuerySchema = z.object({
  categoryId: z.string().trim().min(1).optional(),
});

const bulkCell = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().max(BULK_CELL_MAX))
  .default("");

export const bulkRowSchema = z.strictObject({
  barcode: bulkCell,
  batchNumber: bulkCell,
  category: bulkCell,
  expiry: bulkCell,
  hasExpiry: bulkCell,
  name: bulkCell,
  notes: bulkCell,
  packSize: bulkCell,
  packUnit: bulkCell,
  qty: bulkCell,
  receivedOn: bulkCell,
  sku: bulkCell,
  strength: bulkCell,
  supplier: bulkCell,
  threshold: bulkCell,
  unit: bulkCell,
});
export type BulkRow = z.output<typeof bulkRowSchema>;
export type BulkRowInput = z.input<typeof bulkRowSchema>;

export const bulkImportInputSchema = z.strictObject({
  dryRun: z.boolean().default(false),
  rows: z
    .array(bulkRowSchema)
    .min(1, "Add at least one row.")
    .max(MAX_BULK_ROWS),
});
export type BulkImportInput = z.output<typeof bulkImportInputSchema>;

export const trashTypeSchema = z.enum(["item", "batch"]);
export type TrashType = z.output<typeof trashTypeSchema>;

export const suggestNumberQuerySchema = z.object({
  itemId: z.string().trim().min(1, "itemId is required."),
  receivedOn: isoDate.optional(),
});

export const historyQueryDefaults = { limit: 50 } as const;

export const deleteCategoryQuerySchema = z.object({
  reassignTo: z.string().trim().min(1).optional(),
});
