import type { ScanBatchResult, ScanItemResult } from "@shared/schemas/scan";

import { formatDate } from "@/lib/format";

export interface FefoNotice {
  detail?: string;
  title: string;
  /** ok = go ahead, warn = another batch should go first, stop = do not dispense this one. */
  tone: "ok" | "stop" | "warn";
}

function expiryText(expiry: string | null): string {
  return expiry ? `expires ${formatDate(expiry)}` : "no expiry date";
}

function noticeForBatch(result: ScanBatchResult): FefoNotice {
  const { batch, fefoBatch } = result;
  const first = fefoBatch && fefoBatch.id !== batch.id ? fefoBatch : null;

  if (batch.quarantined) {
    return {
      detail: first
        ? `Use batch ${first.batchNumber} first (${expiryText(first.expiry)}).`
        : "No other batch can be dispensed.",
      title: "Expired stock: do not dispense. Set it aside for disposal.",
      tone: "stop",
    };
  }
  if (batch.status !== "active" || batch.fefoRank === null) {
    return {
      detail: first ? `Use batch ${first.batchNumber} first.` : undefined,
      title: "This batch cannot be dispensed.",
      tone: "stop",
    };
  }
  if (first) {
    return {
      detail: `This batch is #${batch.fefoRank} in FEFO order. Batch ${first.batchNumber} (${expiryText(first.expiry)}) expires sooner.`,
      title: `Use batch ${first.batchNumber} first.`,
      tone: "warn",
    };
  }
  return {
    detail: "FEFO rank 1: this batch expires first.",
    title: "Use this batch first: yes.",
    tone: "ok",
  };
}

function noticeForItem(result: ScanItemResult): FefoNotice {
  const { fefoBatch } = result;
  if (!fefoBatch) {
    return {
      detail: "There is no unexpired stock to dispense.",
      title: "Nothing available for this item.",
      tone: "stop",
    };
  }
  return {
    detail: `Batch ${fefoBatch.batchNumber} (${expiryText(fefoBatch.expiry)}) is next in FEFO order.`,
    title: `Use batch ${fefoBatch.batchNumber} first.`,
    tone: "ok",
  };
}

/** The "use this batch first?" advice for a scan. Colour is only a hint; icon and words say it. */
export function fefoNoticeFor(result: ScanBatchResult | ScanItemResult): FefoNotice {
  return result.kind === "batch" ? noticeForBatch(result) : noticeForItem(result);
}
