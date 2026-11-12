/** Plain-words wording and `data` payloads of generated notifications. */

import { EXPIRY_CLASS_LABELS } from "../../../shared/expiry";
import type {
  NotificationData,
  NotificationKind,
  NotificationSeverity,
} from "../../../shared/schemas/alerts";
import type { AlertClass } from "./types";

export const SEVERITY_BY_CLASS: Record<AlertClass, NotificationSeverity> = {
  expired: "critical",
  near_expiry: "info",
  urgent: "warning",
};

/** Same-origin paths the notification centre and push clicks lead to. */
export const NOTIFICATION_URLS: Record<NotificationKind, string> = {
  expired: "/inventory/quarantine",
  low_stock: "/inventory/low-stock",
  near_expiry: "/inventory/expiry",
  urgent: "/inventory/expiry",
};

export interface NotificationText {
  body: string;
  data: NotificationData;
  title: string;
}

export function itemDisplayName(name: string, strength: string): string {
  const trimmed = strength.trim();
  return trimmed === "" ? name : `${name} ${trimmed}`;
}

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

/** "expires in 5 days", "expires today", "expired 3 days ago". */
export function describeWhen(daysUntil: number): string {
  if (daysUntil < 0) {
    return `expired ${plural(-daysUntil, "day")} ago`;
  }
  if (daysUntil === 0) {
    return "expires today";
  }
  if (daysUntil === 1) {
    return "expires tomorrow";
  }
  return `expires in ${plural(daysUntil, "day")}`;
}

export interface BatchTextInput {
  batchNumber: string;
  daysUntil: number;
  expiry: string;
  itemName: string;
  kind: AlertClass;
  qty: number;
  unit: string;
}

const BODY_BY_CLASS: Record<AlertClass, (input: BatchTextInput) => string> = {
  expired: (input) =>
    `${input.qty} ${input.unit} still in stock are past their expiry date. Take them out of use and record a disposal.`,
  near_expiry: (input) =>
    `${input.qty} ${input.unit} in stock. Plan to use this batch before ${input.expiry}.`,
  urgent: (input) =>
    `${input.qty} ${input.unit} in stock. Use this batch first, before ${input.expiry}.`,
};

export function batchNotificationText(input: BatchTextInput): NotificationText {
  const label = EXPIRY_CLASS_LABELS[input.kind];
  return {
    body: BODY_BY_CLASS[input.kind](input),
    data: {
      batchNumber: input.batchNumber,
      daysUntil: input.daysUntil,
      expiry: input.expiry,
      itemName: input.itemName,
      onHand: input.qty,
      unit: input.unit,
      url: NOTIFICATION_URLS[input.kind],
    },
    title: `${input.itemName} · ${input.batchNumber} is ${label} — ${describeWhen(input.daysUntil)} (${input.expiry})`,
  };
}

export interface LowStockTextInput {
  available: number;
  itemName: string;
  threshold: number;
  unit: string;
}

export function lowStockNotificationText(
  input: LowStockTextInput
): NotificationText {
  const out = input.available <= 0;
  return {
    body: out
      ? "Nothing usable is left. Reorder as soon as you can."
      : `Only ${input.available} ${input.unit} can still be used. Reorder soon.`,
    data: {
      itemName: input.itemName,
      onHand: input.available,
      threshold: input.threshold,
      unit: input.unit,
      url: NOTIFICATION_URLS.low_stock,
    },
    title: out
      ? `${input.itemName} is out of stock (minimum ${input.threshold} ${input.unit})`
      : `${input.itemName} is low on stock — ${input.available} ${input.unit} left (minimum ${input.threshold})`,
  };
}
