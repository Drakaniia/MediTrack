import type { ItemSummaryDto } from "@shared/schemas/inventory";
import {
  type CreateRequestsInput,
  MAX_REQUEST_LINES,
  MAX_REQUEST_QTY,
  QTY_MESSAGE,
} from "@shared/schemas/requests";
import { useCallback, useEffect, useRef, useState } from "react";

import { useItemDetail } from "./request-queries";

export interface DraftLine {
  item: ItemSummaryDto | null;
  key: string;
  qty: number | "";
}

export interface LineErrors {
  item?: string;
  qty?: string;
}

export interface NewRequestFormState {
  addLine: () => void;
  lines: DraftLine[];
  maxLines: number;
  reason: string;
  removeLine: (key: string) => void;
  requestor: { email: string; name: string; ref: string };
  setItem: (key: string, item: ItemSummaryDto | null) => void;
  setQty: (key: string, qty: number | "") => void;
  setReason: (reason: string) => void;
  setRequestor: (
    patch: Partial<{ email: string; name: string; ref: string }>
  ) => void;
  /** The API body, or the per-line errors to show (only after the user clicked Create). */
  validate: () => { errors: LineErrors[]; input: CreateRequestsInput | null };
}

/** Errors of every draft line: an item must be chosen and the quantity must be a whole number ≥ 1. */
export function lineErrorsOf(lines: readonly DraftLine[]): LineErrors[] {
  return lines.map((line) => {
    const errors: LineErrors = {};
    if (line.item === null) {
      errors.item = "Choose an item.";
    }
    const { qty } = line;
    const validQty =
      qty !== "" && Number.isInteger(qty) && qty > 0 && qty <= MAX_REQUEST_QTY;
    if (!validQty) {
      errors.qty = QTY_MESSAGE;
    }
    return errors;
  });
}

function hasErrors(errors: readonly LineErrors[]): boolean {
  return errors.some(
    (entry) => entry.item !== undefined || entry.qty !== undefined
  );
}

export interface NewRequestInitial {
  itemId?: string;
  qty?: number;
}

/** Form state of the New Request dialog, pre-fillable with one item and quantity. */
export function useNewRequestForm(
  initial: NewRequestInitial
): NewRequestFormState {
  const counter = useRef(0);
  const nextKey = useCallback(() => {
    counter.current += 1;
    return `line-${counter.current}`;
  }, []);
  const [lines, setLines] = useState<DraftLine[]>(() => [
    { item: null, key: nextKey(), qty: initial.qty ?? "" },
  ]);
  const [reason, setReason] = useState("");
  const [requestor, setRequestorState] = useState({
    email: "",
    name: "",
    ref: "",
  });
  const prefill = useItemDetail(initial.itemId);
  const prefilled = useRef(false);

  useEffect(() => {
    if (prefilled.current || !prefill.data) {
      return;
    }
    prefilled.current = true;
    const item = prefill.data;
    setLines((current) =>
      current.map((line, index) =>
        index === 0 && line.item === null ? { ...line, item } : line
      )
    );
  }, [prefill.data]);

  const update = useCallback(
    (key: string, patch: Partial<DraftLine>) =>
      setLines((current) =>
        current.map((line) => (line.key === key ? { ...line, ...patch } : line))
      ),
    []
  );

  const addLine = useCallback(
    () =>
      setLines((current) =>
        current.length >= MAX_REQUEST_LINES
          ? current
          : [...current, { item: null, key: nextKey(), qty: "" }]
      ),
    [nextKey]
  );
  const removeLine = useCallback(
    (key: string) =>
      setLines((current) =>
        current.length === 1
          ? current
          : current.filter((line) => line.key !== key)
      ),
    []
  );

  const validate = useCallback(() => {
    const errors = lineErrorsOf(lines);
    if (hasErrors(errors)) {
      return { errors, input: null };
    }
    const input: CreateRequestsInput = {
      lines: lines.map((line) => ({
        itemId: (line.item as ItemSummaryDto).id,
        qty: line.qty as number,
      })),
      reason: reason.trim(),
      requestor: {
        email: requestor.email.trim(),
        name: requestor.name.trim(),
        ref: requestor.ref.trim(),
      },
    };
    return { errors, input };
  }, [lines, reason, requestor]);

  return {
    addLine,
    lines,
    maxLines: MAX_REQUEST_LINES,
    reason,
    removeLine,
    requestor,
    setItem: (key, item) => update(key, { item }),
    setQty: (key, qty) => update(key, { qty }),
    setReason,
    setRequestor: (patch) =>
      setRequestorState((current) => ({ ...current, ...patch })),
    validate,
  };
}
