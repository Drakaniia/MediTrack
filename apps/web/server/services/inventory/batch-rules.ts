/** Batch-level business rules shared by item creation, receiving, editing and bulk import. */

import {
  normalizeBatchNumber,
  suggestBatchNumber,
} from "../../../shared/batch-code";
import { isExpired } from "../../../shared/expiry";
import type { BatchWarning } from "../../../shared/schemas/inventory";
import type { IssueInput } from "./statements";

/** `hasExpiry = false` → no expiry allowed; `hasExpiry = true` → expiry required. */
export function expiryRuleIssue(
  hasExpiry: boolean,
  expiry: string | null | undefined,
  path: string
): IssueInput | null {
  if (hasExpiry && !expiry) {
    return {
      message: "Enter an expiry date, or mark the product as having no expiry.",
      path,
    };
  }
  if (!hasExpiry && expiry) {
    return {
      message: "This product has no expiry, so the batch cannot have one.",
      path,
    };
  }
  return null;
}

/** The typed number (trimmed, spaces collapsed) or an automatic suggestion when blank. */
export function resolveBatchNumber(input: {
  batchNumber: string;
  itemName: string;
  receivedOn: string;
  used: readonly string[];
}): string {
  const typed = normalizeBatchNumber(input.batchNumber);
  if (typed !== "") {
    return typed;
  }
  return suggestBatchNumber({
    existingNumbers: input.used,
    itemName: input.itemName,
    receivedOn: input.receivedOn,
  });
}

export function arrivalWarnings(
  expiry: string | null,
  today: string
): BatchWarning[] {
  return isExpired(expiry, today) ? ["expired_on_arrival"] : [];
}
